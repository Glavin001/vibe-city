import { assign, createMachine } from 'xstate';
import type { Actor } from 'xstate';

export type TtsQueueStatus =
  | "pending"
  | "generating"
  | "ready"
  | "playing"
  | "paused"
  | "played"
  | "error"
  | "skipped";

export type TtsQueueItem = {
  audioUrl?: string;
  status: TtsQueueStatus;
};

export interface TtsQueueContext {
  items: TtsQueueItem[];
  playhead: number;
  autoplay: boolean;
  isUserPaused: boolean;
  activeAudioIndex: number;
  progressRatio: number;
  crossfadeMs: number;
  audioA: HTMLAudioElement | null;
  audioB: HTMLAudioElement | null;
  onStatusChange?: (index: number, status: TtsQueueStatus) => void;
  onError?: (message: string) => void;
}

export type TtsQueueEvent =
  | { type: 'INIT'; items?: TtsQueueItem[]; onStatusChange?: (index: number, status: TtsQueueStatus) => void; onError?: (message: string) => void }
  | { type: 'SET_ITEMS'; items: TtsQueueItem[] }
  | { type: 'SET_PLAYHEAD'; playhead: number }
  | { type: 'SET_AUTOPLAY'; autoplay: boolean }
  | { type: 'SET_USER_PAUSED'; isUserPaused: boolean }
  | { type: 'SET_CROSSFADE'; crossfadeMs: number }
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'STOP' }
  | { type: 'SKIP' }
  | { type: 'AUDIO_ENDED' }
  | { type: 'AUDIO_PLAY' }
  | { type: 'AUDIO_PAUSE' }
  | { type: 'AUDIO_TIMEUPDATE'; progress: number }
  | { type: 'CROSSFADE_START' }
  | { type: 'CROSSFADE_END' };

export interface TtsQueueInput {
  items?: TtsQueueItem[];
  onStatusChange?: (index: number, status: TtsQueueStatus) => void;
  onError?: (message: string) => void;
}

function createTtsQueueMachine() {
  return createMachine({
    id: 'tts-queue',
    types: {
      context: {} as TtsQueueContext,
      events: {} as TtsQueueEvent,
      input: {} as TtsQueueInput,
    },
    context: ({ input }) => ({
      items: input?.items ?? [],
      playhead: 0,
      autoplay: true,
      isUserPaused: false,
      activeAudioIndex: 0,
      progressRatio: 0,
      crossfadeMs: 800,
      audioA: typeof window !== 'undefined' ? new Audio() : null,
      audioB: typeof window !== 'undefined' ? new Audio() : null,
      onStatusChange: input?.onStatusChange,
      onError: input?.onError,
    }),
    initial: 'idle',
    states: {
      idle: {
        entry: 'setupAudioElements',
        on: {
          PLAY: { target: 'playing', actions: 'startPlayback' },
          SET_ITEMS: { actions: 'updateItems' },
          SET_PLAYHEAD: { actions: 'updatePlayhead' },
          SET_AUTOPLAY: { actions: 'updateAutoplay' },
          SET_USER_PAUSED: { actions: 'updateUserPaused' },
          SET_CROSSFADE: { actions: 'updateCrossfade' },
        },
      },
      playing: {
        entry: 'notifyPlaying',
        on: {
          PAUSE: { target: 'paused', actions: 'pausePlayback' },
          STOP: { target: 'idle', actions: 'stopPlayback' },
          SKIP: { actions: 'skipPlayback' },
          AUDIO_ENDED: { actions: 'handleAudioEnded' },
          AUDIO_TIMEUPDATE: { actions: 'updateProgress' },
          CROSSFADE_START: { actions: 'startCrossfade' },
          CROSSFADE_END: { actions: 'endCrossfade' },
          SET_ITEMS: { actions: 'updateItems' },
          SET_PLAYHEAD: { actions: 'updatePlayhead' },
          SET_AUTOPLAY: { actions: 'updateAutoplay' },
          SET_USER_PAUSED: { actions: 'updateUserPaused' },
          SET_CROSSFADE: { actions: 'updateCrossfade' },
        },
      },
      paused: {
        entry: 'notifyPaused',
        on: {
          PLAY: { target: 'playing', actions: 'resumePlayback' },
          STOP: { target: 'idle', actions: 'stopPlayback' },
          SKIP: { actions: 'skipPlayback' },
          SET_ITEMS: { actions: 'updateItems' },
          SET_PLAYHEAD: { actions: 'updatePlayhead' },
          SET_AUTOPLAY: { actions: 'updateAutoplay' },
          SET_USER_PAUSED: { actions: 'updateUserPaused' },
          SET_CROSSFADE: { actions: 'updateCrossfade' },
        },
      },
    },
    on: {
      AUDIO_PLAY: { actions: 'handleAudioPlay' },
      AUDIO_PAUSE: { actions: 'handleAudioPause' },
    },
  }, {
    actions: {
      setupAudioElements: ({ context }) => {
        if (typeof window === 'undefined') return;

        const { audioA, audioB } = context;
        if (!audioA || !audioB) return;

        // Set up event listeners
        const handleEnded = (index: number) => (e: Event) => {
          // Send event to machine
          const machine = e.target as any;
          if (machine._machine) {
            machine._machine.send({ type: 'AUDIO_ENDED' });
          }
        };

        const handlePlay = (index: number) => (e: Event) => {
          const machine = e.target as any;
          if (machine._machine) {
            machine._machine.send({ type: 'AUDIO_PLAY' });
          }
        };

        const handlePause = (index: number) => (e: Event) => {
          const machine = e.target as any;
          if (machine._machine) {
            machine._machine.send({ type: 'AUDIO_PAUSE' });
          }
        };

        const handleTimeUpdate = (index: number) => (e: Event) => {
          const audio = e.target as HTMLAudioElement;
          const duration = audio.duration || 0;
          const currentTime = audio.currentTime || 0;
          const progress = duration > 0 ? currentTime / duration : 0;

          const machine = audio as any;
          if (machine._machine) {
            machine._machine.send({ type: 'AUDIO_TIMEUPDATE', progress });
          }
        };

        // Attach listeners
        audioA.addEventListener('ended', handleEnded(0));
        audioA.addEventListener('play', handlePlay(0));
        audioA.addEventListener('pause', handlePause(0));
        audioA.addEventListener('timeupdate', handleTimeUpdate(0));

        audioB.addEventListener('ended', handleEnded(1));
        audioB.addEventListener('play', handlePlay(1));
        audioB.addEventListener('pause', handlePause(1));
        audioB.addEventListener('timeupdate', handleTimeUpdate(1));

        // Store reference to machine for event handlers
        (audioA as any)._machine = { send: (event: any) => {} };
        (audioB as any)._machine = { send: (event: any) => {} };
      },

      updateItems: assign(({ event }) => {
        if (event.type === 'SET_ITEMS') {
          return { items: event.items };
        }
        return {};
      }),

      updatePlayhead: assign(({ event }) => {
        if (event.type === 'SET_PLAYHEAD') {
          return { playhead: event.playhead };
        }
        return {};
      }),

      updateAutoplay: assign(({ event }) => {
        if (event.type === 'SET_AUTOPLAY') {
          return { autoplay: event.autoplay };
        }
        return {};
      }),

      updateUserPaused: assign(({ event }) => {
        if (event.type === 'SET_USER_PAUSED') {
          return { isUserPaused: event.isUserPaused };
        }
        return {};
      }),

      updateCrossfade: assign(({ event }) => {
        if (event.type === 'SET_CROSSFADE') {
          return { crossfadeMs: event.crossfadeMs };
        }
        return {};
      }),

      startPlayback: ({ context }) => {
        const { items, playhead, audioA, audioB, activeAudioIndex } = context;
        const current = items[playhead];
        if (!current?.audioUrl) return;

        const activeAudio = activeAudioIndex === 0 ? audioA : audioB;
        if (!activeAudio) return;

        if (activeAudio.src !== current.audioUrl) {
          activeAudio.src = current.audioUrl;
        }

        const playPromise = activeAudio.play();
        if (playPromise) {
          playPromise.catch((err) => {
            context.onError?.(`Autoplay blocked: ${err.message}`);
          });
        }
      },

      pausePlayback: ({ context }) => {
        const { audioA, audioB, activeAudioIndex } = context;
        const activeAudio = activeAudioIndex === 0 ? audioA : audioB;
        if (activeAudio && !activeAudio.paused) {
          activeAudio.pause();
        }
      },

      resumePlayback: ({ context }) => {
        const { audioA, audioB, activeAudioIndex } = context;
        const activeAudio = activeAudioIndex === 0 ? audioA : audioB;
        if (activeAudio) {
          activeAudio.play().catch((err) => {
            context.onError?.(`Resume failed: ${err.message}`);
          });
        }
      },

      stopPlayback: ({ context }) => {
        const { audioA, audioB } = context;
        if (audioA) {
          audioA.pause();
          audioA.currentTime = 0;
        }
        if (audioB) {
          audioB.pause();
          audioB.currentTime = 0;
        }
        // Reset context
        return {
          isUserPaused: false,
          autoplay: false,
          progressRatio: 0,
          activeAudioIndex: 0,
        };
      },

      skipPlayback: ({ context }) => {
        const { items, playhead, audioA, audioB, activeAudioIndex, onStatusChange } = context;
        const current = items[playhead];
        if (current && (current.status === 'playing' || current.status === 'paused')) {
          onStatusChange?.(playhead, 'skipped');
        }

        const activeAudio = activeAudioIndex === 0 ? audioA : audioB;
        if (activeAudio && !activeAudio.paused) {
          activeAudio.pause();
        }

        return { playhead: playhead + 1 };
      },

      handleAudioEnded: assign(({ context }) => {
        const { items, playhead, audioA, audioB, activeAudioIndex, onStatusChange } = context;

        // Notify current item as played
        onStatusChange?.(playhead, 'played');

        // Reset volumes
        if (audioA) audioA.volume = 1;
        if (audioB) audioB.volume = 1;

        return {
          playhead: playhead + 1,
          isUserPaused: false,
          progressRatio: 0,
          activeAudioIndex: 1 - activeAudioIndex, // Switch active audio element
        };
      }),

      handleAudioPlay: ({ context }) => {
        context.onStatusChange?.(context.playhead, 'playing');
      },

      handleAudioPause: ({ context }) => {
        if (context.isUserPaused) {
          context.onStatusChange?.(context.playhead, 'paused');
        }
      },

      updateProgress: assign(({ event }) => {
        if (event.type === 'AUDIO_TIMEUPDATE') {
          return { progressRatio: event.progress };
        }
        return {};
      }),

      notifyPlaying: ({ context }) => {
        context.onStatusChange?.(context.playhead, 'playing');
      },

      notifyPaused: ({ context }) => {
        context.onStatusChange?.(context.playhead, 'paused');
      },

      startCrossfade: ({ context }) => {
        // Crossfade logic would go here - simplified for now
        // This would involve volume ramping over time
      },

      endCrossfade: ({ context }) => {
        // Clean up after crossfade
      },
    },
  });
}

export type TtsQueueActor = Actor<ReturnType<typeof createTtsQueueMachine>>;

export const ttsQueueMachine = createTtsQueueMachine();
