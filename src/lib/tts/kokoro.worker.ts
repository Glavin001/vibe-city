import { KokoroTTS } from "kokoro-js";
import { detectWebGPU } from "./worker-utils";

type Device = "webgpu" | "wasm";

// Initialize in an async IIFE so we can use await cleanly in the worker module
(async () => {
  const device: Device = (await detectWebGPU()) ? "webgpu" : "wasm";
  self.postMessage({ status: "device", device });

  try {
    const model_id = "onnx-community/Kokoro-82M-v1.0-ONNX";
    const tts = await KokoroTTS.from_pretrained(model_id, {
      dtype: device === "wasm" ? "q8" : "fp32",
      device,
    });

    self.postMessage({ status: "ready", voices: tts.voices, device });

    self.addEventListener("message", async (e: MessageEvent) => {
      const { type, text, voice, speed, requestId } = (e.data ?? {}) as {
        type?: string;
        text?: string;
        voice?: string;
        speed?: number;
        requestId?: number;
      };
      if (type !== "generate") return;

      try {
        const s = typeof speed === "number" && Number.isFinite(speed) ? speed : undefined;
        const audio = await tts.generate(String(text ?? ""), { voice: voice as unknown as never, speed: s as unknown as never });
        const blob = audio.toBlob();
        const url = URL.createObjectURL(blob);
        self.postMessage({ status: "complete", audio: url, text, requestId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        self.postMessage({ status: "error", error: message, requestId });
      }
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    self.postMessage({ status: "error", error: message });
  }
})();


