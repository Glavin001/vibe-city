import { createMachine, assign, fromPromise, sendTo } from 'xstate';
import { createAudioRecorderMachine } from './audioRecorder.machine';
import { createSpeechRecognitionMachine } from './speechRecognition.machine';

export interface WhisperOrchestratorInput {
  language?: string;
  maxRecentChunks?: number;
}

export interface WhisperOrchestratorContext {
  language: string;
  stream: MediaStream | null;
  headerChunk: Blob | null;
  segmentStartIndex: number;
  lastDecodedCount: number;
  error: string | null;
}

type Ev =
  | { type: 'LOAD_MODEL' }
  | { type: 'USER.START_REC' }
  | { type: 'USER.STOP_REC' }
  | { type: 'FINALIZE' }
  | { type: 'REC.ACQUIRED'; stream: MediaStream }
  | { type: 'REC.DATA'; blob: Blob; chunkCount: number }
  | { type: 'SPEECH.READY' }
  | { type: 'SPEECH.ERROR'; error: string }
  | { type: 'SPEECH.COMPLETE'; text?: string }
  | { type: 'PROCESS.DONE'; audio: Float32Array; chunkCount: number }
  | { type: 'PROCESS.ERROR' };

export function createWhisperOrchestratorMachine() {
  return createMachine({
    types: { context: {} as WhisperOrchestratorContext, events: {} as Ev, input: {} as WhisperOrchestratorInput },
    id: 'whisper-orchestrator',
    context: ({ input }) => ({
      language: input.language ?? 'en',
      stream: null,
      headerChunk: null,
      segmentStartIndex: 0,
      lastDecodedCount: 0,
      error: null,
    }),
    initial: 'boot',
    states: {
      boot: {
        invoke: [
          { id: 'rec', src: createAudioRecorderMachine() },
          { id: 'speech', src: createSpeechRecognitionMachine() },
        ],
        on: {
          'REC.ACQUIRED': { actions: assign({ stream: ({ event }) => (event as any).stream }) },
          LOAD_MODEL: { actions: sendTo('speech', { type: 'LOAD' }), target: 'waitingReady' },
        },
      },
      waitingReady: {
        on: {
          'SPEECH.READY': 'ready',
          'SPEECH.ERROR': { target: 'error', actions: assign({ error: ({ event }) => (event as any).error }) },
        },
      },
      ready: {
        on: {
          'USER.START_REC': { actions: sendTo('rec', { type: 'START' }), target: 'listening' },
          'SPEECH.ERROR': { target: 'error', actions: assign({ error: ({ event }) => (event as any).error }) },
        },
      },
      listening: {
        on: {
          'REC.DATA': [
            {
              guard: ({ context }) => context.headerChunk == null,
              actions: assign({ headerChunk: ({ event }) => (event as any).blob }),
            },
            {
              guard: ({ context, event }) => (event as any).chunkCount > context.lastDecodedCount,
              target: 'processing',
            },
          ],
          'USER.STOP_REC': { actions: sendTo('rec', { type: 'STOP' }), target: 'ready' },
          FINALIZE: 'finalizing',
        },
      },
      processing: {
        invoke: {
          src: fromPromise(async ({ context, input }) => {
            const MAX_RECENT_CHUNKS = input?.maxRecentChunks ?? 12;
            // Note: we do not have the chunk list here; parent must call this service with buffers.
            // In this simplified orchestrator, we just signal failure to avoid blocking. The
            // full integration requires passing chunks via an actor or shared store.
            throw new Error('processAudio requires chunk access; to be integrated');
          }),
          onDone: {
            actions: [
              sendTo('speech', ({ event, context }) => ({ type: 'GENERATE', audio: (event.output as any).audio, language: context.language })),
              assign(({ context, event }) => ({ lastDecodedCount: (event.output as any).chunkCount ?? context.lastDecodedCount })),
            ],
            target: 'listening',
          },
          onError: { target: 'listening' },
        },
      },
      finalizing: {
        // Similar to processing but building full segment
        always: 'listening',
      },
      error: {},
    },
  });
}


