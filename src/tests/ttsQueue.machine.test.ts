import { describe, expect, it, vi } from 'vitest';
import { assign, createActor } from 'xstate';
import { ttsQueueMachine } from '../machines/ttsQueue.machine';

describe('ttsQueueMachine', () => {
  it('manages playback state and progress', () => {
    const items = [
      { audioUrl: 'a.mp3', status: 'ready' as const },
      { audioUrl: 'b.mp3', status: 'ready' as const },
    ];

    const statusSpy = vi.fn();

    const machine = ttsQueueMachine.provide({
      actions: {
        startPlayback: () => {},
        pausePlayback: () => {},
        resumePlayback: () => {},
        stopPlayback: assign(() => ({ autoplay: false, isUserPaused: false, progressRatio: 0, activeAudioIndex: 0 })),
      },
    });

    const actor = createActor(machine, { input: { items, onStatusChange: statusSpy } });
    actor.start();

    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'PLAY' });
    expect(actor.getSnapshot().value).toBe('playing');
    expect(statusSpy).toHaveBeenCalledWith(0, 'playing');

    actor.send({ type: 'AUDIO_TIMEUPDATE', progress: 0.5 });
    expect(actor.getSnapshot().context.progressRatio).toBeCloseTo(0.5);

    actor.send({ type: 'PAUSE' });
    expect(actor.getSnapshot().value).toBe('paused');
    expect(statusSpy).toHaveBeenCalledWith(0, 'paused');

    actor.send({ type: 'STOP' });
    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.autoplay).toBe(false);
  });
});
