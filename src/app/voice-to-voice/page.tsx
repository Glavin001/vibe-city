"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceSegments } from "../../hooks/use-voice-segments";
import { SentenceStreamChunker } from "../../lib/sentence-stream-chunker/sentence-stream-chunker";
import { KokoroWorkerClient } from "../../lib/tts/kokoro-worker-client";

type VoiceInfo = {
  name: string;
  language: string;
  gender: string;
};

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
  // Integrated voice segments (VAD + Whisper)
  const [vadThreshold, setVadThreshold] = useState<number>(0.6);
  const {
    status: vsStatus,
    liveText,
    // lastFinalText not used directly; handled via onSegment → pushText
    vadListening,
    vadUserSpeaking,
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
    onLiveUpdate: (text) => {
        console.log("[useVoiceSegments] onLiveUpdate", text);
    },
    onSegment: (text) => {
        console.log("[useVoiceSegments] onSegment", text);
        pushText(text, true);
        // Resume autoplay after a completed segment
        setAutoplay(true);
        setIsUserPaused(false);
    },
    onInterruption: () => { // pause player on interruption
      console.log("[useVoiceSegments] onInterruption");
      const audio = audioRef.current;
      if (audio && !audio.paused) audio.pause();
      setAutoplay(false);
      setIsUserPaused(true);
    },
  });

  // Chunker
  const chunkerRef = useRef<SentenceStreamChunker | null>(null);
  const nextUiIdRef = useRef<number>(1);
  const resetChunker = useCallback(() => {
    chunkerRef.current = new SentenceStreamChunker({
      locale: "en",
      charLimit: 220,
      wordLimit: Number.POSITIVE_INFINITY,
      softPunct: /[,;:—–\-]/,
    });
  }, []);

  useEffect(() => {
    resetChunker();
  }, [resetChunker]);

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
    if (!chunkerRef.current) resetChunker();
    const ck = chunkerRef.current;
    if (!ck) return;
    const newChunks = ck.push(s, { eos });
    if (newChunks.length > 0) {
      setUiChunks((prev) => [...prev, ...newChunks.map(toUiChunk)]);
    }
  }, [resetChunker, toUiChunk]);

  // Kokoro TTS worker
  const workerClientRef = useRef<KokoroWorkerClient | null>(null);
  const [voices, setVoices] = useState<Record<string, VoiceInfo>>({});
  const [selectedVoice, setSelectedVoice] = useState<string>("af_heart");
  const [speed, setSpeed] = useState<number>(1.0);
  const [device, setDevice] = useState<string | null>(null);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [workerReady, setWorkerReady] = useState<boolean>(false);

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

  // Playback & generation queue
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [autoplay, setAutoplay] = useState<boolean>(true);
  const [playhead, setPlayhead] = useState<number>(0);
  const [isUserPaused, setIsUserPaused] = useState<boolean>(false);
  const genBusyRef = useRef<boolean>(false);
  const queueNextGenerationRef = useRef<() => void>(() => {});

  const sendGenerate = useCallback((chunk: UiChunk) => {
    const client = workerClientRef.current;
    if (!client || !workerReady) return false;
    const voiceId = selectedVoice && voices[selectedVoice] ? selectedVoice : Object.keys(voices)[0];
    if (!voiceId) {
      setWorkerError("No voice available. Please wait for voices to load.");
      return false;
    }
    setUiChunks((prev) => prev.map((c) => (c.id === chunk.id ? { ...c, status: "generating" } : c)));
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

  useEffect(() => {
    queueNextGeneration();
  }, [queueNextGeneration]);

  useEffect(() => {
    queueNextGenerationRef.current = queueNextGeneration;
  }, [queueNextGeneration]);

  // Audio events & progress tracking
  const progressRatioRef = useRef<number>(0);
  const [, forceTick] = useState<number>(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      setUiChunks((prev) => prev.map((c, i) => (i === playhead ? { ...c, status: "played" } : c)));
      setPlayhead((p) => p + 1);
      setIsUserPaused(false);
      progressRatioRef.current = 0;
      forceTick((t) => t + 1);
    };
    const onPlay = () => {
      setIsUserPaused(false);
    };
    const onPauseEvent = () => {
      if (audio.ended) return;
      setIsUserPaused(true);
      setUiChunks((prev) => prev.map((c, i) => (i === playhead && c.status === "playing" ? { ...c, status: "paused" } : c)));
    };
    const onTimeUpdate = () => {
      const dur = audio.duration || 0;
      const cur = audio.currentTime || 0;
      progressRatioRef.current = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
      forceTick((t) => t + 1);
    };
    const onLoadedMeta = () => {
      forceTick((t) => t + 1);
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPauseEvent);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMeta);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPauseEvent);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMeta);
    };
  }, [playhead]);

  // Autoplay next ready chunk
  useEffect(() => {
    if (!autoplay || isUserPaused) return;
    const audio = audioRef.current;
    if (!audio) return;
    const current = uiChunks[playhead];
    if (!current) return;
    if (current.status === "ready" && current.audioUrl) {
      audio.src = current.audioUrl;
      audio.play().then(() => {
        setUiChunks((prev) => prev.map((c, i) => (i === playhead ? { ...c, status: "playing" } : c)));
      }).catch(() => {
        setAutoplay(false);
        setIsUserPaused(true);
      });
    } else if (current.status === "paused" && current.audioUrl) {
      if (audio.src !== current.audioUrl) {
        audio.src = current.audioUrl;
      }
      audio.play().then(() => {
        setUiChunks((prev) => prev.map((c, i) => (i === playhead ? { ...c, status: "playing" } : c)));
      }).catch(() => {
        setAutoplay(false);
        setIsUserPaused(true);
      });
    } else if (current.status === "played" || current.status === "skipped") {
      setPlayhead((p) => p + 1);
    }
  }, [autoplay, isUserPaused, playhead, uiChunks]);

  // lastFinalText is already pushed via onSegment; liveText shown in UI

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

  const clearAll = () => {
    onStop();
    setUiChunks([]);
    setPlayhead(0);
    nextUiIdRef.current = 1;
    resetChunker();
  };

  // Spoken vs remaining text (approximate for current chunk using audio progress)
  const { spokenText, remainingText } = useMemo(() => {
    const before = uiChunks.slice(0, playhead).filter((c) => c.status === "played").map((c) => c.text).join(" ");
    const current = uiChunks[playhead];
    let currentSpoken = "";
    let currentRemain = "";
    if (current && (current.status === "playing" || current.status === "paused" || current.status === "ready")) {
      const ratio = progressRatioRef.current || 0;
      const text = current.text || "";
      const split = Math.max(0, Math.min(text.length, Math.round(text.length * ratio)));
      currentSpoken = text.slice(0, split);
      currentRemain = text.slice(split);
    }
    const after = uiChunks.slice(playhead + 1).map((c) => c.text).join(" ");
    return {
      spokenText: [before, currentSpoken].filter(Boolean).join(" "),
      remainingText: [currentRemain, after].filter(Boolean).join(" "),
    };
  }, [playhead, uiChunks]);

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
          </div>
          <audio ref={audioRef} className="w-full" controls>
            <track kind="captions" label="TTS audio" />
          </audio>
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


