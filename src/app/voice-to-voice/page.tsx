"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceSegments } from "../../hooks/use-voice-segments";
import { useSentenceChunker } from "../../hooks/use-sentence-chunker";
import { useKokoroTtsGenerator } from "../../hooks/use-kokoro-tts-generator";
import { useTtsQueue } from "../../hooks/use-tts-queue";
import { splitTextByWeightedRatio } from "../../lib/tts/progressSplit";

type UiChunk = {
  id: number;
  chunkIdx: number;
  sentenceIdx: number;
  pieceIdx: number;
  text: string;
  isSentenceFinal: boolean;
  isStreamFinal: boolean;
  startOffset: number;
  endOffset: number;
  status: "pending" | "generating" | "ready" | "playing" | "paused" | "played" | "error" | "skipped";
  audioUrl?: string;
  requestId?: number;
};

export default function Page() {
  // (Audio handled by useTtsQueue below)
  // Integrated voice segments (VAD + Whisper)
  const [vadThreshold, setVadThreshold] = useState<number>(0.6);
  const {
    status: vsStatus,
    liveText,
    // lastFinalText not used directly; handled via onSegment → pushText
    vadListening,
    vadUserSpeaking,
    settleRemainingMs,
    waitingForWhisper,
    waitingRemainingMs,
    errors: { whisper: whisperError, vad: vadScopedError },
    start: segmentsStart,
    stop: segmentsStop,
    toggle: segmentsToggle,
    load: segmentsLoad,
  } = useVoiceSegments({
    whisper: { language: "en", autoStart: true, dataRequestInterval: 250 },
    vad: { model: "v5", startOnLoad: false, userSpeakingThreshold: vadThreshold, baseAssetPath: "/vad/", onnxWASMBasePath: "/vad/" },
    settleMs: 300,
    autoLoad: true,
    /*
    onLiveUpdate: (text) => {
        console.log("[useVoiceSegments] onLiveUpdate", text);
    },
    */
    onSegment: (text) => {
        console.log("[useVoiceSegments] onSegment", text);
        pushText(text, true);
        // Resume autoplay after a completed segment
        setAutoplay(true);
        setIsUserPaused(false);
    },
    onInterruption: () => { // pause player on interruption
      console.log("[useVoiceSegments] onInterruption");
      pause();
      setAutoplay(false);
    },
  });

  // Chunker
  const nextUiIdRef = useRef<number>(1);
  const { push: chunkPush, reset: chunkReset } = useSentenceChunker({
    locale: "en",
    charLimit: 220,
    wordLimit: Number.POSITIVE_INFINITY,
    softPunct: /[,;:—–\-]/,
  });

  const [uiChunks, setUiChunks] = useState<UiChunk[]>([]);

  const toUiChunk = useCallback((c: import("../../lib/sentence-stream-chunker/sentence-stream-chunker").Chunk): UiChunk => {
    const id = nextUiIdRef.current++;
    return {
      id,
      chunkIdx: c.idx,
      sentenceIdx: c.sentenceIdx,
      pieceIdx: c.pieceIdx,
      text: c.text,
      isSentenceFinal: c.isSentenceFinal,
      isStreamFinal: c.isStreamFinal,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      status: "pending",
    };
  }, []);

  const pushText = useCallback((s: string, eos: boolean = false) => {
    const newChunks = chunkPush(s, eos);
    if (newChunks.length > 0) {
      setUiChunks((prev) => [...prev, ...newChunks.map(toUiChunk)]);
    }
  }, [chunkPush, toUiChunk]);

  // Kokoro TTS worker (shared)
  const {
    voices,
    selectedVoice,
    setSelectedVoice,
    speed,
    setSpeed,
    device,
    error: workerError,
    ready: workerReady,
    generate,
  } = useKokoroTtsGenerator();

  // Playback & generation queue
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [playhead, setPlayhead] = useState<number>(0);
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);
  const [crossfadeMs, setCrossfadeMs] = useState<number>(800);
  const genBusyRef = useRef<boolean>(false);
  const queueNextGenerationRef = useRef<() => void>(() => {});

  const sendGenerate = useCallback((chunk: UiChunk) => {
    if (!workerReady) return false;
    const voiceId = selectedVoice && voices[selectedVoice] ? selectedVoice : Object.keys(voices)[0];
    if (!voiceId) {
      // No voice yet
      return false;
    }
    setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "generating" } : c)));
    generate({ text: chunk.text, voice: voiceId, speed })
      .then(({ url }) => {
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "ready", audioUrl: url } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      })
      .catch(() => {
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id && c.status === "generating" ? { ...c, status: "error" } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      });
    return true;
  }, [generate, selectedVoice, speed, workerReady, voices]);

  const queueNextGeneration = useCallback(() => {
    if (genBusyRef.current) return;
    const next = uiChunks.find((c) => c.status === "pending");
    if (!next) return;
    genBusyRef.current = true;
    sendGenerate(next);
  }, [sendGenerate, uiChunks]);

  useEffect(() => {
    queueNextGeneration();
  }, [queueNextGeneration]);

  useEffect(() => {
    queueNextGenerationRef.current = queueNextGeneration;
  }, [queueNextGeneration]);
  // Hook: low-latency dual-audio queue playback
  const { audioARef, audioBRef, activeAudioIndex, progressRatio, play, pause, stop, skip, clearAudioSources } = useTtsQueue({
    items: useMemo(() => uiChunks.map((c) => ({ audioUrl: c.audioUrl, status: c.status })), [uiChunks]),
    playhead,
    setPlayhead,
    autoplay,
    setAutoplay,
    isUserPaused,
    setIsUserPaused,
    onStatusChange: (idx, status) => {
      setUiChunks((prev) => prev.map((c, i) => (i === idx ? { ...c, status } : c)));
    },
    onError: (m) => console.error(m),
    crossfadeMs,
  });

  // lastFinalText is already pushed via onSegment; liveText shown in UI

  // Controls
  const onPlay = () => { play(); };

  const onPause = () => { pause(); };

  const onStop = () => { stop(); };

  const onSkip = () => { skip(); };

  const clearAll = () => {
    onStop();
    setUiChunks([]);
    setPlayhead(0);
    nextUiIdRef.current = 1;
    chunkReset();
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
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Live transcript</div>
                <div className="min-h-[48px] border rounded p-2">{liveText || <span className="text-gray-400">Speak…</span>}</div>
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
            <select id="voice-select" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={!workerReady || Object.keys(voices).length === 0} className="rounded-lg border px-3 py-2">
              {Object.entries(voices).map(([id, v]) => (
                <option key={id} value={id}>{v.name} ({v.language === "en-us" ? "American" : "British"} {v.gender})</option>
              ))}
            </select>
            <label className="text-sm text-gray-600" htmlFor="speed-range">Speed</label>
            <input id="speed-range" type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!workerReady} />
            <input id="speed-number" type="number" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!workerReady} className="w-24 rounded-lg border px-2 py-1" />
            <span className="text-sm text-gray-600">{speed.toFixed(2)}x</span>
            {workerError && <div className="text-sm text-red-600">{workerError}</div>}
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
              <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Autoplay
            </label>
            <div className="flex items-center gap-2 ml-4">
              <label className="text-sm text-gray-600" htmlFor="crossfade-range">Crossover</label>
              <input id="crossfade-range" type="range" min={0} max={300} step={10} value={crossfadeMs} onChange={(e) => setCrossfadeMs(Number(e.target.value))} />
              <span className="text-sm text-gray-600">{crossfadeMs}ms</span>
            </div>
          </div>
          <div className="relative">
            <audio ref={audioARef} className={`w-full ${activeAudioIndex === 0 ? "" : "hidden"}`} controls preload="auto">
              <track kind="captions" label="TTS audio A" />
            </audio>
            <audio ref={audioBRef} className={`w-full ${activeAudioIndex === 1 ? "" : "hidden"}`} controls preload="auto">
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
              <div key={c.id} className={`rounded-lg border p-3 ${i === playhead ? "border-blue-600" : ""}`}>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>#{i + 1}</span>
                  <span>idx={c.chunkIdx}</span>
                  <span>sent={c.sentenceIdx}</span>
                  <span>piece={c.pieceIdx}</span>
                  <span>off={c.startOffset}-{c.endOffset}</span>
                  <span className="ml-auto">{statusBadge(c.status)}{c.isStreamFinal ? <span className="ml-2 text-purple-600">[EOF]</span> : null}</span>
                </div>
                <div className="mt-1 whitespace-pre-wrap">{c.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function statusBadge(status: UiChunk["status"]) {
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


