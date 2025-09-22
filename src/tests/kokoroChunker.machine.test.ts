import { describe, expect, it, vi } from 'vitest';
import { assign, createActor } from 'xstate';
import { kokoroChunkerMachine } from '../machines/kokoroChunker.machine';

describe('kokoroChunkerMachine', () => {
  it('pushes chunks and marks them ready after TTS completes', async () => {
    const generateMock = vi.fn().mockResolvedValue({ url: 'mock-audio' });
    const clientStub = {
      isReady: true,
      generate: generateMock,
    } as unknown as import('../lib/tts/kokoro-worker-client').KokoroWorkerClient;

    const machine = kokoroChunkerMachine.provide({
      actions: {
        createClient: assign(() => ({ client: clientStub })),
      },
    });

    const utteranceSpy = vi.fn();
    const actor = createActor(machine, { input: { onUtteranceGenerated: utteranceSpy } });
    actor.start();

    actor.send({ type: 'WORKER.READY', voices: { voice1: {} }, device: 'cpu' });

    actor.send({ type: 'UI.SET_TEXT', text: 'Hello world.' });
    actor.send({ type: 'UI.PUSH_CHUNK' });

    const afterPush = actor.getSnapshot().context.uiChunks;
    expect(afterPush).toHaveLength(1);
    expect(afterPush[0].status).toBe('generating');

    await Promise.resolve();
    await Promise.resolve();

    const chunk = actor.getSnapshot().context.uiChunks[0];
    expect(['ready', 'playing']).toContain(chunk.status);
    expect(chunk.audioUrl).toBe('mock-audio');
    expect(generateMock).toHaveBeenCalledWith({ text: chunk.text, voice: 'voice1', speed: actor.getSnapshot().context.speed });
    expect(utteranceSpy).toHaveBeenCalledWith(expect.objectContaining({ id: chunk.id, audioUrl: 'mock-audio' }));
  });
});
