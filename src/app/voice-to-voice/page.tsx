"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActorRef, useSelector } from "@xstate/react";
import { useVoiceSegments } from "../../hooks/use-voice-segments";
import { splitTextByWeightedRatio } from "../../lib/tts/progressSplit";
import React from "react";
import { kokoroChunkerMachine, type UiChunk } from "../../machines/kokoroChunker.machine";
import { inspect } from "@/machines/inspector";

export default function Page() {
  // (Audio handled directly in this page)
  // Integrated voice segments (VAD + Whisper)
  const [vadThreshold, setVadThreshold] = useState<number>(0.6);
  const {
    status: vsStatus,
    liveText,
    // lastFinalText not used directly; handled via onSegment → pushText
    vadListening,
    vadUserSpeaking,
    whisperStatus,
    whisperIsReady,
    whisperIsRecording,
    settleRemainingMs,
    waitingForWhisper,
    waitingRemainingMs,
    errors: { whisper: whisperError, vad: vadScopedError },
    start: segmentsStart,
    stop: segmentsStop,
    toggle: segmentsToggle,
    load: segmentsLoad,
    chunkCount,
    debugForceFlush,
  } = useVoiceSegments({
    whisper: { language: "en", autoStart: true, dataRequestInterval: 250 },
    vad: { model: "v5", startOnLoad: false, userSpeakingThreshold: vadThreshold, baseAssetPath: "/vad/", onnxWASMBasePath: "/vad/" },
    settleMs: 300,
    // autoLoad: false,
    onLiveUpdate: (text) => {
        // console.log("[useVoiceSegments] onLiveUpdate", text);
    },
    onSegment: (text) => {
        console.log("[useVoiceSegments] onSegment", text);
        pushText(text, true);
        // Resume autoplay after a completed segment
        // if (!isBoot) {
        chunkerActor.send({ type: 'UI.SET_AUTOPLAY', autoplay: true });
        // }
        setIsUserPaused(false);
    },
    onInterruption: () => { // pause player on interruption
      console.log("[useVoiceSegments] onInterruption", interruptionsEnabled);
      if (interruptionsEnabled) {
        pause();
        // if (!isBoot) {
        chunkerActor.send({ type: 'UI.SET_AUTOPLAY', autoplay: false });
        // }
      }
    },
  });

  // Kokoro Chunker Machine (handles chunking + TTS)
  // Ensure crossfade state is defined before machine input references it
  const [crossfadeMs, setCrossfadeMs] = useState<number>(800);
  const audioARef = React.useRef<HTMLAudioElement | null>(null);
  const audioBRef = React.useRef<HTMLAudioElement | null>(null);
  const [progressRatio, setProgressRatio] = useState<number>(0);
  const aChunkIdRef = React.useRef<number | null>(null);
  const bChunkIdRef = React.useRef<number | null>(null);
  const cancelCrossfadeRef = React.useRef<(() => void) | null>(null);

  const getByIndex = useCallback((index: 0 | 1) => (index === 0 ? audioARef.current : audioBRef.current), []);

  const setElementChunkId = useCallback((el: HTMLAudioElement | null, chunkId: number | null) => {
    if (!el) return;
    if (el === audioARef.current) aChunkIdRef.current = chunkId;
    if (el === audioBRef.current) bChunkIdRef.current = chunkId;
  }, []);

  const chunkerActor = useActorRef(kokoroChunkerMachine, {
    inspect,
    input: {
      crossfadeEnabled: crossfadeMs > 0,
      crossfadeMs,
      onUtteranceGenerated: (_chunk: UiChunk) => {
        // TTS generation handled by machine - chunks are already in machine state
        console.log('TTS generated', _chunk);
      },
      onAudioPlay: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => {
        const el = preferredPlayerIndex != null ? getByIndex(preferredPlayerIndex) : audioARef.current;
        if (!el) return;
        try { el.preload = "auto"; } catch {}
        if (el.src !== audioUrl) el.src = audioUrl;
        setElementChunkId(el, chunkId);
        el.play().then(() => {
          chunkerActor.send({ type: 'AUDIO_STARTED', chunkId });
        }).catch(() => {
          chunkerActor.send({ type: 'UI.SET_AUTOPLAY', autoplay: false });
        });
      },
      onAudioPause: () => {
        const a = audioARef.current; const b = audioBRef.current;
        if (a && !a.paused) a.pause();
        if (b && !b.paused) b.pause();
      },
      onAudioStop: () => {
        const a = audioARef.current; const b = audioBRef.current;
        if (a) { try { a.pause(); } catch {}; try { a.currentTime = 0; } catch {}; }
        if (b) { try { b.pause(); } catch {}; try { b.currentTime = 0; } catch {}; }
        if (cancelCrossfadeRef.current) { cancelCrossfadeRef.current(); cancelCrossfadeRef.current = null; }
      },
      onAudioPreload: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => {
        const idle = preferredPlayerIndex != null ? getByIndex(preferredPlayerIndex) : (audioARef.current && audioBRef.current ? audioBRef.current : audioARef.current);
        if (!idle) return;
        try { idle.preload = "auto"; } catch {}
        if (idle.src !== audioUrl) {
          idle.src = audioUrl;
          try { if (idle.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) idle.load(); } catch {}
        }
        setElementChunkId(idle, chunkId);
      },
      onCrossfadeStart: ({ currentChunkId, nextChunkId, durationMs, nextUrl, nextPlayerIndex }) => {
        const idle = getByIndex(nextPlayerIndex);
        const active = getByIndex(nextPlayerIndex === 0 ? 1 : 0);
        if (!active || !idle) return;
        // Ensure idle is prepared
        if (idle.src !== nextUrl) {
          idle.preload = 'auto';
          idle.src = nextUrl;
          try { if (idle.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) idle.load(); } catch {}
        }
        setElementChunkId(idle, nextChunkId);
        try { idle.volume = 0; } catch {}
        idle.play().then(() => {
          chunkerActor.send({ type: 'AUDIO_STARTED', chunkId: nextChunkId });
        }).catch(() => {
          chunkerActor.send({ type: 'UI.SET_AUTOPLAY', autoplay: false });
          return;
        });
        const startTs = performance.now();
        const fadeMs = Math.max(1, durationMs);
        const activeStartVol = Math.max(0, Math.min(1, active.volume));
        const idleTargetVol = Math.max(0, Math.min(1, idle.volume || 1));
        try { idle.volume = 0; } catch {}
        let rafId = 0;
        let stopped = false;
        const step = (now: number) => {
          if (stopped) return;
          const t = Math.max(0, Math.min(1, (now - startTs) / fadeMs));
          try { active.volume = (1 - t) * activeStartVol; } catch {}
          try { idle.volume = t * idleTargetVol; } catch {}
          if (t < 1) {
            rafId = requestAnimationFrame(step);
          }
        };
        rafId = requestAnimationFrame(step);
        cancelCrossfadeRef.current = () => {
          stopped = true;
          if (rafId) cancelAnimationFrame(rafId);
          try { active.volume = activeStartVol; } catch {}
          try { idle.volume = idleTargetVol; } catch {}
        };
      },
      onCrossfadeCancel: () => {
        if (cancelCrossfadeRef.current) { cancelCrossfadeRef.current(); cancelCrossfadeRef.current = null; }
      },
    }
  });
  

  // Configure chunker options
  useEffect(() => {
    chunkerActor.send({ type: 'UI.SET_CHUNKER_LOCALE', locale: 'en' });
    chunkerActor.send({ type: 'UI.SET_CHUNKER_CHAR_ENABLED', enabled: false });
    chunkerActor.send({ type: 'UI.SET_CHUNKER_CHAR_LIMIT', limit: 220 });
    chunkerActor.send({ type: 'UI.SET_CHUNKER_WORD_ENABLED', enabled: false });
    chunkerActor.send({ type: 'UI.SET_CHUNKER_WORD_LIMIT', limit: Number.POSITIVE_INFINITY });
    chunkerActor.send({ type: 'UI.SET_CHUNKER_SOFT_PUNCT', softPunctSrc: String(/[,;:—–\-]/).slice(1, -1) });
  }, [chunkerActor]);

  // Use chunks from machine state
  const uiChunks = useSelector(chunkerActor, (state) => state.context.uiChunks);
  const autoplay = useSelector(chunkerActor, (state) => state.context.autoplay);
  const voices = useSelector(chunkerActor, (state) => state.context.voices);
  const selectedVoice = useSelector(chunkerActor, (state) => state.context.selectedVoice);
  const speed = useSelector(chunkerActor, (state) => state.context.speed);
  const device = useSelector(chunkerActor, (state) => state.context.device);
  const error = useSelector(chunkerActor, (state) => state.context.error);
  const isBoot = chunkerActor.getSnapshot().matches("boot");

  const pushText = useCallback((s: string, _eos: boolean = false) => {
    // Send text to the machine using the existing pushChunk mechanism
    if (!isBoot) {
      chunkerActor.send({ type: 'UI.SET_TEXT', text: s });
      chunkerActor.send({ type: 'UI.SET_CURSOR', cursor: 0 });
      chunkerActor.send({ type: 'UI.SET_PUSH_SIZE', pushSize: s.length });
      chunkerActor.send({ type: 'UI.PUSH_CHUNK' });
    }
  }, [chunkerActor, isBoot]);

  // Playback & generation queue
  const [playhead, setPlayhead] = useState<number>(0);
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);
  const [interruptionsEnabled, setInterruptionsEnabled] = useState<boolean>(false);

  const playAudioUrl = useCallback((_audioUrl: string, chunkId: number) => {
    const idx = uiChunks.findIndex(c => c.id === chunkId);
    if (idx !== -1) setPlayhead(idx);
  }, [uiChunks]);

  // Attach events to both audio elements
  useEffect(() => {
    const wire = (el: HTMLAudioElement | null) => {
      if (!el) return () => {};
      const onEnded = () => {
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) chunkerActor.send({ type: 'AUDIO_ENDED', chunkId: id });
        setProgressRatio(0);
      };
      const onPlayEv = () => {
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) chunkerActor.send({ type: 'AUDIO_STARTED', chunkId: id });
      };
      const onPauseEv = () => {
        if (el.ended) return;
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) chunkerActor.send({ type: 'AUDIO_PAUSED', chunkId: id });
      };
      const onTimeUpdate = () => {
        const dur = el.duration || 0;
        const cur = el.currentTime || 0;
        const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
        setProgressRatio(ratio);
        chunkerActor.send({ type: 'AUDIO_PROGRESS', currentTime: cur, duration: dur });
      };
      el.addEventListener('ended', onEnded);
      el.addEventListener('play', onPlayEv);
      el.addEventListener('pause', onPauseEv);
      el.addEventListener('timeupdate', onTimeUpdate);
      return () => {
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('play', onPlayEv);
        el.removeEventListener('pause', onPauseEv);
        el.removeEventListener('timeupdate', onTimeUpdate);
      };
    };
    const offA = wire(audioARef.current);
    const offB = wire(audioBRef.current);
    return () => { offA && offA(); offB && offB(); };
  }, [chunkerActor]);

  const play = useCallback(() => {
    chunkerActor.send({ type: 'UI.PLAY' });
  }, [chunkerActor]);

  const pause = useCallback(() => {
    chunkerActor.send({ type: 'UI.PAUSE' });
  }, [chunkerActor]);

  const stop = useCallback(() => {
    chunkerActor.send({ type: 'UI.STOP' });
  }, [chunkerActor]);

  const skip = useCallback(() => {
    chunkerActor.send({ type: 'UI.SKIP' });
  }, [chunkerActor]);

  const clearAudioSources = useCallback(() => {
    const a = audioARef.current; const b = audioBRef.current;
    if (a) { a.removeAttribute('src'); try { a.load(); } catch {} }
    if (b) { b.removeAttribute('src'); try { b.load(); } catch {} }
    setActiveAudioIndex(0);
    setProgressRatio(0);
  }, []);

  // lastFinalText is already pushed via onSegment; liveText shown in UI

  // Controls
  const onPlay = () => { play(); };

  const onPause = () => { pause(); };

  const onStop = () => { stop(); };

  const onSkip = () => { skip(); };

  const clearAll = () => {
    onStop();
    setPlayhead(0);
    chunkerActor.send({ type: 'UI.RESET_ALL' });
    clearAudioSources();
  };

  // Spoken vs remaining text (approximate for current chunk using audio progress)
  const { spokenText, remainingText } = useMemo(() => {
    const before = uiChunks.slice(0, playhead).filter((c) => c.status === "played").map((c) => c.text).join(" ");
    const current = uiChunks[playhead];
    let currentSpoken = "";
    let currentRemain = "";
    if (current && (current.status === "playing" || current.status === "paused" || current.status === "ready")) {
      const ratio = progressRatio || 0;
      const text = current.text || "";
      const { spoken, remaining } = splitTextByWeightedRatio(text, ratio);
      currentSpoken = spoken;
      currentRemain = remaining;
    }
    const after = uiChunks.slice(playhead + 1).map((c) => c.text).join(" ");
    return {
      spokenText: [before, currentSpoken].filter(Boolean).join(" "),
      remainingText: [currentRemain, after].filter(Boolean).join(" "),
    };
  }, [playhead, uiChunks, progressRatio]);

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Voice-to-Voice Streaming</h1>
          <p className="text-gray-500">
            Whisper realtime transcription → VAD segmentation → Sentence chunking → Kokoro TTS, with interruption handling.
            {device ? ` — device: ${device}` : ""}
          </p>
        </div>

        {/* Controls */}
        <div className="border rounded-xl p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Whisper</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 bg-blue-600 text-white disabled:opacity-50"
                  onClick={segmentsLoad}
                  disabled={vsStatus !== "boot"}
                >
                  {vsStatus === "boot" ? "Load Models" : "Models Ready"}
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-2 border disabled:opacity-50"
                  onClick={vadListening ? segmentsStop : segmentsStart}
                  disabled={vsStatus === "boot"}
                >
                  {vadListening ? "Stop" : "Start"}
                </button>
                <span className="text-sm text-gray-600 ml-auto">
                  {vsStatus} {vadUserSpeaking ? "· speaking" : ""}
                </span>
              </div>
              {whisperError && <div className="text-sm text-red-600">Whisper: {whisperError}</div>}
              {vadScopedError && <div className="text-sm text-red-600">VAD: {vadScopedError}</div>}
              {/* Live indicators for settle/waiting states */}
              <div className="flex items-center gap-3 text-xs text-gray-600">
                {vsStatus === "settling" && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                    Settling… {typeof settleRemainingMs === 'number' ? Math.ceil(settleRemainingMs / 100) / 10 : 0}s
                  </span>
                )}
                {waitingForWhisper && (
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-indigo-500" />
                    Waiting for Whisper… {typeof waitingRemainingMs === 'number' ? Math.ceil(waitingRemainingMs / 100) / 10 : 0}s
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                  chunks: {chunkCount} · ready: {String(whisperIsReady)} · rec: {String(whisperIsRecording)}
                </span>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Live transcript</div>
                <div className="min-h-[48px] border rounded p-2">{liveText || <span className="text-gray-400">Speak…</span>}</div>
              </div>
              <div className="flex gap-2 text-xs">
                <button type="button" className="px-2 py-1 border rounded" onClick={debugForceFlush}>Force Flush</button>
              </div>
            </div>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold">VAD</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={segmentsToggle}
                  disabled={false}
                  className="rounded-lg px-3 py-2 bg-indigo-600 text-white disabled:opacity-50"
                >
                  {vadListening ? "Pause" : "Start"}
                </button>
                <div className="flex items-center gap-2 ml-2">
                  <label htmlFor="vad-th" className="text-sm text-gray-600">Threshold</label>
                  <input id="vad-th" type="range" min={0} max={1} step={0.05} value={vadThreshold} onChange={(e) => setVadThreshold(parseFloat(e.target.value))} />
                  <span className="text-sm text-gray-700 tabular-nums">{vadThreshold.toFixed(2)}</span>
                </div>
                <div className="ml-auto text-sm text-gray-600">
                  {vadListening ? "Listening" : "Idle"} {vadUserSpeaking ? "· Speaking" : ""}
                </div>
              </div>
              {vadScopedError && <div className="text-sm text-red-600">{vadScopedError}</div>}
            </div>
          </div>
        </div>

        {/* TTS Options */}
        <div className="border rounded-xl p-4 space-y-3">
          <h2 className="text-lg font-semibold">TTS</h2>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600" htmlFor="voice-select">Voice</label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(e) => chunkerActor.send({ type: 'UI.SET_VOICE', voice: e.target.value })}
              disabled={isBoot || Object.keys(voices).length === 0}
              className="rounded-lg border px-3 py-2"
            >
              {Object.entries(voices).map(([id, v]) => (
                <option key={id} value={id}>{v.name} ({v.language === "en-us" ? "American" : "British"} {v.gender})</option>
              ))}
            </select>
            <label className="text-sm text-gray-600" htmlFor="speed-range">Speed</label>
            <input
              id="speed-range"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              onChange={(e) => chunkerActor.send({ type: 'UI.SET_SPEED', speed: Number(e.target.value) })}
              disabled={isBoot}
            />
            <input
              id="speed-number"
              type="number"
              min={0.5}
              max={2}
              step={0.05}
              value={speed}
              onChange={(e) => chunkerActor.send({ type: 'UI.SET_SPEED', speed: Number(e.target.value) })}
              disabled={isBoot}
              className="w-24 rounded-lg border px-2 py-1"
            />
            <span className="text-sm text-gray-600">{speed.toFixed(2)}x</span>
            {error && !isBoot && <div className="text-sm text-red-600">{error}</div>}
          </div>
        </div>

        {/* Status details (debug) */}
        <div className="border rounded-xl p-4 space-y-2">
          <h2 className="text-lg font-semibold">Status details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="space-y-1">
              <div><span className="font-medium">Segmenter status</span>: {vsStatus}</div>
              <div><span className="font-medium">VAD listening</span>: {String(vadListening)}</div>
              <div><span className="font-medium">VAD speaking</span>: {String(vadUserSpeaking)}</div>
              <div><span className="font-medium">Whisper model status</span>: {whisperStatus}</div>
              <div><span className="font-medium">Whisper model ready</span>: {String(whisperIsReady)}</div>
              <div><span className="font-medium">Whisper mic recording</span>: {String(whisperIsRecording)}</div>
            </div>
            <div className="space-y-1">
              <div><span className="font-medium">Settle remaining</span>: {typeof settleRemainingMs === 'number' ? `${Math.ceil(settleRemainingMs / 100) / 10}s` : '—'}</div>
              <div><span className="font-medium">Waiting for Whisper</span>: {waitingForWhisper ? `${Math.ceil((waitingRemainingMs || 0) / 100) / 10}s` : 'no'}</div>
              <div><span className="font-medium">Recorder chunks</span>: {chunkCount}</div>
              <div><span className="font-medium">Live text length</span>: {liveText?.length ?? 0}</div>
              <div><span className="font-medium">Queue size</span>: {uiChunks.length}</div>
              <div><span className="font-medium">Player</span>: prog={Math.round((progressRatio || 0) * 100)}%</div>
            </div>
          </div>
          <div className="pt-2">
            <button type="button" className="px-2 py-1 border rounded text-xs" onClick={debugForceFlush}>Force Flush Segment</button>
          </div>
        </div>

        {/* Player */}
        <div className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Player</h2>
            <button type="button" onClick={onPlay} className="rounded-lg px-3 py-2 bg-blue-600 text-white">Play</button>
            <button type="button" onClick={onPause} className="rounded-lg px-3 py-2 bg-gray-600 text-white">Pause</button>
            <button type="button" onClick={onStop} className="rounded-lg px-3 py-2 bg-gray-700 text-white">Stop</button>
            <button type="button" onClick={onSkip} className="rounded-lg px-3 py-2 bg-amber-600 text-white">Skip</button>
            <button type="button" onClick={clearAll} className="rounded-lg px-3 py-2 bg-gray-200">Clear</button>
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={autoplay} onChange={(e) => chunkerActor.send({ type: 'UI.SET_AUTOPLAY', autoplay: e.target.checked })} /> Autoplay
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={interruptionsEnabled} onChange={(e) => setInterruptionsEnabled(e.target.checked)} /> Interruptions
            </label>
            <div className="flex items-center gap-2 ml-4">
              <label className="text-sm text-gray-600" htmlFor="crossfade-range">Crossover</label>
              <input id="crossfade-range" type="range" min={0} max={300} step={10} value={crossfadeMs} onChange={(e) => setCrossfadeMs(Number(e.target.value))} />
              <span className="text-sm text-gray-600">{crossfadeMs}ms</span>
            </div>
          </div>
          <div className="relative">
            <audio ref={audioARef} className={`w-full`} controls preload="auto">
              <track kind="captions" label="TTS audio A" />
            </audio>
            <audio ref={audioBRef} className={`w-full`} controls preload="auto">
              <track kind="captions" label="TTS audio B" />
            </audio>
          </div>
        </div>

        {/* Spoken vs Remaining */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-xl p-4 space-y-2">
            <h2 className="text-lg font-semibold">Spoken (approx)</h2>
            <div className="min-h-[100px] whitespace-pre-wrap text-gray-200">{spokenText || <span className="text-gray-400">Nothing spoken yet.</span>}</div>
          </div>
          <div className="border rounded-xl p-4 space-y-2">
            <h2 className="text-lg font-semibold">Remaining</h2>
            <div className="min-h-[100px] whitespace-pre-wrap text-gray-200">{remainingText || <span className="text-gray-400">Queue is empty.</span>}</div>
          </div>
        </div>

        {/* Queue view */}
        <div className="border rounded-xl p-4 space-y-2">
          <h2 className="text-lg font-semibold">Queue</h2>
          <div className="space-y-2 max-h-[40vh] overflow-auto pr-2">
            {uiChunks.length === 0 && (
              <div className="text-sm text-gray-500">Segments will appear here as you speak and pause.</div>
            )}
            {uiChunks.map((c, i) => (
              <UiChunkItem key={c.id} chunk={c} index={i} isCurrent={i === playhead} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface UiChunkItemProps {
  chunk: UiChunk;
  index: number;
  isCurrent: boolean;
}

function UiChunkItem({ chunk, index, isCurrent }: UiChunkItemProps) {
  return (
    <div className={`rounded-lg border p-3 ${isCurrent ? "border-blue-600" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>#{index + 1}</span>
        <span>idx={chunk.chunkIdx}</span>
        <span>sent={chunk.sentenceIdx}</span>
        <span>piece={chunk.pieceIdx}</span>
        <span>off={chunk.startOffset}-{chunk.endOffset}</span>
        <span className="ml-auto">
          <StatusBadge status={chunk.status} />
          {chunk.isStreamFinal ? <span className="ml-2 text-purple-600">[EOF]</span> : null}
        </span>
      </div>
      <div className="mt-1 whitespace-pre-wrap">{chunk.text}</div>
    </div>
  );
}

interface StatusBadgeProps {
  status: UiChunk["status"];
}

function StatusBadge({ status }: StatusBadgeProps) {
  const color =
    status === "pending" ? "bg-gray-200 text-gray-800" :
    status === "generating" ? "bg-indigo-200 text-indigo-800" :
    status === "ready" ? "bg-emerald-200 text-emerald-800" :
    status === "playing" ? "bg-blue-200 text-blue-800" :
    status === "paused" ? "bg-amber-200 text-amber-800" :
    status === "played" ? "bg-gray-100 text-gray-500" :
    status === "skipped" ? "bg-amber-100 text-amber-700" :
    "bg-red-200 text-red-800";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs ${color}`}>{status}</span>;
}


