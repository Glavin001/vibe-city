import { useSelector } from '@xstate/react';
import { createMachine, assign, ActorRef, Actor } from 'xstate';

export type SpeechRecognitionStatus = 'idle' | 'loading' | 'ready' | 'start' | 'update' | 'complete' | 'error';

export interface SpeechRecognitionInput {
  language?: string;
  onStatusChange?: (status: SpeechRecognitionStatus) => void;
  onTextChange?: (text: string) => void;
  onTextUpdate?: (text: string) => void;
  onTpsChange?: (tps: number) => void;
  onError?: (error: string) => void;
}

export interface ProgressItem {
  file: string;
  progress: number;
  total: number;
}

export interface SpeechRecognitionContext {
  worker: Worker | null;
  status: SpeechRecognitionStatus;
  text: string;
  tps: number | null;
  progressItems: ProgressItem[];
  loadingMessage: string;
  error: string | null;
  language: string;
  loadRequested: boolean;
  onStatusChange?: (status: SpeechRecognitionStatus) => void;
  onTextChange?: (text: string) => void;
  onTextUpdate?: (text: string) => void;
  onTpsChange?: (tps: number) => void;
  onError?: (error: string) => void;
}

export type SpeechRecognitionEvent =
  | { type: 'INIT' }
  | { type: 'LOAD' }
  | { type: 'GENERATE'; audio: Float32Array; language?: string }
  | { type: 'TERMINATE' }
  | { type: 'WORKER_ATTACHED'; worker: Worker }
  // worker-driven events
  | { type: 'WORKER_LOADING' }
  | { type: 'WORKER_READY' }
  | { type: 'WORKER_INITIATE'; item: ProgressItem }
  | { type: 'WORKER_PROGRESS'; item: ProgressItem }
  | { type: 'WORKER_DONE'; file: string }
  | { type: 'WORKER_START' }
  | { type: 'WORKER_UPDATE'; output?: string; tps?: number }
  | { type: 'WORKER_COMPLETE'; output?: string }
  | { type: 'WORKER_ERROR'; error: string };

function createSpeechRecognitionMachine() {
  console.log("[speechRecognition.machine] createSpeechRecognitionMachine");
  return createMachine({
    id: 'speech-recognition',
    types: {
      context: {} as SpeechRecognitionContext,
      events: {} as SpeechRecognitionEvent,
      input: {} as SpeechRecognitionInput,
    },
    context: ({ input }) => ({
      worker: null,
      status: 'idle',
      text: '',
      tps: null,
      progressItems: [],
      loadingMessage: '',
      error: null,
      language: input.language ?? 'en',
      loadRequested: false,
      onStatusChange: input.onStatusChange,
      onTextChange: input.onTextChange,
      onTextUpdate: input.onTextUpdate,
      onTpsChange: input.onTpsChange,
      onError: input.onError,
    }),
    initial: 'boot',
    states: {
      boot: {
        entry: 'ensureWorker',
        on: {
          INIT: { actions: 'ensureWorker' },
          WORKER_ATTACHED: { actions: ['attachWorker', 'postLoadIfRequested'] },
          LOAD: { target: 'loading', actions: ['markLoadRequested', 'ensureWorker', 'postLoadIfReady'] },
        },
      },
      loading: {
        on: {
          WORKER_LOADING: { actions: ['setStatusLoading', 'emitParentLoading', 'notifyLoading'] },
          WORKER_INITIATE: { actions: 'progressInitiate' },
          WORKER_PROGRESS: { actions: 'progressUpdate' },
          WORKER_DONE: { actions: 'progressDone' },
          WORKER_READY: { target: 'ready', actions: ['setStatusReady', 'emitParentReady', 'notifyReady'] },
          WORKER_ERROR: { target: 'error', actions: ['setError', 'emitParentError'] },
          WORKER_ATTACHED: { actions: ['attachWorker', 'postLoadIfRequested'] },
        },
      },
      ready: {
        on: {
          GENERATE: { target: 'generating', actions: 'postGenerate' },
          WORKER_ERROR: { target: 'error', actions: ['setError', 'emitParentError'] },
          LOAD: { target: 'loading', actions: 'postLoad' },
        },
      },
      generating: {
        on: {
          WORKER_START: { actions: ['setStatusStart', 'notifyStart'] },
          WORKER_UPDATE: { actions: ['handleUpdate', 'emitParentUpdate', 'notifyUpdate'] },
          WORKER_COMPLETE: { target: 'ready', actions: ['handleComplete', 'emitParentComplete', 'notifyComplete'] },
          WORKER_ERROR: { target: 'error', actions: ['setError', 'emitParentError', 'notifyError'] },
        },
      },
      error: {
        on: {
          LOAD: { target: 'loading', actions: 'postLoad' },
        },
      },
    },
    on: {
      TERMINATE: { actions: 'terminateWorker' },
    },
  }, {
    actions: {
      ensureWorker: ({ context, self }) => {
        if (typeof window === 'undefined') return;
        if (context.worker) return;
        try {
          console.log("[speechRecognition.machine] ensureWorker new worker");
          const worker = new Worker(new URL('../workers/speech-recognition.worker.ts', import.meta.url), { type: 'module' });
          worker.addEventListener('message', (e: MessageEvent) => {
            const data = e.data || {};
            const msgStatus = data.status as string | undefined;
            const msgError: string | undefined = data.error;
            if (msgError) {
              self.send({ type: 'WORKER_ERROR', error: msgError });
              return;
            }
            switch (msgStatus) {
              case 'loading': self.send({ type: 'WORKER_LOADING' }); break;
              case 'ready': self.send({ type: 'WORKER_READY' }); break;
              case 'initiate': self.send({ type: 'WORKER_INITIATE', item: data as ProgressItem }); break;
              // case 'progress': self.send({ type: 'WORKER_PROGRESS', item: data as ProgressItem }); break;
              case 'done': self.send({ type: 'WORKER_DONE', file: (data as ProgressItem).file }); break;
              case 'start': self.send({ type: 'WORKER_START' }); break;
              case 'update': self.send({ type: 'WORKER_UPDATE', output: data.output, tps: data.tps }); break;
              case 'complete': self.send({ type: 'WORKER_COMPLETE', output: data.output }); break;
              default: break;
            }
          });
          self.send({ type: 'WORKER_ATTACHED', worker });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          self.send({ type: 'WORKER_ERROR', error: errorMessage });
        }
      },
      attachWorker: assign({ worker: ({ event }) => (event as { type: 'WORKER_ATTACHED'; worker: Worker }).worker }),
      terminateWorker: ({ context }) => {
        if (context.worker) {
          try { context.worker.terminate(); } catch {}
          context.worker = null;
        }
      },
      postLoad: ({ context }) => {
        if (!context.worker) return;
        console.log('[speechRecognition.machine] postLoad');
        context.worker.postMessage({ type: 'load' });
      },
      postLoadIfReady: ({ context }) => {
        if (context.worker) {
          console.log('[speechRecognition.machine] postLoadIfReady: worker present');
          context.worker.postMessage({ type: 'load' });
        } else {
          console.log('[speechRecognition.machine] postLoadIfReady: no worker yet');
        }
      },
      postLoadIfRequested: ({ context }) => {
        if (context.loadRequested && context.worker) {
          console.log('[speechRecognition.machine] postLoadIfRequested: posting load');
          context.worker.postMessage({ type: 'load' });
        }
      },
      markLoadRequested: assign({ loadRequested: (_) => true }),
      postGenerate: ({ context, event }) => {
        console.log("[speechRecognition.machine] postGenerate", context.status);
        if (!context.worker) {
          console.warn("[speechRecognition.machine] postGenerate not ready, no worker", context.status);
          return;
        }
        const ev = event as { type: 'GENERATE'; audio: Float32Array; language?: string };
        const language = ev.language ?? context.language;
        context.worker.postMessage({ type: 'generate', data: { audio: ev.audio, language } });
      },
      setStatusLoading: assign(() => ({
        status: 'loading' as SpeechRecognitionStatus,
        loadingMessage: 'Loading model...',
        error: null,
      })),
      emitParentLoading: ({ self }) => {
        // @ts-ignore
        const parent = (self as any).parent as import('xstate').AnyActorRef | undefined;
        parent?.send({ type: 'SPEECH.LOADING' });
      },
      setStatusReady: assign(() => ({
        status: 'ready' as SpeechRecognitionStatus,
        error: null,
      })),
      emitParentReady: ({ self }) => {
        // @ts-ignore
        const parent = (self as any).parent as import('xstate').AnyActorRef | undefined;
        parent?.send({ type: 'SPEECH.READY' });
      },
      setStatusStart: assign(() => ({
        status: 'start' as SpeechRecognitionStatus,
      })),
      handleUpdate: assign(({ context, event }) => {
        const { output, tps } = event as { type: 'WORKER_UPDATE'; output?: string; tps?: number };
        return {
          status: 'update' as SpeechRecognitionStatus,
          text: output ?? context.text,
          tps: typeof tps === 'number' ? tps : context.tps,
        };
      }),
      emitParentUpdate: ({ self, event }) => {
        const { output, tps } = event as { type: 'WORKER_UPDATE'; output?: string; tps?: number };
        // @ts-ignore
        const parent = (self as any).parent as import('xstate').AnyActorRef | undefined;
        parent?.send({ type: 'SPEECH.UPDATE', text: output, tps });
      },
      handleComplete: assign(({ event }) => {
        const { output } = event as { type: 'WORKER_COMPLETE'; output?: string };
        return {
          status: 'complete' as SpeechRecognitionStatus,
          text: output ?? '',
        };
      }),
      emitParentComplete: ({ self, event }) => {
        const { output } = event as { type: 'WORKER_COMPLETE'; output?: string };
        // @ts-ignore
        const parent = (self as any).parent as import('xstate').AnyActorRef | undefined;
        parent?.send({ type: 'SPEECH.COMPLETE', text: output });
      },
      setError: assign(({ event }) => ({
        status: 'error' as SpeechRecognitionStatus,
        error: (event as { type: 'WORKER_ERROR'; error: string }).error,
      })),
      emitParentError: ({ self, event }) => {
        // @ts-ignore
        const parent = (self as any).parent as import('xstate').AnyActorRef | undefined;
        parent?.send({ type: 'SPEECH.ERROR', error: (event as { type: 'WORKER_ERROR'; error: string }).error });
      },
      // External notifications via input callbacks
      notifyLoading: ({ context }) => { context.onStatusChange?.('loading'); },
      notifyReady: ({ context }) => { context.onStatusChange?.('ready'); },
      notifyStart: ({ context }) => { context.onStatusChange?.('start'); },
      notifyUpdate: ({ context, event }) => {
        const { output, tps } = event as { type: 'WORKER_UPDATE'; output?: string; tps?: number };
        context.onStatusChange?.('update');
        if (typeof tps === 'number') context.onTpsChange?.(tps);
        if (typeof output === 'string') context.onTextUpdate?.(output);
      },
      notifyComplete: ({ context, event }) => {
        const { output } = event as { type: 'WORKER_COMPLETE'; output?: string };
        context.onStatusChange?.('complete');
        if (typeof output === 'string') context.onTextChange?.(output);
      },
      notifyError: ({ context, event }) => {
        const err = (event as { type: 'WORKER_ERROR'; error: string }).error;
        context.onStatusChange?.('error');
        context.onError?.(err);
      },
      progressInitiate: assign(({ context, event }) => {
        const { item } = event as { type: 'WORKER_INITIATE'; item: ProgressItem };
        return { progressItems: [...context.progressItems, item] };
      }),
      progressUpdate: assign(({ context, event }) => {
        const { item } = event as { type: 'WORKER_PROGRESS'; item: ProgressItem };
        const next = context.progressItems.map((pi) => (pi.file === item.file ? { ...pi, ...item } : pi));
        return { progressItems: next };
      }),
      progressDone: assign(({ context, event }) => {
        const { file } = event as { type: 'WORKER_DONE'; file: string };
        const next = context.progressItems.filter((pi) => pi.file !== file);
        return { progressItems: next };
      }),
    },
  });
}

export const useSpeechRecognitionStatus = (actor: Actor<ReturnType<typeof createSpeechRecognitionMachine>>) => {
  return useSelector(actor, (s): SpeechRecognitionStatus => {
    const ctx = s.context as unknown as { status?: SpeechRecognitionStatus };
    if (ctx?.status === 'update') return 'update';
    if (ctx?.status === 'complete') return 'complete';
    switch (s.value) {
      case 'boot':
        return 'idle';
      case 'loading':
        return 'loading';
      case 'ready':
        return 'ready';
      case 'generating':
        return 'start';
      case 'error':
        return 'error';
      default: {
        return 'idle';
      }
    }
  });
}

export const speechRecognitionMachine = createSpeechRecognitionMachine();
