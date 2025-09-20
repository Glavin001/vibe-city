import { createMachine, assign } from 'xstate';
import type { AnyActorRef } from 'xstate';

export interface AudioRecorderInput {
  sampleRate?: number;
  mimeType?: string;
  dataRequestInterval?: number; // ms
}

export interface AudioRecorderContext {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  chunks: Blob[];
  sampleRate: number;
  mimeType: string;
  dataRequestInterval: number;
  dataIntervalId: number | null;
  error: string | null;
}

export type AudioRecorderEvent =
  | { type: 'ACQUIRE' }
  | { type: 'ACQUIRED'; stream: MediaStream }
  | { type: 'ACQUIRE_FAILED'; error: string }
  | { type: 'PREPARED'; recorder: MediaRecorder }
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'RESET' }
  | { type: 'REQUEST_DATA' }
  | { type: 'DATA_AVAILABLE'; blob: Blob }
  | { type: 'RECORDER_STOPPED' }
  | { type: 'ERROR'; error: string };

export type AudioRecorderState =
  | { value: 'idle'; context: AudioRecorderContext }
  | { value: 'acquiring'; context: AudioRecorderContext }
  | { value: 'preparing'; context: AudioRecorderContext }
  | { value: 'ready'; context: AudioRecorderContext }
  | { value: 'recording'; context: AudioRecorderContext }
  | { value: 'error'; context: AudioRecorderContext };

function createAudioRecorderMachine() {
  return createMachine({
    types: {
      context: {} as AudioRecorderContext,
      events: {} as AudioRecorderEvent,
      input: {} as AudioRecorderInput,
    },
    id: 'audio-recorder',
    context: ({ input }) => ({
      stream: null,
      recorder: null,
      chunks: [],
      sampleRate: input.sampleRate ?? 16000,
      mimeType: input.mimeType ?? 'audio/webm',
      dataRequestInterval: input.dataRequestInterval ?? 250,
      dataIntervalId: null,
      error: null,
    }),
    initial: 'acquiring',
    states: {
      acquiring: {
        entry: 'requestStream',
        on: {
          ACQUIRED: {
            target: 'preparing',
            actions: [
              assign({ stream: ({ event }) => (event as { type: 'ACQUIRED'; stream: MediaStream }).stream }),
              'emitParentAcquired',
            ],
          },
          ACQUIRE_FAILED: {
            target: 'error',
            actions: assign({ error: ({ event }) => (event as { type: 'ACQUIRE_FAILED'; error: string }).error }),
          },
        },
      },
      preparing: {
        entry: 'prepareRecorder',
        on: {
          PREPARED: {
            target: 'ready',
            actions: assign({ recorder: ({ event }) => (event as { type: 'PREPARED'; recorder: MediaRecorder }).recorder }),
          },
          ERROR: {
            target: 'error',
            actions: assign({ error: ({ event }) => (event as { type: 'ERROR'; error: string }).error }),
          },
        },
      },
      ready: {
        on: {
          START: 'recording',
          RESET: {
            actions: assign({ chunks: (_) => [] }),
          },
          STOP: {
            // no-op
          },
        },
      },
      recording: {
        entry: ['startRecorder', 'startDataInterval'],
        exit: ['clearDataInterval'],
        on: {
          STOP: {
            target: 'ready',
            actions: 'stopRecorder',
          },
          REQUEST_DATA: {
            actions: 'requestDataNow',
          },
          DATA_AVAILABLE: {
            actions: ['appendChunk', 'emitParentData'],
          },
          RECORDER_STOPPED: {
            target: 'ready',
          },
          ERROR: {
            target: 'error',
            actions: assign({ error: ({ event }) => (event as { type: 'ERROR'; error: string }).error }),
          },
        },
      },
      error: {
        on: {
          ACQUIRE: 'acquiring',
        },
      },
    },
  }, {
    actions: {
      requestStream: ({ self }) => {
        try {
          if (!navigator.mediaDevices?.getUserMedia) {
            self.send({ type: 'ACQUIRE_FAILED', error: 'getUserMedia not supported in this browser!' });
            return;
          }
          navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then((stream) => {
              self.send({ type: 'ACQUIRED', stream });
            })
            .catch((err) => {
              const errorMessage = err instanceof Error ? err.message : String(err);
              self.send({ type: 'ACQUIRE_FAILED', error: errorMessage });
            });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          self.send({ type: 'ACQUIRE_FAILED', error: errorMessage });
        }
      },
      prepareRecorder: ({ context, self }) => {
        try {
          if (!context.stream) {
            self.send({ type: 'ERROR', error: 'No stream available' });
            return;
          }
          const recorder = new MediaRecorder(context.stream, { mimeType: context.mimeType });
          recorder.onstart = () => { /* no-op; state handles */ };
          recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) {
              self.send({ type: 'DATA_AVAILABLE', blob: e.data });
            }
          };
          recorder.onstop = () => {
            self.send({ type: 'RECORDER_STOPPED' });
          };
          recorder.onerror = (ev: Event) => {
            const messageMaybe = (ev as unknown as { error?: { message?: unknown } }).error?.message;
            const errorMessage = typeof messageMaybe === 'string' && messageMaybe.length > 0
              ? messageMaybe
              : 'Unknown recording error';
            self.send({ type: 'ERROR', error: errorMessage });
          };
          self.send({ type: 'PREPARED', recorder });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          self.send({ type: 'ERROR', error: errorMessage });
        }
      },
      startRecorder: ({ context }) => {
        if (context.recorder && context.recorder.state !== 'recording') {
          context.recorder.start();
        }
      },
      stopRecorder: ({ context }) => {
        if (context.recorder && context.recorder.state === 'recording') {
          context.recorder.stop();
        }
      },
      startDataInterval: assign(({ context }) => {
        if (context.dataIntervalId) {
          window.clearInterval(context.dataIntervalId);
        }
        const id = window.setInterval(() => {
          if (context.recorder && context.recorder.state === 'recording') {
            try {
              context.recorder.requestData();
            } catch {
              // ignore
            }
          }
        }, context.dataRequestInterval);
        return { dataIntervalId: id as unknown as number };
      }),
      clearDataInterval: assign(({ context }) => {
        if (context.dataIntervalId) {
          window.clearInterval(context.dataIntervalId);
        }
        return { dataIntervalId: null };
      }),
      requestDataNow: ({ context }) => {
        if (context.recorder && context.recorder.state === 'recording') {
          try {
            context.recorder.requestData();
          } catch {
            // ignore
          }
        }
      },
      appendChunk: assign(({ context, event }) => {
        const blob = (event as { type: 'DATA_AVAILABLE'; blob: Blob }).blob;
        const newChunks = [...context.chunks, blob];
        return { chunks: newChunks };
      }),
      emitParentData: ({ context, self }) => {
        try {
          const last = context.chunks[context.chunks.length - 1] || null;
          // @ts-ignore
          const parent = (self as any).parent as AnyActorRef | undefined;
          if (parent && last) {
            parent.send({ type: 'REC.DATA', blob: last, chunkCount: context.chunks.length });
          }
        } catch {}
      },
      emitParentAcquired: ({ context, self }) => {
        try {
          // @ts-ignore
          const parent = (self as any).parent as AnyActorRef | undefined;
          if (parent && context.stream) {
            parent.send({ type: 'REC.ACQUIRED', stream: context.stream });
          }
        } catch {}
      },
      
    },
  });
}

export const audioRecorderMachine = createAudioRecorderMachine();
