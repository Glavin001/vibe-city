"use client";

import { useMachine } from "@xstate/react";
import { kokoroTtsMachine, type SynthesizedUtterance } from "../../machines/kokoroTts.machine";
import { useState, useCallback } from "react";

// Kokoro TTS page powered by XState machine

export default function Page() {
  const [utterances, setUtterances] = useState<SynthesizedUtterance[]>([]);
  const onUtteranceGenerated = useCallback((item: SynthesizedUtterance) => {
    setUtterances((prev) => [item, ...prev]);
  }, []);
  const [state, send] = useMachine(kokoroTtsMachine, { input: { onUtteranceGenerated } });

  const { inputText, selectedSpeaker, voices, device, error, loadingMessage } = state.context;
  const isBoot = state.matches("boot");
  const isReady = state.matches("ready");
  const isGenerating = state.matches("generating");

  // Machine has a root exit action that disposes the worker on unmount.

  const onGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isReady || inputText.trim() === "") return;
    send({ type: "USER.GENERATE" });
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
          {isBoot && (
            <div className="inline-block mt-2 text-sm text-gray-600 bg-gray-100 border rounded px-3 py-1">
              Loading TTS model and voices… Controls are disabled until ready.
            </div>
          )}
        </div>

        <div className="border rounded-xl p-4 space-y-4">
          <form onSubmit={onGenerate} className="space-y-3">
            <textarea
              value={inputText}
              onChange={(e) => send({ type: "USER.SET_TEXT", text: e.target.value })}
              placeholder="Enter text..."
              className="w-full min-h-[100px] rounded-lg border px-3 py-2"
              rows={Math.min(8, inputText.split("\n").length)}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={selectedSpeaker}
                onChange={(e) => send({ type: "USER.SET_VOICE", voice: e.target.value })}
                className="flex-1 rounded-lg border px-3 py-2 disabled:opacity-50"
                disabled={!isReady || Object.keys(voices).length === 0}
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
                disabled={!isReady || inputText.trim() === ""}
              >
                {isGenerating ? "Generating..." : "Generate"}
              </button>
            </div>
          </form>

          {isBoot && (
            <div className="text-sm text-gray-500">{error ?? loadingMessage}</div>
          )}
          {error && !isBoot && (
            <div className="text-sm text-red-600">{error}</div>
          )}
        </div>

        {utterances.length > 0 && (
          <div className="space-y-4">
            {utterances.map((r: SynthesizedUtterance, i: number) => (
              <div key={`${i}-${r.src}`} className="border rounded-xl p-4 space-y-3">
                <div className="text-sm text-gray-500">#{utterances.length - i} · {r.ms} ms</div>
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


