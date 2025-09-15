/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

// Speech recognition Web Worker for Whisper (Transformers.js)
// Loads model artifacts inside the worker and performs generation on demand.

import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  full,
  type ProgressCallback,
  type ProgressInfo,
} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/whisper-base';
const MAX_NEW_TOKENS = 64;
const SAMPLING_RATE = 16000;

let tokenizer: AutoTokenizer | null = null;
let processor: AutoProcessor | null = null;
type GenerativeModel = { generate: (args: any) => Promise<any> };
let model: GenerativeModel | null = null;
let isLoading = false;

const progressCallback: ProgressCallback = (progress: ProgressInfo) => {
  // Mirror the same shape the main thread expects
  // initiate | progress | done
  // We simply forward progress events to the main thread
  (self as unknown as Worker).postMessage({ ...progress });
};

async function ensureModelLoaded(): Promise<void> {
  if (tokenizer && processor && model) return;
  if (isLoading) {
    // Wait until another load finishes
    // Simple polling to avoid adding extra synchronization
    // eslint-disable-next-line no-constant-condition
    while (isLoading) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return;
  }
  isLoading = true;
  try {
    // Inform main thread that loading started
    (self as unknown as Worker).postMessage({ status: 'loading' });
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    });

    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: progressCallback,
    });

    // Prefer WebGPU; if unavailable inside worker, transformers will throw.
    // You can change to 'wasm' as a fallback if needed.
    model = (await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, {
      dtype: {
        encoder_model: 'fp32',
        decoder_model_merged: 'q4',
      },
      device: 'webgpu',
      progress_callback: progressCallback,
    })) as unknown as GenerativeModel;

    // Warm up to compile shaders
    await model.generate({
      // @ts-ignore - tensor helper from transformers.js
      input_features: full([1, 80, 3000], 0.0),
      max_new_tokens: 1,
    });

    // Inform main thread the model is ready
    (self as unknown as Worker).postMessage({ status: 'ready' });
  } finally {
    isLoading = false;
  }
}

async function handleGenerate(audio: Float32Array, _language?: string): Promise<void> {
  await ensureModelLoaded();

  if (!tokenizer || !processor || !model) {
    (self as unknown as Worker).postMessage({ status: 'error', error: 'Model not initialized' });
    return;
  }

  (self as unknown as Worker).postMessage({ status: 'start' });

  try {
    // Prepare inputs
    // @ts-expect-error processor has dynamic call signature in transformers.js
    const processed = await processor(audio, { sampling_rate: SAMPLING_RATE });
    // Narrow processed type fields safely
    const input_features = (processed as { input_features?: unknown; inputs?: { input_features?: unknown } })
      .input_features ?? processed?.inputs?.input_features;

    const t0 = performance.now();

    // Run generation
    const output = await model.generate({
      // @ts-ignore - library typing differences
      input_features,
      max_new_tokens: MAX_NEW_TOKENS,
      // Whisper language control can be handled via special tokens; let model auto-detect if not set.
      // Passing language hint via config if supported in future versions.
      // language,
    });

    const t1 = performance.now();

    // Decode output tokens
    // Support both return forms (tensor or object with sequences)
    const sequences: unknown = (output && (output as any).sequences) ? (output as any).sequences : output;
    const tokenIds: number[] = Array.isArray(sequences)
      ? (sequences as number[])
      : (sequences as { data?: ArrayLike<number> })?.data
      ? Array.from((sequences as { data: ArrayLike<number> }).data)
      : [];

    let text = '';
    if (tokenizer) {
      try {
        // Prefer batch_decode to handle arrays
        const decoded = (tokenizer as any).batch_decode
          ? (tokenizer as any).batch_decode([tokenIds], { skip_special_tokens: true })
          : (tokenizer as any).decode(tokenIds, { skip_special_tokens: true });
        text = Array.isArray(decoded) ? decoded[0] ?? '' : decoded ?? '';
      } catch {
        // Fallback: string from token IDs length
        text = '';
      }
    }

    const dtSec = Math.max((t1 - t0) / 1000, 1e-6);
    const tps = tokenIds.length / dtSec;

    (self as unknown as Worker).postMessage({ status: 'complete', output: text, tps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({ status: 'error', error: message });
  }
}

self.addEventListener('message', (e: MessageEvent) => {
  const { type, data } = e.data || {};

  switch (type) {
    case 'load': {
      // Trigger model loading; progress/ready will be sent asynchronously
      ensureModelLoaded();
      break;
    }
    case 'generate': {
      const audio: Float32Array | undefined = data?.audio;
      const language: string | undefined = data?.language;
      if (!audio) {
        (self as unknown as Worker).postMessage({ status: 'error', error: 'No audio provided' });
        return;
      }
      // Fire and forget; errors are reported back via postMessage
      handleGenerate(audio, language);
      break;
    }
    case 'progress': {
      // Optional: the main thread may forward progress events; ignore or log
      // console.debug('[Worker] progress (forwarded)', data);
      break;
    }
    default: {
      // Unknown command
      // console.debug('[Worker] unknown message type', type);
      break;
    }
  }
});

export {};


