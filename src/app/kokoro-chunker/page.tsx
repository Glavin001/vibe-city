"use client";

import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { kokoroChunkerMachine, type UiChunk } from "../../machines/kokoroChunker.machine";
import { inspect } from "@/machines/inspector";

const defaultSoftPunct = String(/[,;:—–\-]/).slice(1, -1);

export default function Page() {
  const audioARef = useRef<HTMLAudioElement>(null);
  const audioBRef = useRef<HTMLAudioElement>(null);
  const [progressRatio, setProgressRatio] = useState<number>(0);
  const aChunkIdRef = useRef<number | null>(null);
  const bChunkIdRef = useRef<number | null>(null);
  const cancelCrossfadeRef = useRef<(() => void) | null>(null);
  const isCrossfadingRef = useRef<boolean>(false);

  const getByIndex = useCallback((index: 0 | 1) => (index === 0 ? audioARef.current : audioBRef.current), []);
  const setElementChunkId = useCallback((el: HTMLAudioElement | null, chunkId: number | null) => {
    if (!el) return;
    if (el === audioARef.current) aChunkIdRef.current = chunkId;
    if (el === audioBRef.current) bChunkIdRef.current = chunkId;
  }, []);

  const [state, send] = useMachine(kokoroChunkerMachine, {
    inspect,
    input: {
      onAudioPlay: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => {
        console.log('onAudioPlay', audioUrl, chunkId, preferredPlayerIndex);
        // Machine indicates which player index to use
        const el = preferredPlayerIndex != null ? getByIndex(preferredPlayerIndex) : audioARef.current;
        if (!el) return;
        try { el.preload = "auto"; } catch {}
        if (el.src !== audioUrl) el.src = audioUrl;
        setElementChunkId(el, chunkId);
        el.play().then(() => {
          send({ type: 'AUDIO_STARTED', chunkId });
        }).catch((error) => {
          console.error('Audio play failed:', error);
          send({ type: 'UI.SET_AUTOPLAY', autoplay: false });
        });
      },
      onAudioPause: () => {
        // Pause both if needed; machine will resume the correct one
        const a = audioARef.current; const b = audioBRef.current;
        if (a && !a.paused) a.pause();
        if (b && !b.paused) b.pause();
      },
      onAudioStop: () => {
        const a = audioARef.current;
        const b = audioBRef.current;
        if (a) { try { a.pause(); } catch {}; try { a.currentTime = 0; } catch {}; }
        if (b) { try { b.pause(); } catch {}; try { b.currentTime = 0; } catch {}; }
        if (cancelCrossfadeRef.current) { cancelCrossfadeRef.current(); cancelCrossfadeRef.current = null; }
      },
      onAudioPreload: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => {
        console.log('onAudioPreload', audioUrl, chunkId, preferredPlayerIndex);
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
        console.log('onCrossfadeStart', { currentChunkId, nextChunkId, durationMs, nextUrl, nextPlayerIndex });
        const idle = getByIndex(nextPlayerIndex);
        const active = getByIndex(nextPlayerIndex === 0 ? 1 : 0);
        if (!active || !idle) return;
        isCrossfadingRef.current = true;
        if (idle.src !== nextUrl) {
          idle.preload = 'auto';
          idle.src = nextUrl;
          try { if (idle.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) idle.load(); } catch {}
        }
        setElementChunkId(idle, nextChunkId);
        try { idle.volume = 0; } catch {}
        idle.play().then(() => {
          send({ type: 'AUDIO_STARTED', chunkId: nextChunkId });
        }).catch(() => {
          send({ type: 'UI.SET_AUTOPLAY', autoplay: false });
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
          isCrossfadingRef.current = false;
        };
      },
      onCrossfadeCancel: () => {
        console.log('onCrossfadeCancel');
        if (cancelCrossfadeRef.current) { cancelCrossfadeRef.current(); cancelCrossfadeRef.current = null; }
        isCrossfadingRef.current = false;
      },
    }
  });

  const {
    inputText,
    cursor,
    autoStream,
    pushSize,
    chunkerOptions,
    uiChunks,
    voices,
    device,
    selectedVoice,
    speed,
    playhead,
    autoplay,
    crossfadeMs,
    activePlayerIndex,
    error,
    loadingMessage,
  } = state.context;

  const isBoot = state.matches("boot");
  const isReady = state.matches("ready");
  const isAutoStreaming = state.matches("ready.autoStreaming");
  const remainingChars = Math.max(0, inputText.length - cursor);

  useEffect(() => {
    console.log('UI Chunks updated:', uiChunks.map(c => ({ id: c.id, status: c.status })));
  }, [uiChunks]);

  // Set up audio event listeners for both elements
  useEffect(() => {
    const wire = (el: HTMLAudioElement | null) => {
      if (!el) return () => {};
      const onEnded = () => {
        console.log('onEnded', el);
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) send({ type: 'AUDIO_ENDED', chunkId: id });
        setProgressRatio(0);
        isCrossfadingRef.current = false;
      };
      const onPlay = () => {
        console.log('onPlay', el);
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) send({ type: 'AUDIO_STARTED', chunkId: id });
      };
      const onPause = () => {
        console.log('onPause', el);
        if (el.ended) return;
        const id = el === audioARef.current ? aChunkIdRef.current : bChunkIdRef.current;
        if (id != null) send({ type: 'AUDIO_PAUSED', chunkId: id });
      };
      const onTimeUpdate = () => {
        // console.log('onTimeUpdate', el);
        const dur = el.duration || 0;
        const cur = el.currentTime || 0;
        const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
        setProgressRatio(ratio);
        send({ type: 'AUDIO_PROGRESS', currentTime: cur, duration: dur });
      };
      el.addEventListener('ended', onEnded);
      el.addEventListener('play', onPlay);
      el.addEventListener('pause', onPause);
      el.addEventListener('timeupdate', onTimeUpdate);
      return () => {
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('play', onPlay);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('timeupdate', onTimeUpdate);
      };
    };
    const offA = wire(audioARef.current);
    const offB = wire(audioBRef.current);
    return () => { offA && offA(); offB && offB(); };
  }, [send]);

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Kokoro Chunker TTS</h1>
          <p className="text-gray-500">
            Stream text → sentence chunking → sequential TTS. {device ? `Device: ${device}` : "Booting..."}
          </p>
          {isBoot && (
            <div className="inline-block mt-2 text-sm text-gray-600 bg-gray-100 border rounded px-3 py-1">
              {error ?? loadingMessage}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-xl p-4 space-y-4">
            <h2 className="text-lg font-semibold">Input & Streaming</h2>
            <textarea
              value={inputText}
              onChange={(e) => send({ type: 'UI.SET_TEXT', text: e.target.value })}
              className="w-full min-h-[180px] rounded-lg border px-3 py-2"
              placeholder="Type or paste text..."
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-gray-600" htmlFor="push-size">Push size</label>
              <input
                type="number"
                id="push-size"
                value={pushSize}
                min={8}
                max={2000}
                step={8}
                onChange={(e) => send({ type: 'UI.SET_PUSH_SIZE', pushSize: Math.max(1, Number(e.target.value) || 1) })}
                className="w-24 rounded-lg border px-2 py-1"
                disabled={!isReady}
              />
              <button type="button" onClick={() => send({ type: 'UI.PUSH_CHUNK' })} className="rounded-lg px-3 py-2 bg-blue-600 text-white disabled:opacity-50" disabled={!isReady}>Push</button>
              <button type="button" onClick={() => send({ type: isAutoStreaming ? 'UI.STOP_AUTO_STREAM' : 'UI.START_AUTO_STREAM' })} className="rounded-lg px-3 py-2 bg-indigo-600 text-white disabled:opacity-50" disabled={!isReady}>
                {isAutoStreaming ? "Stop auto" : "Auto stream"}
              </button>
              <button type="button" onClick={() => send({ type: 'UI.FLUSH_CHUNKS' })} className="rounded-lg px-3 py-2 bg-emerald-600 text-white disabled:opacity-50" disabled={!isReady}>Flush</button>
              <button type="button" onClick={() => send({ type: 'UI.RESET_ALL' })} className="rounded-lg px-3 py-2 bg-gray-600 text-white disabled:opacity-50" disabled={!isReady}>Reset</button>
              <div className="text-sm text-gray-500 ml-auto">Remaining: {remainingChars}</div>
            </div>
          </div>

          <div className="border rounded-xl p-4 space-y-4">
            <h2 className="text-lg font-semibold">Chunker Options</h2>
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center gap-2">
                <span className="w-28 text-sm text-gray-600">Locale</span>
                <input value={chunkerOptions.locale} onChange={(e) => send({ type: 'UI.SET_CHUNKER_LOCALE', locale: e.target.value })} className="flex-1 rounded-lg border px-2 py-1" disabled={!isReady} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={chunkerOptions.charEnabled} onChange={(e) => send({ type: 'UI.SET_CHUNKER_CHAR_ENABLED', enabled: e.target.checked })} disabled={!isReady} />
                <span className="w-28 text-sm text-gray-600">charLimit</span>
                <input type="number" value={chunkerOptions.charLimit} min={16} max={2000} step={16} onChange={(e) => send({ type: 'UI.SET_CHUNKER_CHAR_LIMIT', limit: Math.max(1, Number(e.target.value) || 1) })} className="flex-1 rounded-lg border px-2 py-1" disabled={!isReady || !chunkerOptions.charEnabled} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={chunkerOptions.wordEnabled} onChange={(e) => send({ type: 'UI.SET_CHUNKER_WORD_ENABLED', enabled: e.target.checked })} disabled={!isReady} />
                <span className="w-28 text-sm text-gray-600">wordLimit</span>
                <input type="number" value={chunkerOptions.wordLimit} min={1} max={100} step={1} onChange={(e) => send({ type: 'UI.SET_CHUNKER_WORD_LIMIT', limit: Math.max(1, Number(e.target.value) || 1) })} className="flex-1 rounded-lg border px-2 py-1" disabled={!isReady || !chunkerOptions.wordEnabled} />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-28 text-sm text-gray-600">softPunct</span>
                <input value={chunkerOptions.softPunctSrc} onChange={(e) => send({ type: 'UI.SET_CHUNKER_SOFT_PUNCT', softPunctSrc: e.target.value })} className="flex-1 rounded-lg border px-2 py-1" disabled={!isReady} />
              </label>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600" htmlFor="voice-select">Voice</label>
                <select id="voice-select" value={selectedVoice} onChange={(e) => send({ type: 'UI.SET_VOICE', voice: e.target.value })} disabled={!isReady || Object.keys(voices).length === 0} className="flex-1 rounded-lg border px-3 py-2">
                  {Object.entries(voices).map(([id, v]) => (
                    <option key={id} value={id}>{v.name} ({v.language === "en-us" ? "American" : "British"} {v.gender})</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600" htmlFor="speed-range">Speed</label>
                <input
                  id="speed-range"
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => send({ type: 'UI.SET_SPEED', speed: Number(e.target.value) })}
                  className="flex-1"
                  disabled={!isReady}
                />
                <input
                  id="speed-number"
                  aria-label="Speed number"
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => send({ type: 'UI.SET_SPEED', speed: Number(e.target.value) })}
                  className="w-24 rounded-lg border px-2 py-1"
                  disabled={!isReady}
                />
                <span className="text-sm text-gray-600">{speed.toFixed(2)}x</span>
              </div>
              {error && !isBoot && (
                <div className="text-sm text-red-600">{error}</div>
              )}
            </div>
          </div>
        </div>

        <div className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Player</h2>
            <button type="button" onClick={() => send({ type: 'UI.PLAY' })} className="rounded-lg px-3 py-2 bg-blue-600 text-white">Play</button>
            <button type="button" onClick={() => send({ type: 'UI.PAUSE' })} className="rounded-lg px-3 py-2 bg-gray-600 text-white">Pause</button>
            <button type="button" onClick={() => send({ type: 'UI.STOP' })} className="rounded-lg px-3 py-2 bg-gray-700 text-white">Stop</button>
            <button type="button" onClick={() => send({ type: 'UI.SKIP' })} className="rounded-lg px-3 py-2 bg-amber-600 text-white">Skip</button>
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={autoplay} onChange={(e) => send({ type: 'UI.SET_AUTOPLAY', autoplay: e.target.checked })} /> Autoplay
            </label>
            <div className="flex items-center gap-2 ml-4">
              <label className="text-sm text-gray-600" htmlFor="crossfade-range">Crossover</label>
              <input id="crossfade-range" type="range" min={0} max={3000} step={10} value={crossfadeMs} onChange={(e) => send({ type: 'UI.SET_CROSSFADE', crossfadeMs: Number(e.target.value) })} />
              <span className="text-sm text-gray-600">{crossfadeMs}ms</span>
            </div>
          </div>
          <div className="relative">
            <span className="mr-3">activePlayerIndex={activePlayerIndex}</span>
            <span className="mr-3">A chunkId={aChunkIdRef.current ?? '—'}</span>
            <audio ref={audioARef} className={`w-full`} controls preload="auto">
              <track kind="captions" label="TTS audio A" />
            </audio>
            <span>B chunkId={bChunkIdRef.current ?? '—'}</span>
            <audio ref={audioBRef} className={`w-full`} controls preload="auto">
              <track kind="captions" label="TTS audio B" />
            </audio>
          </div>
        </div>

        <div className="border rounded-xl p-4 space-y-2">
          <h2 className="text-lg font-semibold">Chunks</h2>
          <div className="space-y-2 max-h-[50vh] overflow-auto pr-2">
            {uiChunks.length === 0 && (
              <div className="text-sm text-gray-500">No chunks yet. Start streaming input.</div>
            )}
            {uiChunks.map((c, i) => (
              <div key={c.id} className={`rounded-lg border p-3 ${i === playhead ? "border-blue-600" : ""}`}>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>#{i + 1}</span>
                  <span>idx={c.chunkIdx}</span>
                  <span>sent={c.sentenceIdx}</span>
                  <span>piece={c.pieceIdx}</span>
                  <span>off={c.startOffset}-{c.endOffset}</span>
                  <span className="ml-auto">
                    <StatusBadge status={c.status} />
                    {c.isStreamFinal ? <span className="ml-2 text-purple-600">[EOF]</span> : null}
                  </span>
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

function StatusBadge({ status }: { status: UiChunk["status"] }) {
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