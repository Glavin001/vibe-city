import { createMachine, assign } from 'xstate';

export interface WhisperLocalContext {
  isProcessing: boolean;
  finalizing: boolean;
  segmentStartIndex: number;
  lastDecodedChunkCount: number;
  headerChunk: Blob | null;
}

export type WhisperLocalEvent =
  | { type: 'SET_PROCESSING'; value: boolean }
  | { type: 'SET_FINALIZING'; value: boolean }
  | { type: 'SET_SEGMENT_START'; index: number }
  | { type: 'SET_LAST_DECODED_COUNT'; count: number }
  | { type: 'SET_HEADER_CHUNK'; blob: Blob | null }
  | { type: 'RESET_SEGMENT' };

export function createWhisperLocalMachine() {
  return createMachine({
    types: {
      context: {} as WhisperLocalContext,
      events: {} as WhisperLocalEvent,
    },
    id: 'whisper-local',
    context: {
      isProcessing: false,
      finalizing: false,
      segmentStartIndex: 0,
      lastDecodedChunkCount: 0,
      headerChunk: null,
    },
    initial: 'active',
    states: {
      active: {
        on: {
          SET_PROCESSING: { actions: assign(({ event }) => ({ isProcessing: (event as { type: 'SET_PROCESSING'; value: boolean }).value })) },
          SET_FINALIZING: { actions: assign(({ event }) => ({ finalizing: (event as { type: 'SET_FINALIZING'; value: boolean }).value })) },
          SET_SEGMENT_START: { actions: assign(({ event }) => ({ segmentStartIndex: (event as { type: 'SET_SEGMENT_START'; index: number }).index })) },
          SET_LAST_DECODED_COUNT: { actions: assign(({ event }) => ({ lastDecodedChunkCount: (event as { type: 'SET_LAST_DECODED_COUNT'; count: number }).count })) },
          SET_HEADER_CHUNK: { actions: assign(({ event }) => ({ headerChunk: (event as { type: 'SET_HEADER_CHUNK'; blob: Blob | null }).blob })) },
          RESET_SEGMENT: { actions: assign(() => ({ segmentStartIndex: 0, lastDecodedChunkCount: 0, headerChunk: null })) },
        },
      },
    },
  });
}


