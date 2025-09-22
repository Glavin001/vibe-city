import { assign, createMachine } from 'xstate';
import type { Actor } from 'xstate';
import { SentenceStreamChunker, type Chunk, type SentenceStreamChunkerOptions } from '../lib/sentence-stream-chunker/sentence-stream-chunker';

export interface SentenceChunkerContext {
  chunker: SentenceStreamChunker | null;
  options: SentenceStreamChunkerOptions;
  chunks: Chunk[];
}

export type SentenceChunkerEvent =
  | { type: 'INIT'; options?: SentenceStreamChunkerOptions }
  | { type: 'PUSH'; text: string; eos?: boolean }
  | { type: 'FLUSH' }
  | { type: 'RESET'; options?: SentenceStreamChunkerOptions }
  | { type: 'CHUNKS_EMITTED'; chunks: Chunk[] };

export interface SentenceChunkerInput {
  options?: SentenceStreamChunkerOptions;
}

function createSentenceChunkerMachine() {
  return createMachine({
    id: 'sentence-chunker',
    types: {
      context: {} as SentenceChunkerContext,
      events: {} as SentenceChunkerEvent,
      input: {} as SentenceChunkerInput,
    },
    context: ({ input }) => ({
      chunker: null,
      options: input?.options ?? {
        locale: 'en',
        charLimit: 120,
        wordLimit: Number.POSITIVE_INFINITY,
        softPunct: /[,;:—–\-]/,
      },
      chunks: [],
    }),
    initial: 'idle',
    states: {
      idle: {
        on: {
          INIT: {
            target: 'ready',
            actions: 'initializeChunker',
          },
        },
      },
      ready: {
        on: {
          PUSH: {
            actions: ['pushText', 'emitChunks'],
          },
          FLUSH: {
            actions: ['flushChunks', 'emitChunks'],
          },
          RESET: {
            actions: 'resetChunker',
          },
        },
      },
    },
    on: {
      CHUNKS_EMITTED: {
        actions: assign(({ context, event }) => ({
          chunks: [...context.chunks, ...event.chunks],
        })),
      },
    },
  }, {
    actions: {
      initializeChunker: assign(({ context, event }) => {
        const options = event.type === 'INIT' && event.options ? event.options : context.options;
        return {
          chunker: new SentenceStreamChunker(options),
          options,
          chunks: [],
        };
      }),
      pushText: ({ context, event, self }) => {
        if (event.type !== 'PUSH' || !context.chunker) return;
        const chunks = context.chunker.push(event.text, { eos: event.eos });
        if (chunks.length > 0) {
          self.send({ type: 'CHUNKS_EMITTED', chunks });
        }
      },
      flushChunks: ({ context, self }) => {
        if (!context.chunker) return;
        const chunks = context.chunker.flush();
        if (chunks.length > 0) {
          self.send({ type: 'CHUNKS_EMITTED', chunks });
        }
      },
      resetChunker: assign(({ context, event }) => {
        const options = event.type === 'RESET' && event.options ? event.options : context.options;
        return {
          chunker: new SentenceStreamChunker(options),
          options,
          chunks: [],
        };
      }),
      emitChunks: () => {}, // No-op, handled by CHUNKS_EMITTED
    },
  });
}

export type SentenceChunkerActor = Actor<ReturnType<typeof createSentenceChunkerMachine>>;

export const sentenceChunkerMachine = createSentenceChunkerMachine();
