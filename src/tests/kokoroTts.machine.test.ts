import { describe, expect, it, vi } from 'vitest';
import { assign, createActor } from 'xstate';
import { kokoroTtsMachine } from '../machines/kokoroTts.machine';

describe('kokoroTtsMachine', () => {
  it('boots, becomes ready, and generates audio', async () => {
    const generateMock = vi.fn().mockResolvedValue({ url: 'mock-url' });
    const clientStub = {
      isReady: true,
      generate: generateMock,
      dispose: vi.fn(),
      init: vi.fn(),
    } as unknown as import('../lib/tts/kokoro-worker-client').KokoroWorkerClient;

    const machine = kokoroTtsMachine.provide({
      actions: {
        createClient: assign(() => ({ client: clientStub })),
        disposeClient: () => {},
      },
    });

    const utteranceSpy = vi.fn();
    const actor = createActor(machine, { input: { onUtteranceGenerated: utteranceSpy } });

    actor.start();
    expect(actor.getSnapshot().value).toBe('boot');

    actor.send({ type: 'WORKER.READY', voices: { voiceA: {} }, device: 'cpu' });
    const snapshotAfterReady = actor.getSnapshot();
    expect(snapshotAfterReady.value).toBe('ready');
    expect(snapshotAfterReady.context.selectedSpeaker).toBe('voiceA');

    actor.send({ type: 'USER.SET_TEXT', text: 'Hello there' });
    actor.send({ type: 'USER.GENERATE' });
    expect(actor.getSnapshot().value).toBe('generating');

    await new Promise<void>((resolve, reject) => {
      const subscription = actor.subscribe((state) => {
        if (state.value === 'ready' && state.context.synthesizedUtterances.length > 0) {
          subscription.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error('generation timeout'));
      }, 2000);
    });

    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello there', voice: 'voiceA' }));

    const { synthesizedUtterances } = actor.getSnapshot().context;
    expect(synthesizedUtterances[0]).toMatchObject({ text: 'Hello there', src: 'mock-url' });
    expect(utteranceSpy).toHaveBeenCalledWith(expect.objectContaining({ src: 'mock-url' }));
  });
});
