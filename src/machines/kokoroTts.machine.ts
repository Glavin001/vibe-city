import { assign, createMachine, fromPromise } from 'xstate';
import type { Actor } from 'xstate';
import { KokoroWorkerClient, type KokoroVoices } from '../lib/tts/kokoro-worker-client';

export type KokoroTtsStatus = 'boot' | 'ready' | 'running';

export interface KokoroTtsContext {
  client: KokoroWorkerClient | null;
  inputText: string;
  selectedSpeaker: string;
  voices: KokoroVoices;
  device: string | null;
  error: string | null;
  loadingMessage: string;
  synthesizedUtterances: SynthesizedUtterance[];
  genStartMs: number | null;
  onUtteranceGenerated?: (item: SynthesizedUtterance) => void;
}

export type KokoroTtsEvent =
  | { type: 'INIT' }
  | { type: 'USER.SET_TEXT'; text: string }
  | { type: 'USER.SET_VOICE'; voice: string }
  | { type: 'USER.GENERATE' }
  | { type: 'WORKER.READY'; voices: KokoroVoices; device: string }
  | { type: 'WORKER.ERROR'; error: string }
  | { type: 'GENERATE.DONE'; url: string; text: string; ms: number }
  | { type: 'TERMINATE' };

export type SynthesizedUtterance = { text: string; src: string; ms: number };

export interface KokoroTtsInput {
  onUtteranceGenerated?: (item: SynthesizedUtterance) => void;
}

function createKokoroTtsMachine() {
  return createMachine({
    id: 'kokoro-tts',
    types: {
      context: {} as KokoroTtsContext,
      events: {} as KokoroTtsEvent,
      input: {} as KokoroTtsInput,
    },
    exit: ['disposeClient', assign({ client: (_) => null })],
    context: ({ input }) => ({
      client: null,
      inputText: "Life is like a box of chocolates. You never know what you're gonna get.",
      selectedSpeaker: 'af_heart',
      voices: {},
      device: null,
      error: null,
      loadingMessage: 'Loading...',
      synthesizedUtterances: [],
      genStartMs: null,
      onUtteranceGenerated: input?.onUtteranceGenerated,
    }),
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
        on: {
          'USER.GENERATE': {
            guard: ({ context }) => !!context.client && Object.keys(context.voices).length > 0 && context.inputText.trim() !== '',
            target: 'generating',
            actions: 'markGenStart',
          },
          'WORKER.ERROR': { actions: 'setError' },
        },
      },
      generating: {
        invoke: {
          src: fromPromise(async ({ input }) => {
            const { client, text, voice, genStartMs } = input as { client: KokoroWorkerClient | null; text: string; voice: string; genStartMs: number | null };
            if (!client || !client.isReady) throw new Error('Kokoro worker not ready');
            const start = genStartMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const { url } = await client.generate({ text, voice });
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            const ms = Math.max(0, Math.round(now - start));
            return { url, text, ms } as { url: string; text: string; ms: number };
          }),
          input: ({ context }) => ({
            client: context.client,
            text: context.inputText.trim(),
            voice: context.selectedSpeaker,
            genStartMs: context.genStartMs,
          }),
          onDone: {
            target: 'ready',
            actions: [assign(({ context, event }) => {
              const output = event.output as { url: string; text: string; ms: number };
              return {
                synthesizedUtterances: [{ text: output.text, src: output.url, ms: output.ms }, ...context.synthesizedUtterances],
              };
            }), assign({
              genStartMs: null,
            }) , 'clearError', 'notifyUtterance'],
          },
          onError: {
            target: 'ready',
            actions: ['setError', assign({ genStartMs: (_) => null })],
          },
        },
      },
      error: {},
    },
    on: {
      'USER.SET_TEXT': { actions: assign({ inputText: ({ event }) => (event as { type: 'USER.SET_TEXT'; text: string }).text }) },
      'USER.SET_VOICE': { actions: assign({ selectedSpeaker: ({ event }) => (event as { type: 'USER.SET_VOICE'; voice: string }).voice }) },
      TERMINATE: { actions: 'terminateClient' },
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
        const { voices, device } = event as { type: 'WORKER.READY'; voices: KokoroVoices; device: string };
        const first = Object.keys(voices)[0];
        return {
          voices,
          device,
          loadingMessage: `Loading model (device="${device}")`,
          selectedSpeaker: first ?? context.selectedSpeaker,
        };
      }),
      setError: assign(({ event }) => ({ error: (event as { type: 'WORKER.ERROR'; error: string }).error })),
      clearError: assign({ error: (_) => null }),
      markGenStart: assign({ genStartMs: (_) => (typeof performance !== 'undefined' ? performance.now() : Date.now()) }),
      disposeClient: ({ context }) => {
        try { context.client?.dispose(); } catch {}
      },
      notifyUtterance: ({ context, event }) => {
        const output = (event as unknown as { output?: { url: string; text: string; ms: number } }).output;
        if (!output) return;
        const item: SynthesizedUtterance = { text: output.text, src: output.url, ms: output.ms };
        context.onUtteranceGenerated?.(item);
      },
    },
  });
}

export type KokoroTtsActor = Actor<ReturnType<typeof createKokoroTtsMachine>>;

export const kokoroTtsMachine = createKokoroTtsMachine();


