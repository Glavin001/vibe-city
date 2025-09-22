import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { whisperLocalMachine } from '../machines/whisper.machine';

describe('whisperLocalMachine', () => {
  it('updates and resets segment metadata', () => {
    const actor = createActor(whisperLocalMachine);
    actor.start();

    actor.send({ type: 'SET_PROCESSING', value: true });
    actor.send({ type: 'SET_FINALIZING', value: true });
    actor.send({ type: 'SET_SEGMENT_START', index: 3 });
    actor.send({ type: 'SET_LAST_DECODED_COUNT', count: 4 });
    const blob = new Blob(['header']);
    actor.send({ type: 'SET_HEADER_CHUNK', blob });

    expect(actor.getSnapshot().context).toMatchObject({
      isProcessing: true,
      finalizing: true,
      segmentStartIndex: 3,
      lastDecodedChunkCount: 4,
      headerChunk: blob,
    });

    actor.send({ type: 'RESET_SEGMENT' });
    expect(actor.getSnapshot().context.segmentStartIndex).toBe(0);
    expect(actor.getSnapshot().context.lastDecodedChunkCount).toBe(0);
    expect(actor.getSnapshot().context.headerChunk).toBeNull();
  });
});
