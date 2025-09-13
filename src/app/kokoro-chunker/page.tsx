"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chunk } from "../../lib/sentence-stream-chunker/sentence-stream-chunker";
import { SentenceStreamChunker } from "../../lib/sentence-stream-chunker/sentence-stream-chunker";
import { KokoroWorkerClient } from "../../lib/tts/kokoro-worker-client";

type VoiceInfo = {
  name: string;
  language: string;
  gender: string;
};

// WorkerMessage type moved to KokoroWorkerClient; keeping local VoiceInfo.

type UiChunk = {
  id: number; // local id (monotonic)
  chunkIdx: number; // from chunker
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

const defaultSoftPunct = String(/[,;:—–\-]/).slice(1, -1);

export default function Page() {
  // Text input and streaming simulator
  const [inputText, setInputText] = useState<string>(
    "Paste or type a long paragraph here. Then use 'Push' to simulate streaming input, chunk it, and hear sequential TTS playback."
  );
  const [cursor, setCursor] = useState<number>(0); // where we've streamed up to
  const [autoStream, setAutoStream] = useState<boolean>(false);
  const [pushSize, setPushSize] = useState<number>(96);
  const autoTimerRef = useRef<number | null>(null);

  // Chunker options
  const [locale, setLocale] = useState<string>("en");
  const [charEnabled, setCharEnabled] = useState<boolean>(true);
  const [charLimit, setCharLimit] = useState<number>(220);
  const [wordEnabled, setWordEnabled] = useState<boolean>(false);
  const [wordLimit, setWordLimit] = useState<number>(45);
  const [softPunctSrc, setSoftPunctSrc] = useState<string>(defaultSoftPunct);

  const softPunct: RegExp = useMemo(() => {
    try {
      return new RegExp(softPunctSrc);
    } catch {
      return /[,;:—–\-]/;
    }
  }, [softPunctSrc]);

  const chunkerRef = useRef<SentenceStreamChunker | null>(null);
  const resetChunker = useCallback(() => {
    chunkerRef.current = new SentenceStreamChunker({
      locale,
      charLimit: charEnabled ? charLimit : Number.POSITIVE_INFINITY,
      wordLimit: wordEnabled ? wordLimit : Number.POSITIVE_INFINITY,
      softPunct,
    });
  }, [locale, charEnabled, charLimit, wordEnabled, wordLimit, softPunct]);

  // Build/refresh chunker when options change (also runs on mount)
  useEffect(() => {
    resetChunker();
  }, [resetChunker]);

  // TTS worker
  const workerClientRef = useRef<KokoroWorkerClient | null>(null);
  const [voices, setVoices] = useState<Record<string, VoiceInfo>>({});
  const [selectedVoice, setSelectedVoice] = useState<string>("af_heart");
  const [speed, setSpeed] = useState<number>(1.0);
  const [device, setDevice] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState<boolean>(false);

  // Playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [playhead, setPlayhead] = useState<number>(0); // index in uiChunks
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);

  // Chunk state
  const nextIdRef = useRef<number>(1);
  const [uiChunks, setUiChunks] = useState<UiChunk[]>([]);
  const requestToChunkId = useRef<Map<number, number>>(new Map());
  const genBusyRef = useRef<boolean>(false);

  // Keep a ref to the latest queueNextGeneration to avoid re-subscribing worker handlers
  const queueNextGenerationRef = useRef<() => void>(() => {});

  // Initialize reusable worker client
  useEffect(() => {
    if (workerClientRef.current) return;
    const client = new KokoroWorkerClient();
    workerClientRef.current = client;
    client.init((v, d) => {
      setVoices(v);
      setDevice(d);
      setWorkerReady(true);
      if (v && Object.keys(v).length > 0) setSelectedVoice(Object.keys(v)[0]);
    }, (err) => {
      setWorkerError(err.message);
    });
    return () => {
      client.dispose();
      workerClientRef.current = null;
    };
  }, []);

  // Ensure we always have a valid selected voice once voices are available
  useEffect(() => {
    const ids = Object.keys(voices);
    if (!workerReady || ids.length === 0) return;
    if (!selectedVoice || !voices[selectedVoice]) {
      setSelectedVoice(ids[0]);
    }
  }, [voices, selectedVoice, workerReady]);

  // (defined after queueNextGeneration to avoid use-before-define lint)

  // Generation control
  const sendGenerate = useCallback((chunk: UiChunk) => {
    const client = workerClientRef.current;
    if (!client || !workerReady) return false;
    const voiceId = selectedVoice && voices[selectedVoice] ? selectedVoice : Object.keys(voices)[0];
    if (!voiceId) {
      setWorkerError("No voice available. Please wait for voices to load.");
      return false;
    }
    const requestId = Math.floor(performance.now() + Math.random());
    requestToChunkId.current.set(requestId, chunk.id);
    setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "generating", requestId } : c)));
    client.generate({ text: chunk.text, voice: voiceId, speed })
      .then(({ url }) => {
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "ready", audioUrl: url } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      })
      .catch((err) => {
        setWorkerError(err.message);
        setUiChunks((prev) => prev.map((c) => (c.id === chunk.id && c.status === "generating" ? { ...c, status: "error" } : c)));
        genBusyRef.current = false;
        queueNextGenerationRef.current();
      });
    return true;
  }, [selectedVoice, speed, workerReady, voices]);

  const queueNextGeneration = useCallback(() => {
    if (genBusyRef.current) return;
    const next = uiChunks.find((c) => c.status === "pending");
    if (!next) return;
    genBusyRef.current = true;
    sendGenerate(next);
  }, [sendGenerate, uiChunks]);

  // Whenever chunks change, ensure generation is running
  useEffect(() => {
    queueNextGeneration();
  }, [queueNextGeneration]);

  // Keep the latest generator enqueuer accessible to worker handlers
  useEffect(() => {
    queueNextGenerationRef.current = queueNextGeneration;
  }, [queueNextGeneration]);

  // Playback autoplay: play next ready chunk at or after playhead
  useEffect(() => {
    if (!autoplay || isUserPaused) return;
    const audio = audioRef.current;
    if (!audio) return;

    const current = uiChunks[playhead];
    if (!current) return;

    if (current.status === "ready" && current.audioUrl) {
      // Start playing this chunk
      audio.src = current.audioUrl;
      audio.play().then(() => {
        setUiChunks((prev) => prev.map((c, i) => (i === playhead ? { ...c, status: "playing" } : c)));
      }).catch(() => {
        // Autoplay may be blocked; switch off autoplay
        setAutoplay(false);
        setIsUserPaused(true);
      });
    } else if (current.status === "played" || current.status === "skipped") {
      // advance
      setPlayhead((p) => p + 1);
    }
  }, [autoplay, isUserPaused, playhead, uiChunks]);

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      setUiChunks((prev) => prev.map((c, i) => (i === playhead ? { ...c, status: "played" } : c)));
      setPlayhead((p) => p + 1);
      // Ensure we remain in autoplay state
      setIsUserPaused(false);
    };
    const onPlay = () => {
      setIsUserPaused(false);
    };
    const onPauseEvent = () => {
      // Ignore pause events that are a result of reaching the end of the track
      if (audio.ended) return;
      setIsUserPaused(true);
      setUiChunks((prev) => prev.map((c, i) => (i === playhead && c.status === "playing" ? { ...c, status: "paused" } : c)));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPauseEvent);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPauseEvent);
    };
  }, [playhead]);

  // Map chunk to UI model
  const toUiChunk = useCallback((c: Chunk): UiChunk => {
    const id = nextIdRef.current++;
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

  // Stream push helpers
  const pushText = useCallback((s: string, eos: boolean = false) => {
    if (!chunkerRef.current) resetChunker();
    const ck = chunkerRef.current;
    if (!ck) return;
    const newChunks = ck.push(s, { eos });
    if (newChunks.length > 0) {
      setUiChunks((prev) => [
        ...prev,
        ...newChunks.map(toUiChunk)
      ]);
    }
  }, [resetChunker, toUiChunk]);

  const onPushChunk = useCallback(() => {
    const end = Math.min(inputText.length, cursor + Math.max(1, pushSize));
    const part = inputText.slice(cursor, end);
    const eos = end >= inputText.length;
    setCursor(end);
    if (part) pushText(part, eos);
  }, [cursor, inputText, pushSize, pushText]);

  const onFlush = useCallback(() => {
    // Mark end-of-stream for whatever remains in the chunker buffer
    if (!chunkerRef.current) return;
    const ck = chunkerRef.current;
    const flushed = ck.flush();
    if (flushed.length > 0) {
      setUiChunks((prev) => ([...prev, ...flushed.map(toUiChunk)]));
    } else {
      // If nothing flushed, mark last as stream-final by design of chunker
      // Nothing to do here since flush handles flagging last emitted chunk when needed
    }
  }, [toUiChunk]);

  // Auto-streamer loop
  useEffect(() => {
    if (!autoStream) {
      if (autoTimerRef.current) {
        window.clearInterval(autoTimerRef.current);
        autoTimerRef.current = null;
      }
      return;
    }
    if (autoTimerRef.current) return;
    autoTimerRef.current = window.setInterval(() => {
      if (cursor >= inputText.length) {
        onFlush();
        setAutoStream(false);
        return;
      }
      onPushChunk();
    }, 300) as unknown as number;
    return () => {
      if (autoTimerRef.current) {
        window.clearInterval(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  }, [autoStream, cursor, inputText.length, onFlush, onPushChunk]);

  // Controls
  const onPlay = () => {
    setAutoplay(true);
    setIsUserPaused(false);
    const audio = audioRef.current;
    if (!audio) return;
    const current = uiChunks[playhead];
    if (current?.audioUrl) {
      audio.src = current.audioUrl;
      audio.play().catch(() => {
        setAutoplay(false);
        setIsUserPaused(true);
      });
    }
  };

  const onPause = () => {
    const audio = audioRef.current;
    setIsUserPaused(true);
    if (audio && !audio.paused) audio.pause();
  };

  const onStop = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsUserPaused(true);
    setAutoplay(false);
  };

  const onSkip = () => {
    const audio = audioRef.current;
    if (audio && !audio.paused) audio.pause();
    setUiChunks((prev) => prev.map((c, i) => (i === playhead && (c.status === "playing" || c.status === "paused") ? { ...c, status: "skipped" } : c)));
    setPlayhead((p) => p + 1);
  };

  const onResetAll = () => {
    // Reset everything
    onStop();
    setUiChunks([]);
    setPlayhead(0);
    setCursor(0);
    requestToChunkId.current.clear();
    genBusyRef.current = false;
    resetChunker();
  };

  const remainingChars = Math.max(0, inputText.length - cursor);

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-5xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Kokoro Chunker TTS</h1>
          <p className="text-gray-500">
            Stream text → sentence chunking → sequential TTS. {device ? `Device: ${device}` : "Booting..."}
          </p>
          {!workerReady && (
            <div className="inline-block mt-2 text-sm text-gray-600 bg-gray-100 border rounded px-3 py-1">
              Loading TTS model and voices… Controls are disabled until ready.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded-xl p-4 space-y-4">
            <h2 className="text-lg font-semibold">Input & Streaming</h2>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
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
                onChange={(e) => setPushSize(Math.max(1, Number(e.target.value) || 1))}
                className="w-24 rounded-lg border px-2 py-1"
                disabled={!workerReady}
              />
              <button type="button" onClick={onPushChunk} className="rounded-lg px-3 py-2 bg-blue-600 text-white disabled:opacity-50" disabled={!workerReady}>Push</button>
              <button type="button" onClick={() => setAutoStream((v) => !v)} className="rounded-lg px-3 py-2 bg-indigo-600 text-white disabled:opacity-50" disabled={!workerReady}>
                {autoStream ? "Stop auto" : "Auto stream"}
              </button>
              <button type="button" onClick={onFlush} className="rounded-lg px-3 py-2 bg-emerald-600 text-white disabled:opacity-50" disabled={!workerReady}>Flush</button>
              <button type="button" onClick={onResetAll} className="rounded-lg px-3 py-2 bg-gray-600 text-white disabled:opacity-50" disabled={!workerReady}>Reset</button>
              <div className="text-sm text-gray-500 ml-auto">Remaining: {remainingChars}</div>
            </div>
          </div>

          <div className="border rounded-xl p-4 space-y-4">
            <h2 className="text-lg font-semibold">Chunker Options</h2>
            <div className="grid grid-cols-1 gap-3">
              <label className="flex items-center gap-2">
                <span className="w-28 text-sm text-gray-600">Locale</span>
                <input value={locale} onChange={(e) => setLocale(e.target.value)} className="flex-1 rounded-lg border px-2 py-1" disabled={!workerReady} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={charEnabled} onChange={(e) => setCharEnabled(e.target.checked)} disabled={!workerReady} />
                <span className="w-28 text-sm text-gray-600">charLimit</span>
                <input type="number" value={charLimit} min={16} max={2000} step={16} onChange={(e) => setCharLimit(Math.max(1, Number(e.target.value) || 1))} className="flex-1 rounded-lg border px-2 py-1" disabled={!workerReady || !charEnabled} />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={wordEnabled} onChange={(e) => setWordEnabled(e.target.checked)} disabled={!workerReady} />
                <span className="w-28 text-sm text-gray-600">wordLimit</span>
                <input type="number" value={wordLimit} min={1} max={100} step={1} onChange={(e) => setWordLimit(Math.max(1, Number(e.target.value) || 1))} className="flex-1 rounded-lg border px-2 py-1" disabled={!workerReady || !wordEnabled} />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-28 text-sm text-gray-600">softPunct</span>
                <input value={softPunctSrc} onChange={(e) => setSoftPunctSrc(e.target.value)} className="flex-1 rounded-lg border px-2 py-1" disabled={!workerReady} />
              </label>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600" htmlFor="voice-select">Voice</label>
                <select id="voice-select" value={selectedVoice} onChange={(e) => setSelectedVoice(e.target.value)} disabled={!workerReady || Object.keys(voices).length === 0} className="flex-1 rounded-lg border px-3 py-2">
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
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="flex-1"
                  disabled={!workerReady}
                />
                <input
                  id="speed-number"
                  aria-label="Speed number"
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-24 rounded-lg border px-2 py-1"
                  disabled={!workerReady}
                />
                <span className="text-sm text-gray-600">{speed.toFixed(2)}x</span>
              </div>
              {workerError && <div className="text-sm text-red-600">{workerError}</div>}
            </div>
          </div>
        </div>

        <div className="border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Player</h2>
            <button type="button" onClick={onPlay} className="rounded-lg px-3 py-2 bg-blue-600 text-white">Play</button>
            <button type="button" onClick={onPause} className="rounded-lg px-3 py-2 bg-gray-600 text-white">Pause</button>
            <button type="button" onClick={onStop} className="rounded-lg px-3 py-2 bg-gray-700 text-white">Stop</button>
            <button type="button" onClick={onSkip} className="rounded-lg px-3 py-2 bg-amber-600 text-white">Skip</button>
            <label className="ml-auto flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={autoplay} onChange={(e) => setAutoplay(e.target.checked)} /> Autoplay
            </label>
          </div>
          <audio ref={audioRef} className="w-full" controls>
            <track kind="captions" label="TTS audio" />
          </audio>
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


