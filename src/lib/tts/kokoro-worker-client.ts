export type KokoroDevice = "webgpu" | "wasm" | null;

export type KokoroVoices = Record<string, { name: string; language: string; gender: string }>;

export type KokoroWorkerStatusMessage =
  | { status: "device"; device: string }
  | { status: "ready"; voices: KokoroVoices; device: string }
  | { status: "error"; error: string; requestId?: number }
  | { status: "complete"; audio: string; text: string; requestId?: number };

export type GenerateParams = {
  text: string;
  voice: string;
  speed?: number;
};

export type GenerateResult = {
  url: string;
  text: string;
  requestId: number;
};

// Single fixed worker entry for the whole app; keep it inline so webpack detects it.

/**
 * Minimal, framework-agnostic client for the Kokoro TTS Web Worker.
 * Handles init lifecycle, message routing, request mapping, and teardown.
 */
export class KokoroWorkerClient {
  private worker: Worker | null = null;
  private device: KokoroDevice = null;
  private voices: KokoroVoices = {};
  private ready = false;
  private nextId = 1;
  private reqMap = new Map<number, (res: GenerateResult) => void>();
  private errMap = new Map<number, (err: Error) => void>();
  private onErrorGlobal?: (err: Error) => void;
  private onReadyGlobal?: (voices: KokoroVoices, device: string) => void;
  constructor() {}

  get isReady(): boolean { return this.ready; }
  get currentDevice(): KokoroDevice { return this.device; }
  get currentVoices(): KokoroVoices { return this.voices; }

  /** Create and initialize the worker. Safe to call multiple times; no-op if already active. */
  init(onReady?: (voices: KokoroVoices, device: string) => void, onError?: (err: Error) => void) {
    if (this.worker) return;
    this.onErrorGlobal = onError;
    this.onReadyGlobal = onReady;

    // IMPORTANT: inline new Worker(new URL(...)) so webpack v5 detects worker correctly
    this.worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });

    const handleMessage = (e: MessageEvent<KokoroWorkerStatusMessage>) => {
      const msg = e.data;
      switch (msg.status) {
        case "device":
          this.device = (msg.device as KokoroDevice) ?? null;
          break;
        case "ready":
          this.device = (msg.device as KokoroDevice) ?? null;
          this.voices = msg.voices;
          this.ready = true;
          if (this.onReadyGlobal) this.onReadyGlobal(this.voices, msg.device);
          break;
        case "error": {
          const reqId = msg.requestId;
          const err = new Error(msg.error);
          if (typeof reqId === "number" && this.errMap.has(reqId)) {
            const reject = this.errMap.get(reqId);
            if (!reject) break;
            this.errMap.delete(reqId);
            this.reqMap.delete(reqId);
            reject(err);
          } else if (this.onErrorGlobal) {
            this.onErrorGlobal(err);
          }
          break; }
        case "complete": {
          const reqId = msg.requestId ?? -1;
          const resolve = this.reqMap.get(reqId);
          if (resolve) {
            this.reqMap.delete(reqId);
            this.errMap.delete(reqId);
            resolve({ url: msg.audio, text: msg.text, requestId: reqId });
          }
          break; }
      }
    };

    const handleError = (e: ErrorEvent) => {
      if (this.onErrorGlobal) this.onErrorGlobal(e.error instanceof Error ? e.error : new Error(e.message));
    };

    this.worker.addEventListener("message", handleMessage as EventListener);
    this.worker.addEventListener("error", handleError as EventListener);
  }

  /** Generate a single audio clip. Resolves when the worker responds with a URL. */
  generate({ text, voice, speed }: GenerateParams): Promise<GenerateResult> {
    if (!this.worker || !this.ready) return Promise.reject(new Error("Kokoro worker not ready"));
    const id = this.nextId++;
    return new Promise<GenerateResult>((resolve, reject) => {
      this.reqMap.set(id, resolve);
      this.errMap.set(id, reject);
      const w = this.worker;
      if (!w) {
        this.reqMap.delete(id);
        this.errMap.delete(id);
        reject(new Error("Worker not initialized"));
        return;
      }
      w.postMessage({ type: "generate", text, voice, speed, requestId: id });
    });
  }

  /** Dispose of the worker and pending requests. */
  dispose() {
    if (this.worker) {
      // Reject all inflight requests
      const err = new Error("Worker disposed");
      for (const reject of this.errMap.values()) reject(err);
      this.errMap.clear();
      this.reqMap.clear();

      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.voices = {};
    this.device = null;
  }
}


