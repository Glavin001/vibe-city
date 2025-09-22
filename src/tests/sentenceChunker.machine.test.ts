import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { sentenceChunkerMachine } from '../machines/sentenceChunker.machine';

describe('sentenceChunkerMachine', () => {
  it('initializes chunker and accumulates pushed text', () => {
    const actor = createActor(sentenceChunkerMachine);
    actor.start();

    expect(actor.getSnapshot().value).toBe('idle');

    actor.send({ type: 'INIT' });
    expect(actor.getSnapshot().value).toBe('ready');

    actor.send({ type: 'PUSH', text: 'Hello world. This is a test.' });
    expect(actor.getSnapshot().context.chunks.length).toBeGreaterThan(0);

    const preFlushLength = actor.getSnapshot().context.chunks.length;
    actor.send({ type: 'FLUSH' });
    expect(actor.getSnapshot().context.chunks.length).toBeGreaterThanOrEqual(preFlushLength);

    actor.send({ type: 'RESET', options: { locale: 'en', charLimit: 42 } });
    const ctx = actor.getSnapshot().context;
    expect(ctx.options.charLimit).toBe(42);
    expect(ctx.chunks).toHaveLength(0);
    expect(ctx.chunker).not.toBeNull();
  });
});
