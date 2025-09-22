import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import { voiceSegmentsMachine } from '../machines/voiceSegments.machine';

describe('voiceSegmentsMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes immediately when whisper completes during settling', async () => {
    const actor = createActor(voiceSegmentsMachine, { input: { settleMs: 100, whisperWaitMs: 300 } });
    actor.start();

    actor.send({ type: 'VAD.START' });
    actor.send({ type: 'LIVE_UPDATE', text: 'hello world' });
    actor.send({ type: 'VAD.END' });
    expect(actor.getSnapshot().value).toBe('settling');

    actor.send({ type: 'WHISPER.STATUS', status: 'complete' });
    vi.advanceTimersByTime(100);
    await Promise.resolve();

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.lastFinalText).toBe('hello world');
    expect(actor.getSnapshot().context.liveText).toBe('');
  });

  it('waits for whisper completion before flushing', async () => {
    const actor = createActor(voiceSegmentsMachine, { input: { settleMs: 50, whisperWaitMs: 150 } });
    actor.start();

    actor.send({ type: 'VAD.START' });
    actor.send({ type: 'LIVE_UPDATE', text: 'partial result' });
    actor.send({ type: 'VAD.END' });

    vi.advanceTimersByTime(50);
    await Promise.resolve();

    expect(actor.getSnapshot().value).toBe('waitingWhisper');
    expect(actor.getSnapshot().context.waitingForWhisper).toBe(true);

    vi.advanceTimersByTime(150);
    await Promise.resolve();

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.lastFinalText).toBe('partial result');
  });
});
