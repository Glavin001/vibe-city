import { describe, expect, it } from 'vitest';
import { assign, createActor } from 'xstate';
import { audioRecorderMachine } from '../machines/audioRecorder.machine';

describe('audioRecorderMachine', () => {
  const testMachine = audioRecorderMachine.provide({
    actions: {
      requestStream: () => {},
      prepareRecorder: () => {},
      startRecorder: () => {},
      stopRecorder: () => {},
      startDataInterval: assign(() => ({ dataIntervalId: 1 })),
      clearDataInterval: assign(() => ({ dataIntervalId: null })),
      requestDataNow: () => {},
      emitParentData: () => {},
      emitParentAcquired: () => {},
    },
  });

  it('transitions through acquisition and records chunks', () => {
    const actor = createActor(testMachine, {
      input: { sampleRate: 16000, mimeType: 'audio/webm', dataRequestInterval: 100 },
    });
    actor.start();

    expect(actor.getSnapshot().value).toBe('acquiring');

    const stream = {} as MediaStream;
    actor.send({ type: 'ACQUIRED', stream });
    expect(actor.getSnapshot().value).toBe('preparing');
    expect(actor.getSnapshot().context.stream).toBe(stream);

    const recorder = { state: 'inactive' } as unknown as MediaRecorder;
    actor.send({ type: 'PREPARED', recorder });
    expect(actor.getSnapshot().value).toBe('ready');
    expect(actor.getSnapshot().context.recorder).toBe(recorder);

    actor.send({ type: 'START' });
    expect(actor.getSnapshot().value).toBe('recording');

    const blob = new Blob(['hello'], { type: 'text/plain' });
    actor.send({ type: 'DATA_AVAILABLE', blob });
    expect(actor.getSnapshot().context.chunks).toHaveLength(1);

    actor.send({ type: 'STOP' });
    expect(actor.getSnapshot().value).toBe('ready');

    actor.send({ type: 'RESET' });
    expect(actor.getSnapshot().context.chunks).toHaveLength(0);
  });

  it('captures errors during acquisition', () => {
    const actor = createActor(testMachine, {
      input: { sampleRate: 16000, mimeType: 'audio/webm', dataRequestInterval: 100 },
    });
    actor.start();

    actor.send({ type: 'ACQUIRE_FAILED', error: 'no mic' });
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error).toBe('no mic');
  });
});
