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
  // Crossfade scheduling
  crossfadeScheduledForPlayhead: number | null;
  isCrossfading: boolean;
  activePlayerIndex: 0 | 1;

  // Callbacks
  onUtteranceGenerated?: (chunk: UiChunk) => void;
  onAudioPlay?: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => void;
  onAudioPause?: () => void;
  onAudioStop?: () => void;
  // Advanced audio coordination (optional)
  onAudioPreload?: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => void;
  onCrossfadeStart?: (args: { currentChunkId: number; nextChunkId: number; durationMs: number; nextUrl: string; nextPlayerIndex: 0 | 1 }) => void;
  onCrossfadeCancel?: () => void;
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
  | { type: 'AUDIO_RESUMED'; chunkId: number }
  // Progress tick from the playing audio element
  | { type: 'AUDIO_PROGRESS'; currentTime: number; duration: number }
  // Crossfade lifecycle events
  | { type: 'CROSSFADE.START' }
  | { type: 'CROSSFADE.CANCEL' };

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
        crossfadeMs: input?.crossfadeEnabled === false ? 0 : (typeof input?.crossfadeMs === 'number' ? input.crossfadeMs : 800),
        crossfadeScheduledForPlayhead: null,
        isCrossfading: false,
        activePlayerIndex: 0,

        // Callbacks
        onUtteranceGenerated: input?.onUtteranceGenerated,
        onAudioPlay: input?.onAudioPlay,
        onAudioPause: input?.onAudioPause,
        onAudioStop: input?.onAudioStop,
        onAudioPreload: input?.onAudioPreload,
        onCrossfadeStart: input?.onCrossfadeStart,
        onCrossfadeCancel: input?.onCrossfadeCancel,
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
            always: [
              {
                guard: ({ context }) => {
                  const current = context.uiChunks[context.playhead];
                  return !!(context.autoplay && current && current.audioUrl && (current.status === 'ready' || current.status === 'paused'));
                },
                target: 'playing',
                actions: 'playQueue',
              },
            ],
            on: {
              'UI.START_AUTO_STREAM': 'autoStreaming',
              'UI.PLAY': { target: 'playing', actions: 'playQueue' },
            },
          },
          autoStreaming: {
            entry: 'pushChunk',
            always: [
              {
                guard: ({ context }) => {
                  // While auto-streaming, if autoplay and current playhead is ready/paused with url, start playing
                  const current = context.uiChunks[context.playhead];
                  return !!(context.autoplay && current && current.audioUrl && (current.status === 'ready' || current.status === 'paused'));
                },
                actions: 'playQueue',
              },
            ],
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
          playing: {
            on: {
              'UI.PAUSE': { target: 'paused', actions: 'pauseQueue' },
              'UI.STOP': { target: 'idle', actions: 'stopQueue' },
              'UI.SKIP': { target: 'idle', actions: 'skipQueue' },
              'AUDIO_ENDED': { target: 'idle', actions: 'handleAudioEnded' },
              'AUDIO_PAUSED': { target: 'paused', actions: 'handleAudioPaused' },
            },
          },
          paused: {
            on: {
              'UI.PLAY': { target: 'playing', actions: 'playQueue' },
              'UI.STOP': { target: 'idle', actions: 'stopQueue' },
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
          'AUDIO_PROGRESS': { actions: 'handleAudioProgress' },
          'CROSSFADE.START': { actions: 'handleCrossfadeStart' },
          'CROSSFADE.CANCEL': { actions: 'handleCrossfadeCancel' },
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

        // Hint the UI to preload the immediate next audio
        try {
          const nextIndex = context.playhead + 1;
          const next = updatedChunks[nextIndex];
          if (next && next.audioUrl) {
            const preferredIndex: 0 | 1 = context.activePlayerIndex === 0 ? 1 : 0;
            context.onAudioPreload?.(next.audioUrl, next.id, preferredIndex);
          }
        } catch {}

        // Autoplay is handled via guard in idle state (no timers)
        if (shouldAutoPlay) {
          console.log('Auto-play will be handled in idle via guard');
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
            console.log('Marking chunk with ID ', chunk.id, 'as played');
            return { ...chunk, status: 'played' as UiChunkStatus };
          }
          return chunk;
        });

        // Auto-advance to next chunk if available and autoplay is enabled
        let nextPlayhead = context.playhead;
        let shouldAutoPlayNext = false;
        let nextAlreadyPlaying = false;
        if (context.autoplay && context.playhead < context.uiChunks.length - 1) {
          nextPlayhead = context.playhead + 1;
          const next = context.uiChunks[nextPlayhead];
          nextAlreadyPlaying = !!next && next.status === 'playing';
          shouldAutoPlayNext = !nextAlreadyPlaying;
          console.log('Auto-advancing to chunk with index', nextPlayhead, 'alreadyPlaying=', nextAlreadyPlaying);
        }

        // Autoplay of next chunk handled via guard in idle (no timers)

        return {
          uiChunks: updatedChunks,
          playhead: nextPlayhead,
          isCrossfading: false,
          crossfadeScheduledForPlayhead: null,
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
        };
      }),

      // Crossfade scheduling / coordination (UI performs actual audio mixing)
      handleAudioProgress: assign(({ context, event, self }) => {
        const { currentTime, duration } = event as { type: 'AUDIO_PROGRESS'; currentTime: number; duration: number };
        if (!context.autoplay) return {};
        if (!context.crossfadeMs || context.crossfadeMs <= 0) return {};
        const current = context.uiChunks[context.playhead];
        const next = context.uiChunks[context.playhead + 1];
        if (!current || !next || !next.audioUrl) return {};
        if (current.status !== 'playing') return {};
        if (next.status !== 'ready') return {};
        const dur = duration || 0;
        const cur = currentTime || 0;
        if (!(dur > 0)) return {};
        const timeLeftMs = Math.max(0, (dur - cur) * 1000);
        if (timeLeftMs > context.crossfadeMs) return {};
        if (context.crossfadeScheduledForPlayhead === context.playhead) return {};
        // schedule
        setTimeout(() => self.send({ type: 'CROSSFADE.START' }), 0);
        return { crossfadeScheduledForPlayhead: context.playhead };
      }),

      handleCrossfadeStart: assign(({ context }) => {
        const current = context.uiChunks[context.playhead];
        const nextIndex = context.playhead + 1;
        const next = context.uiChunks[nextIndex];
        if (!current || !next || !next.audioUrl) return {};

        // mark next as playing for UI consistency
        const updated = context.uiChunks.map((c, i) => (i === nextIndex ? { ...c, status: 'playing' as UiChunkStatus } : c));
        const nextPlayerIndex: 0 | 1 = context.activePlayerIndex === 0 ? 1 : 0;
        try {
          context.onCrossfadeStart?.({ currentChunkId: current.id, nextChunkId: next.id, durationMs: Math.max(1, context.crossfadeMs), nextUrl: next.audioUrl, nextPlayerIndex });
        } catch {}
        return { uiChunks: updated, isCrossfading: true, activePlayerIndex: nextPlayerIndex };
      }),

      handleCrossfadeCancel: assign(({ context }) => {
        try { context.onCrossfadeCancel?.(); } catch {}
        return { isCrossfading: false, crossfadeScheduledForPlayhead: null };
      }),

      playQueue: assign(({ context, self }) => {
        if (context.uiChunks.length === 0) return {};

        const chunk = context.uiChunks[context.playhead];
        if (!chunk || !chunk.audioUrl) {
          return {};
        }

        // Call the callback to let the UI handle audio playback (third arg: preferred player index)
        const preferredPlayerIndex: 0 | 1 = context.isCrossfading ?  (0 as 0 | 1) : context.activePlayerIndex ?? 0;
        context.onAudioPlay?.(chunk.audioUrl, chunk.id, preferredPlayerIndex);

        // Mark chunk as playing
        const updatedChunks = context.uiChunks.map((chunk, index) => {
          if (index === context.playhead) {
            return { ...chunk, status: 'playing' as UiChunkStatus };
          }
          return chunk;
        });

        return {
          uiChunks: updatedChunks,
          isCrossfading: false,
          crossfadeScheduledForPlayhead: null,
          activePlayerIndex: preferredPlayerIndex,
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
          playhead: 0,
          isCrossfading: false,
          crossfadeScheduledForPlayhead: null,
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
          isCrossfading: false,
          crossfadeScheduledForPlayhead: null,
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
  onAudioPlay?: (audioUrl: string, chunkId: number, preferredPlayerIndex?: 0 | 1) => void;
  onAudioPause?: () => void;
  onAudioStop?: () => void;
  onAudioPreload?: (audioUrl: string, chunkId: number) => void;
  onCrossfadeStart?: (args: { currentChunkId: number; nextChunkId: number; durationMs: number; nextUrl: string; nextPlayerIndex: 0 | 1 }) => void;
  onCrossfadeCancel?: () => void;
  // Initial configuration
  crossfadeEnabled?: boolean;
  crossfadeMs?: number;
}

export type KokoroChunkerActor = Actor<ReturnType<typeof createKokoroChunkerMachine>>;

export const kokoroChunkerMachine = createKokoroChunkerMachine();
