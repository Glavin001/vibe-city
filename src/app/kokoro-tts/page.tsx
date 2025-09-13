"use client";

import { useEffect, useRef, useState } from "react";

type VoiceInfo = {
  name: string;
  language: string;
  gender: string;
};

type WorkerMessage =
  | { status: "device"; device: string }
  | { status: "ready"; voices: Record<string, VoiceInfo>; device: string }
  | { status: "error"; error: string; requestId?: number }
  | { status: "complete"; audio: string; text: string; requestId?: number };

export default function Page() {
  const workerRef = useRef<Worker | null>(null);

  const [inputText, setInputText] = useState(
    "Life is like a box of chocolates. You never know what you're gonna get.",
  );
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>("af_heart");

  const [voices, setVoices] = useState<Record<string, VoiceInfo>>({});
  const [status, setStatus] = useState<"boot" | "ready" | "running">("boot");
  const [device, setDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>("Loading...");

  const [results, setResults] = useState<Array<{ text: string; src: string; ms: number }>>(
    [],
  );
  const pendingStarts = useRef<Map<number, number>>(new Map());
  const nextId = useRef<number>(1);

  useEffect(() => {
    if (workerRef.current) return;
    // Create worker module (bundled by Next/Webpack)
    workerRef.current = new Worker(
      new URL("./kokoro.worker.ts", import.meta.url),
      { type: "module" },
    );

    const onMessage = (e: MessageEvent<WorkerMessage>) => {
      const data = e.data;
      switch (data.status) {
        case "device":
          setDevice(data.device);
          setLoadingMessage(`Loading model (device="${data.device}")`);
          break;
        case "ready":
          setDevice(data.device);
          setVoices(data.voices);
          setStatus("ready");
          // default to first voice if available
          if (data.voices && Object.keys(data.voices).length > 0) {
            const first = Object.keys(data.voices)[0];
            setSelectedSpeaker(first);
          }
          break;
        case "error":
          setError(data.error);
          setStatus("ready");
          break;
        case "complete": {
          const now = performance.now();
          const id = data.requestId ?? 0;
          const start = pendingStarts.current.get(id) ?? now;
          const ms = Math.max(0, Math.round(now - start));
          pendingStarts.current.delete(id);
          setResults((prev) => [{ text: data.text, src: data.audio, ms }, ...prev]);
          setStatus("ready");
          break; }
      }
    };

    const onError = (e: ErrorEvent) => {
      // eslint-disable-next-line no-console
      console.error("Worker error:", e);
      setError(e.message);
    };

    workerRef.current.addEventListener("message", onMessage as EventListener);
    workerRef.current.addEventListener("error", onError as EventListener);

    return () => {
      if (!workerRef.current) return;
      workerRef.current.removeEventListener(
        "message",
        onMessage as EventListener,
      );
      workerRef.current.removeEventListener("error", onError as EventListener);
      workerRef.current.terminate();
      workerRef.current = null;
    };
  }, []);

  const onGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerRef.current) return;
    const text = inputText.trim();
    if (text === "") return;
    setStatus("running");
    const id = nextId.current++;
    pendingStarts.current.set(id, performance.now());
    workerRef.current.postMessage({ type: "generate", text, voice: selectedSpeaker, requestId: id });
  };

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Kokoro Text-to-Speech</h1>
          <p className="text-gray-500">
            Powered by <a className="underline" href="https://github.com/hexgrad/kokoro" target="_blank" rel="noreferrer">Kokoro</a>
            {" "}and{" "}
            <a className="underline" href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer">Transformers.js</a>
            {device ? ` — device: ${device}` : ""}
          </p>
        </div>

        <div className="border rounded-xl p-4 space-y-4">
          <form onSubmit={onGenerate} className="space-y-3">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Enter text..."
              className="w-full min-h-[100px] rounded-lg border px-3 py-2"
              rows={Math.min(8, inputText.split("\n").length)}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedSpeaker}
                onChange={(e) => setSelectedSpeaker(e.target.value)}
                className="flex-1 rounded-lg border px-3 py-2"
              >
                {Object.entries(voices).map(([id, v]) => (
                  <option key={id} value={id}>
                    {v.name} ({v.language === "en-us" ? "American" : "British"} {v.gender})
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="rounded-lg px-4 py-2 text-white bg-blue-600 disabled:opacity-50"
                disabled={status === "running" || inputText.trim() === ""}
              >
                {status === "running" ? "Generating..." : "Generate"}
              </button>
            </div>
          </form>

          {status === "boot" && (
            <div className="text-sm text-gray-500">{error ?? loadingMessage}</div>
          )}
          {error && status !== "boot" && (
            <div className="text-sm text-red-600">{error}</div>
          )}
        </div>

        {results.length > 0 && (
          <div className="space-y-4">
            {results.map((r, i) => (
              <div key={`${i}-${r.src}`} className="border rounded-xl p-4 space-y-3">
                <div className="text-sm text-gray-500">#{results.length - i} · {r.ms} ms</div>
                <p>{r.text}</p>
                <audio controls src={r.src} className="w-full">
                  <track kind="captions" label="Generated speech" />
                  Your browser does not support the audio element.
                </audio>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


