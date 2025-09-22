import { assign, createMachine, fromPromise } from 'xstate';
import type { Actor } from 'xstate';
import { SentenceStreamChunker, type Chunk } from '../lib/sentence-stream-chunker/sentence-stream-chunker';
import { KokoroWorkerClient, type KokoroVoices } from '../lib/tts/kokoro-worker-client';

export type UiChunkStatus = "pending" | "generating" | "ready" | "playing" | "paused" | "played" | "error" | "skipped";

export interface UiChunk {
  id: number;
  chunkIdx: number;
  sentenceIdx: number;
  pieceIdx: number;
  text: string;
  isSentenceFinal: boolean;
  isStreamFinal: boolean;
  startOffset: number;
  endOffset: number;
  status: UiChunkStatus;
  audioUrl?: string;
  requestId?: number;
}

export interface KokoroChunkerContext {
  // Text input and streaming
  inputText: string;
  cursor: number;
  autoStream: boolean;
  pushSize: number;

  // Chunker options
  chunkerOptions: {
    locale: string;
    charEnabled: boolean;
    charLimit: number;
    wordEnabled: boolean;
    wordLimit: number;
    softPunctSrc: string;
  };

  // Chunking
  chunker: SentenceStreamChunker | null;

  // UI chunks
  uiChunks: UiChunk[];
  nextChunkId: number;

  // TTS state
  client: KokoroWorkerClient | null;
  voices: KokoroVoices;
  device: string | null;
  selectedVoice: string;
  speed: number;
  error: string | null;
  loadingMessage: string;

  // Playback
  playhead: number;
  autoplay: boolean;
  isUserPaused: boolean;
  crossfadeMs: number;
  isPlaying: boolean;

  // Callbacks
  onUtteranceGenerated?: (chunk: UiChunk) => void;
  onAudioPlay?: (audioUrl: string, chunkId: number) => void;
  onAudioPause?: () => void;
  onAudioStop?: () => void;
}

export type KokoroChunkerEvent =
  // UI Events
  | { type: 'UI.SET_TEXT'; text: string }
  | { type: 'UI.SET_CURSOR'; cursor: number }
  | { type: 'UI.SET_AUTO_STREAM'; autoStream: boolean }
  | { type: 'UI.SET_PUSH_SIZE'; pushSize: number }
  | { type: 'UI.SET_CHUNKER_LOCALE'; locale: string }
  | { type: 'UI.SET_CHUNKER_CHAR_ENABLED'; enabled: boolean }
  | { type: 'UI.SET_CHUNKER_CHAR_LIMIT'; limit: number }
  | { type: 'UI.SET_CHUNKER_WORD_ENABLED'; enabled: boolean }
  | { type: 'UI.SET_CHUNKER_WORD_LIMIT'; limit: number }
  | { type: 'UI.SET_CHUNKER_SOFT_PUNCT'; softPunctSrc: string }
  | { type: 'UI.SET_VOICE'; voice: string }
  | { type: 'UI.SET_SPEED'; speed: number }
  | { type: 'UI.SET_AUTOPLAY'; autoplay: boolean }
  | { type: 'UI.SET_CROSSFADE'; crossfadeMs: number }
  | { type: 'UI.PUSH_CHUNK' }
  | { type: 'UI.FLUSH_CHUNKS' }
  | { type: 'UI.PLAY' }
  | { type: 'UI.PAUSE' }
  | { type: 'UI.STOP' }
  | { type: 'UI.SKIP' }
  | { type: 'UI.RESET_ALL' }
  | { type: 'UI.START_AUTO_STREAM' }
  | { type: 'UI.STOP_AUTO_STREAM' }

  // Internal events
  | { type: 'CHUNKS_EMITTED'; chunks: UiChunk[] }
  | { type: 'GENERATE_TTS'; chunkId: number; text: string }
  | { type: 'WORKER.READY'; voices: KokoroVoices; device: string }
  | { type: 'WORKER.ERROR'; error: string }
  | { type: 'TTS_READY'; voices: KokoroVoices; device: string }
  | { type: 'TTS_DONE'; chunkId: number; url: string; text: string; ms: number }
  | { type: 'TTS_ERROR'; error: string }
  | { type: 'AUDIO_ENDED'; chunkId: number }
  | { type: 'AUDIO_STARTED'; chunkId: number }
  | { type: 'AUDIO_PAUSED'; chunkId: number }
  | { type: 'AUDIO_RESUMED'; chunkId: number };

function createKokoroChunkerMachine() {
  return createMachine({
    id: 'kokoro-chunker',
    types: {
      context: {} as KokoroChunkerContext,
      events: {} as KokoroChunkerEvent,
      input: {} as KokoroChunkerInput,
    },
    context: ({ input }) => {
      console.log('createKokoroChunkerMachine called with input', input);
      // Chunker options
      const chunkerOptions = {
        locale: 'en',
        charEnabled: true,
        charLimit: 120,
        wordEnabled: true,
        wordLimit: 10,
        softPunctSrc: String(/[,;:—–\-]/).slice(1, -1),
      };

      return {
        // Text input and streaming
        inputText: "Paste or type a long paragraph here. Then use 'Push' to simulate streaming input, chunk it, and hear sequential TTS playback.",
        cursor: 0,
        autoStream: false,
        pushSize: 96,

        // Chunker options
        chunkerOptions,

        // Chunking
        chunker: new SentenceStreamChunker({
          locale: chunkerOptions.locale,
          charLimit: chunkerOptions.charEnabled ? chunkerOptions.charLimit : Number.POSITIVE_INFINITY,
          wordLimit: chunkerOptions.wordEnabled ? chunkerOptions.wordLimit : Number.POSITIVE_INFINITY,
          softPunct: new RegExp(chunkerOptions.softPunctSrc),
        }),

        // UI chunks
        uiChunks: [],
        nextChunkId: 1,

        // TTS state
        client: null,
        voices: {},
        device: null,
        selectedVoice: 'af_heart',
        speed: 1.3,
        error: null,
        loadingMessage: 'Loading...',

        // Playback
        playhead: 0,
        autoplay: true,
        isUserPaused: false,
        crossfadeMs: 800,
        isPlaying: false,

        // Callbacks
        onUtteranceGenerated: input?.onUtteranceGenerated,
        onAudioPlay: input?.onAudioPlay,
        onAudioPause: input?.onAudioPause,
        onAudioStop: input?.onAudioStop,
      };
    },
    initial: 'boot',
    states: {
      boot: {
        entry: 'createClient',
        on: {
          'WORKER.READY': {
            target: 'ready',
            actions: ['applyReady', 'clearError'],
          },
          'WORKER.ERROR': {
            // Stay in boot but record error; UI shows error while booting
            actions: 'setError',
          },
        },
      },
      ready: {
        initial: 'idle',
        states: {
          idle: {
            on: {
              'UI.START_AUTO_STREAM': 'autoStreaming',
            },
          },
          autoStreaming: {
            entry: 'pushChunk',
            on: {
              'UI.STOP_AUTO_STREAM': 'idle',
            },
            after: {
              300: [
                {
                  guard: ({ context }) => context.cursor >= context.inputText.length,
                  target: 'idle',
                  actions: 'stopAutoStream',
                },
                {
                  target: 'autoStreaming',
                  actions: 'pushChunk',
                },
              ],
            },
          },
        },
        on: {
          'UI.SET_TEXT': { actions: assign({ inputText: ({ event }) => event.text }) },
          'UI.SET_CURSOR': { actions: assign({ cursor: ({ event }) => event.cursor }) },
          'UI.SET_PUSH_SIZE': { actions: assign({ pushSize: ({ event }) => event.pushSize }) },
          'UI.SET_CHUNKER_LOCALE': { actions: 'updateChunkerOptions' },
          'UI.SET_CHUNKER_CHAR_ENABLED': { actions: 'updateChunkerOptions' },
          'UI.SET_CHUNKER_CHAR_LIMIT': { actions: 'updateChunkerOptions' },
          'UI.SET_CHUNKER_WORD_ENABLED': { actions: 'updateChunkerOptions' },
          'UI.SET_CHUNKER_WORD_LIMIT': { actions: 'updateChunkerOptions' },
          'UI.SET_CHUNKER_SOFT_PUNCT': { actions: 'updateChunkerOptions' },
          'UI.SET_VOICE': { actions: assign({ selectedVoice: ({ event }) => event.voice }) },
          'UI.SET_SPEED': { actions: assign({ speed: ({ event }) => event.speed }) },
          'UI.SET_AUTOPLAY': { actions: assign({ autoplay: ({ event }) => event.autoplay }) },
          'UI.SET_CROSSFADE': { actions: assign({ crossfadeMs: ({ event }) => event.crossfadeMs }) },
          'UI.PUSH_CHUNK': { actions: 'pushChunk' },
          'UI.FLUSH_CHUNKS': { actions: 'flushChunks' },
          'UI.PLAY': { actions: 'playQueue' },
          'UI.PAUSE': { actions: 'pauseQueue' },
          'UI.STOP': { actions: 'stopQueue' },
          'UI.SKIP': { actions: 'skipQueue' },
          'UI.RESET_ALL': { actions: 'resetAll' },
          'UI.START_AUTO_STREAM': { actions: assign({ autoStream: true }) },
          'UI.STOP_AUTO_STREAM': { actions: assign({ autoStream: false }) },
          'CHUNKS_EMITTED': { actions: 'handleChunksEmitted' },
          'GENERATE_TTS': { actions: 'generateTts' },
          'TTS_READY': { actions: 'handleTtsReady' },
          'TTS_DONE': { actions: 'handleTtsDone' },
          'TTS_ERROR': { actions: 'handleTtsError' },
          'WORKER.ERROR': { actions: 'setError' },
          'AUDIO_ENDED': { actions: 'handleAudioEnded' },
          'AUDIO_STARTED': { actions: 'handleAudioStarted' },
          'AUDIO_PAUSED': { actions: 'handleAudioPaused' },
          'AUDIO_RESUMED': { actions: 'handleAudioResumed' },
        },
      },
    },
  }, {
    actions: {
      createClient: assign(({ context, self }) => {
        if (typeof window === 'undefined' || context.client) return {};
        try {
          const client = new KokoroWorkerClient();
          client.init((voices, device) => {
            self.send({ type: 'WORKER.READY', voices, device });
          }, (err) => {
            const message = err instanceof Error ? err.message : String(err);
            self.send({ type: 'WORKER.ERROR', error: message });
          });
          return { client };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          self.send({ type: 'WORKER.ERROR', error: message });
          return {};
        }
      }),

      applyReady: assign(({ context, event }) => {
        if (event.type !== 'WORKER.READY') return {};
        const { voices, device } = event;
        const first = Object.keys(voices)[0];
        return {
          voices,
          device,
          loadingMessage: `Loading model (device="${device}")`,
          selectedVoice: first ?? context.selectedVoice,
        };
      }),

      setError: assign(({ event }) => ({
        error: (event as { type: 'WORKER.ERROR'; error: string }).error
      })),

      clearError: assign({ error: null }),

      stopAutoStream: assign({ autoStream: false }),

      updateChunkerOptions: assign(({ context, event }) => {
        let newOptions = { ...context.chunkerOptions };

        switch (event.type) {
          case 'UI.SET_CHUNKER_LOCALE':
            newOptions.locale = event.locale;
            break;
          case 'UI.SET_CHUNKER_CHAR_ENABLED':
            newOptions.charEnabled = event.enabled;
            break;
          case 'UI.SET_CHUNKER_CHAR_LIMIT':
            newOptions.charLimit = event.limit;
            break;
          case 'UI.SET_CHUNKER_WORD_ENABLED':
            newOptions.wordEnabled = event.enabled;
            break;
          case 'UI.SET_CHUNKER_WORD_LIMIT':
            newOptions.wordLimit = event.limit;
            break;
          case 'UI.SET_CHUNKER_SOFT_PUNCT':
            newOptions.softPunctSrc = event.softPunctSrc;
            break;
        }

        // Recreate chunker with new options
        const chunker = new SentenceStreamChunker({
          locale: newOptions.locale,
          charLimit: newOptions.charEnabled ? newOptions.charLimit : Number.POSITIVE_INFINITY,
          wordLimit: newOptions.wordEnabled ? newOptions.wordLimit : Number.POSITIVE_INFINITY,
          softPunct: new RegExp(newOptions.softPunctSrc),
        });

        return {
          chunkerOptions: newOptions,
          chunker,
        };
      }),

      pushChunk: assign(({ context, self }) => {
        console.log('pushChunk called with cursor', context.cursor, 'and pushSize', context.pushSize);

        const end = Math.min(context.inputText.length, context.cursor + context.pushSize);
        const part = context.inputText.slice(context.cursor, end);
        const eos = end >= context.inputText.length;


        if (part && context.chunker) {
          const chunks = context.chunker.push(part, { eos });

          if (chunks.length > 0) {
            const uiChunks: UiChunk[] = chunks.map((chunk, index) => ({
              id: context.nextChunkId + index,
              chunkIdx: chunk.idx,
              sentenceIdx: chunk.sentenceIdx,
              pieceIdx: chunk.pieceIdx,
              text: chunk.text,
              isSentenceFinal: chunk.isSentenceFinal,
              isStreamFinal: chunk.isStreamFinal,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              status: 'pending' as UiChunkStatus,
            }));

            self.send({ type: 'CHUNKS_EMITTED', chunks: uiChunks });
          }

          return {
            cursor: end,
            nextChunkId: context.nextChunkId + chunks.length,
          };
        } else {
          return {
            cursor: end,
          };
        }
      }),

      flushChunks: assign(({ context, self }) => {
        if (context.chunker) {
          const chunks = context.chunker.flush();
          if (chunks.length > 0) {
            const uiChunks: UiChunk[] = chunks.map((chunk, index) => ({
              id: context.nextChunkId + index,
              chunkIdx: chunk.idx,
              sentenceIdx: chunk.sentenceIdx,
              pieceIdx: chunk.pieceIdx,
              text: chunk.text,
              isSentenceFinal: chunk.isSentenceFinal,
              isStreamFinal: chunk.isStreamFinal,
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
              status: 'pending' as UiChunkStatus,
            }));

            self.send({ type: 'CHUNKS_EMITTED', chunks: uiChunks });

            return {
              nextChunkId: context.nextChunkId + chunks.length,
            };
          }
        }
        return {};
      }),

      handleChunksEmitted: assign(({ context, event, self }) => {
        if (event.type !== 'CHUNKS_EMITTED') return {};

        // Add chunks and trigger TTS generation for each
        const newChunks = [...context.uiChunks, ...event.chunks];

        // Auto-generate TTS for new chunks
        event.chunks.forEach((chunk: UiChunk) => {
          self.send({ type: 'GENERATE_TTS', chunkId: chunk.id, text: chunk.text });
        });

        return {
          uiChunks: newChunks,
          nextChunkId: context.nextChunkId,
        };
      }),

      generateTts: assign(({ context, event, self }) => {
        if (event.type !== 'GENERATE_TTS') return {};

        if (!context.client?.isReady) {
          return {};
        }

        // Update chunk status to generating
        const updatedChunks = context.uiChunks.map((chunk) =>
          chunk.id === event.chunkId
            ? { ...chunk, status: 'generating' as UiChunkStatus }
            : chunk
        );

        // Generate TTS
        console.log('Starting TTS generation for chunk', event.chunkId, 'text:', event.text.substring(0, 30) + '...');
        const startTime = performance.now();
        context.client.generate({ text: event.text, voice: context.selectedVoice, speed: context.speed })
          .then((result) => {
            const endTime = performance.now();
            const ms = Math.round(endTime - startTime);
            console.log('TTS generation successful for chunk', event.chunkId, 'took', ms, 'ms');
            self.send({
              type: 'TTS_DONE',
              chunkId: event.chunkId,
              url: result.url,
              text: event.text,
              ms
            });
          })
          .catch((error) => {
            console.error('TTS generation failed for chunk', event.chunkId, error);
            self.send({
              type: 'TTS_ERROR',
              error: error.message || 'TTS generation failed'
            });
          });

        return { uiChunks: updatedChunks };
      }),

      handleTtsReady: assign(({ context, event }) => {
        if (event.type !== 'TTS_READY') return {};

        const firstVoice = Object.keys(event.voices)[0];
        return {
          voices: event.voices,
          device: event.device,
          selectedVoice: firstVoice ?? context.selectedVoice,
        };
      }),

      handleTtsDone: assign(({ context, event, self }) => {
        const ttsEvent = event as { type: 'TTS_DONE'; chunkId: number; url: string; text: string; ms: number };
        console.log('TTS done for chunk', ttsEvent.chunkId, 'URL:', ttsEvent.url);

        // Find the chunk that was generated and update it
        const updatedChunks = context.uiChunks.map((chunk) => {
          if (chunk.id === ttsEvent.chunkId) {
            const updatedChunk = {
              ...chunk,
              status: 'ready' as UiChunkStatus,
              audioUrl: ttsEvent.url,
            };
            console.log('Updated chunk', chunk.id, 'to ready with URL:', ttsEvent.url);
            context.onUtteranceGenerated?.(updatedChunk);
            return updatedChunk;
          }
          return chunk;
        });

        // Auto-play if autoplay is enabled and this is the first ready chunk or we're at the playhead
        const shouldAutoPlay = context.autoplay && (
          context.uiChunks.length === 1 || // First chunk
          (context.playhead < updatedChunks.length && updatedChunks[context.playhead].status === 'ready')
        );

        if (shouldAutoPlay) {
          console.log('Auto-playing chunk', ttsEvent.chunkId);
          setTimeout(() => {
            self.send({ type: 'UI.PLAY' });
          }, 50); // Small delay to ensure state updates first
        }

        return { uiChunks: updatedChunks };
      }),

      handleTtsError: ({ context, event }) => {
        // Handle TTS errors - could update UI to show error state
        console.error('TTS error', event);
      },

      handleAudioEnded: assign(({ context, event, self }) => {
        const audioEvent = event as { type: 'AUDIO_ENDED'; chunkId: number };
        console.log('handleAudioEnded called for chunk', audioEvent.chunkId);

        // Mark the chunk as played
        const updatedChunks = context.uiChunks.map((chunk) => {
          if (chunk.id === audioEvent.chunkId) {
            console.log('Marking chunk', chunk.id, 'as played');
            return { ...chunk, status: 'played' as UiChunkStatus };
          }
          return chunk;
        });

        // Auto-advance to next chunk if available and autoplay is enabled
        let nextPlayhead = context.playhead;
        let shouldAutoPlayNext = false;
        if (context.autoplay && context.playhead < context.uiChunks.length - 1) {
          nextPlayhead = context.playhead + 1;
          shouldAutoPlayNext = true;
          console.log('Auto-advancing to chunk', nextPlayhead);
        }

        // If we should auto-play the next chunk, schedule it
        if (shouldAutoPlayNext) {
          setTimeout(() => {
            self.send({ type: 'UI.PLAY' });
          }, 100); // Small delay to ensure state updates first
        }

        return {
          uiChunks: updatedChunks,
          playhead: nextPlayhead,
          isPlaying: false,
        };
      }),

      handleAudioStarted: assign(({ context, event }) => {
        const audioEvent = event as { type: 'AUDIO_STARTED'; chunkId: number };
        // Mark the chunk as playing if it matches the current playhead
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead && chunk.id === audioEvent.chunkId && chunk.status !== 'playing') {
            return { ...chunk, status: 'playing' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: true,
        };
      }),

      handleAudioPaused: assign(({ context, event }) => {
        const audioEvent = event as { type: 'AUDIO_PAUSED'; chunkId: number };
        // Mark the chunk as paused if it matches the current playhead
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead && chunk.id === audioEvent.chunkId && chunk.status === 'playing') {
            return { ...chunk, status: 'paused' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: false,
        };
      }),

      handleAudioResumed: assign(({ context, event }) => {
        const audioEvent = event as { type: 'AUDIO_RESUMED'; chunkId: number };
        // Mark the chunk as playing if it matches the current playhead
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead && chunk.id === audioEvent.chunkId && chunk.status === 'paused') {
            return { ...chunk, status: 'playing' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: true,
        };
      }),

      playQueue: assign(({ context, self }) => {
        if (context.uiChunks.length === 0) return {};

        const chunk = context.uiChunks[context.playhead];
        if (!chunk || !chunk.audioUrl) {
          return {};
        }

        // Call the callback to let the UI handle audio playback
        context.onAudioPlay?.(chunk.audioUrl, chunk.id);

        // Mark chunk as playing
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead) {
            return { ...chunk, status: 'playing' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: true,
        };
      }),

      pauseQueue: assign(({ context }) => {
        // Call the callback to let the UI handle audio pause
        context.onAudioPause?.();

        // Mark chunk as paused
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead && chunk.status === 'playing') {
            return { ...chunk, status: 'paused' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: false
        };
      }),

      stopQueue: assign(({ context }) => {
        // Call the callback to let the UI handle audio stop
        context.onAudioStop?.();

        // Mark current chunk as played if it was playing
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead && chunk.status === 'playing') {
            return { ...chunk, status: 'played' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isPlaying: false,
          playhead: 0,
        };
      }),

      skipQueue: assign(({ context }) => {
        // Call the callback to let the UI handle audio stop
        context.onAudioStop?.();

        // Mark current chunk as skipped
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead) {
            return { ...chunk, status: 'skipped' as UiChunkStatus };
          }
          return chunk;
        });

        const nextPlayhead = Math.min(context.playhead + 1, context.uiChunks.length - 1);
        return {
          uiChunks: updatedChunks,
          playhead: nextPlayhead,
          isPlaying: false,
        };
      }),

      resetAll: assign(({ context }) => {
        return {
          uiChunks: [],
          playhead: 0,
          cursor: 0,
          chunker: new SentenceStreamChunker(context.chunkerOptions),
        };
      }),
    },
  });
}

export interface KokoroChunkerInput {
  onUtteranceGenerated?: (chunk: UiChunk) => void;
  onAudioPlay?: (audioUrl: string, chunkId: number) => void;
  onAudioPause?: () => void;
  onAudioStop?: () => void;
}

export type KokoroChunkerActor = Actor<ReturnType<typeof createKokoroChunkerMachine>>;

export const kokoroChunkerMachine = createKokoroChunkerMachine();
