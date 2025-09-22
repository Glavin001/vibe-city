import { describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { speechRecognitionMachine } from '../machines/speechRecognition.machine';

describe('speechRecognitionMachine', () => {
  it('loads, generates, and completes recognition', () => {
    const postGenerate = vi.fn();
    const machine = speechRecognitionMachine.provide({
      actions: {
        ensureWorker: () => {},
        postLoad: () => {},
        postLoadIfReady: () => {},
        postLoadIfRequested: () => {},
        emitParentLoading: () => {},
        emitParentReady: () => {},
        emitParentUpdate: () => {},
        emitParentComplete: () => {},
        emitParentError: () => {},
        notifyLoading: () => {},
        notifyReady: () => {},
        notifyStart: () => {},
        notifyUpdate: () => {},
        notifyComplete: () => {},
        notifyError: () => {},
        postGenerate,
      },
    });

    const actor = createActor(machine, { input: { language: 'en' } });
    actor.start();

    expect(actor.getSnapshot().value).toBe('boot');

    const workerStub = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
    actor.send({ type: 'WORKER_ATTACHED', worker: workerStub });
    expect(actor.getSnapshot().context.worker).toBe(workerStub);

    actor.send({ type: 'LOAD' });
    expect(actor.getSnapshot().value).toBe('loading');
    expect(actor.getSnapshot().context.loadRequested).toBe(true);

    actor.send({ type: 'WORKER_LOADING' });
    expect(actor.getSnapshot().context.status).toBe('loading');

    actor.send({ type: 'WORKER_READY' });
    expect(actor.getSnapshot().value).toBe('ready');
    expect(actor.getSnapshot().context.status).toBe('ready');

    const audio = new Float32Array([0.1, 0.2, 0.3]);
    actor.send({ type: 'GENERATE', audio, language: 'en' });
    expect(actor.getSnapshot().value).toBe('generating');
    expect(postGenerate).toHaveBeenCalled();

    actor.send({ type: 'WORKER_START' });
    expect(actor.getSnapshot().context.status).toBe('start');

    actor.send({ type: 'WORKER_UPDATE', output: 'partial', tps: 5 });
    expect(actor.getSnapshot().context.status).toBe('update');
    expect(actor.getSnapshot().context.text).toBe('partial');
    expect(actor.getSnapshot().context.tps).toBe(5);

    actor.send({ type: 'WORKER_COMPLETE', output: 'final transcript' });
    expect(actor.getSnapshot().value).toBe('ready');
    expect(actor.getSnapshot().context.status).toBe('complete');
    expect(actor.getSnapshot().context.text).toBe('final transcript');
  });
});
