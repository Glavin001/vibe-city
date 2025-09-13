"use client";

import { useMemo, useState } from "react";
import { useMicVAD, utils } from "@ricky0123/vad-react";

type Segment = {
  id: number;
  url: string;
  samples: number;
  seconds: number;
  bytes: number;
  createdAt: number;
};

export default function Page() {
  const [threshold, setThreshold] = useState<number>(0.6);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [nextId, setNextId] = useState<number>(1);

  const onSpeechEnd = useMemo(
    () =>
      (audio: Float32Array) => {
        try {
          const wavBuffer = utils.encodeWAV(audio, 1, 16000, 1, 16);
          const blob = new Blob([wavBuffer], { type: "audio/wav" });
          const url = URL.createObjectURL(blob);
          const id = nextId;
          const seconds = audio.length / 16000;
          const bytes = blob.size;
          setNextId((n) => n + 1);
          setSegments((prev) => [
            {
              id,
              url,
              samples: audio.length,
              seconds,
              bytes,
              createdAt: Date.now(),
            },
            ...prev,
          ]);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("Failed to encode WAV: ", e);
        }
      },
    [nextId],
  );

  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    userSpeakingThreshold: threshold,
    // Serve assets from '/vad/' within public
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    onSpeechEnd,
  });

  const clearSegments = () => {
    segments.forEach((s) => { URL.revokeObjectURL(s.url); });
    setSegments([]);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Voice Activity Detection</h1>
          <p className="text-gray-500">
            Browser VAD powered by <a className="underline" href="https://docs.vad.ricky0123.com/user-guide/react/" target="_blank" rel="noreferrer">@ricky0123/vad-react</a> and <a className="underline" href="https://docs.vad.ricky0123.com/user-guide/browser/" target="_blank" rel="noreferrer">@ricky0123/vad-web</a>.
          </p>
        </div>

        <div className="border rounded-xl p-4 space-y-4">
          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={vad.toggle}
                disabled={vad.loading || !!vad.errored}
                className="rounded-lg px-4 py-2 text-white bg-blue-600 disabled:opacity-50"
              >
                {vad.loading ? "Loading..." : vad.listening ? "Pause" : "Start"}
              </button>

              <button
                type="button"
                onClick={clearSegments}
                className="rounded-lg px-4 py-2 border"
                disabled={segments.length === 0}
              >
                Clear
              </button>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-3">
              <label htmlFor="threshold" className="text-sm text-gray-600">
                Speaking threshold
              </label>
              <input
                id="threshold"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
              />
              <span className="tabular-nums text-sm text-gray-700">
                {threshold.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <StatusPill color={vad.listening ? "green" : "gray"}>
              {vad.listening ? "Listening" : "Idle"}
            </StatusPill>
            <StatusPill color={vad.userSpeaking ? "amber" : "gray"}>
              {vad.userSpeaking ? "User is speaking" : "No speech"}
            </StatusPill>
            {vad.errored && (
              <span className="text-red-600">Error: {vad.errored}</span>
            )}
          </div>
        </div>

        {/* Captured segments */}
        {segments.length > 0 && (
          <div className="space-y-4">
            {segments.map((seg, i) => (
              <div key={seg.id} className="border rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
                  <div>#{segments.length - i}</div>
                  <div>
                    {seg.seconds.toFixed(2)}s · {formatBytes(seg.bytes)} · 16 kHz
                  </div>
                  <div>{new Date(seg.createdAt).toLocaleTimeString()}</div>
                </div>
                <audio controls src={seg.url} className="w-full">
                  <track kind="captions" label="Recorded speech" />
                  Your browser does not support the audio element.
                </audio>
                <div className="flex gap-2">
                  <a
                    className="rounded-lg px-3 py-1 border text-sm"
                    href={seg.url}
                    download={`segment-${seg.id}.wav`}
                  >
                    Download WAV
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Guidance */}
        <div className="text-sm text-gray-500">
          Models and worklet are fetched from the CDN by default; for custom hosting, see the browser guide and API docs.
        </div>
      </div>
    </div>
  );
}

function StatusPill(
  props: { color: "green" | "amber" | "gray"; children: React.ReactNode },
) {
  const colorClass =
    props.color === "green"
      ? "bg-green-100 text-green-800"
      : props.color === "amber"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-800";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded ${colorClass}`}>
      {props.children}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} kB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}


