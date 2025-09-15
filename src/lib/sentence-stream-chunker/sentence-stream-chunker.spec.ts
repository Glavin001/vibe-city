import { describe, it, expect } from 'vitest';
import { SentenceStreamChunker } from './sentence-stream-chunker';

describe('SentenceStreamChunker', () => {
  it('should chunk streamed text into sentence-sized pieces and split overlong sentences at soft punctuation', () => {
    const chunker = new SentenceStreamChunker({
      locale: 'en',
      charLimit: 220,       // tweak as needed
      wordLimit: 45,        // or Infinity to disable
      // softPunct: /[,;:—–\-]/ // default is fine
    });

    const parts = [
      "We’re streaming text. It arrives in pieces,",
      " sometimes mid-sentence. This one is deliberately very long, containing multiple clauses, commas, and dashes — so it will be split at soft punctuation if it exceeds the configured limits.",
      " Final short sentence!"
    ];

    const allChunks: any[] = [];

    for (const p of parts) {
      for (const c of chunker.push(p)) {
        allChunks.push(c);
      }
    }

    // End of stream → flush trailing partials
    for (const c of chunker.flush()) {
      allChunks.push(c);
    }

    // Basic expectations: should emit at least 3 chunks (one per sentence, but may split long ones)
    expect(allChunks.length).toBeGreaterThanOrEqual(3);

    // Check that each chunk has required properties and text is non-empty
    for (const chunk of allChunks) {
      expect(typeof chunk.text).toBe('string');
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(typeof chunk.idx).toBe('number');
      expect(typeof chunk.sentenceIdx).toBe('number');
      expect(typeof chunk.pieceIdx).toBe('number');
      expect(typeof chunk.isSentenceFinal).toBe('boolean');
      expect(typeof chunk.isStreamFinal).toBe('boolean');
      expect(typeof chunk.startOffset).toBe('number');
      expect(typeof chunk.endOffset).toBe('number');
      expect(typeof chunk.isFirst).toBe('boolean');
    }

    // Check that the last chunk is marked as stream final
    expect(allChunks[allChunks.length - 1].isStreamFinal).toBe(true);

    // Optionally, check that the chunks reconstruct the original text (ignoring leading/trailing whitespace)
    const reconstructed = allChunks.map(c => c.text).join(' ').replace(/\s+/g, ' ').trim();
    const original = parts.join('').replace(/\s+/g, ' ').trim();
    expect(reconstructed).toContain("We’re streaming text.");
    expect(reconstructed).toContain("It arrives in pieces,");
    expect(reconstructed).toContain("Final short sentence!");
    // The reconstructed text should contain all the original sentences
    expect(reconstructed).toContain("This one is deliberately very long, containing multiple clauses, commas, and dashes — so it will be split at soft punctuation if it exceeds the configured limits.");
  });

  it('honors charLimit and prefers soft punctuation when splitting', () => {
    const chunker = new SentenceStreamChunker({
      locale: 'en',
      charLimit: 40,
      wordLimit: Number.POSITIVE_INFINITY,
    });

    const longSentence =
      'This sentence is deliberately crafted, with commas, dashes — and clauses, to exceed the char limit considerably without a terminal period';

    const chunks: any[] = [];
    for (const c of chunker.push(longSentence)) chunks.push(c);
    for (const c of chunker.flush()) chunks.push(c);

    // Should split the single sentence into multiple pieces
    expect(chunks.length).toBeGreaterThan(1);

    // No chunk should be excessively longer than the limit (allow slight overage near soft punctuation)
    const maxLen = Math.max(...chunks.map((c) => c.text.length));
    expect(maxLen).toBeLessThanOrEqual(60); // 40 limit + soft boundary tolerance

    // Prefer splitting at soft punctuation (commas/colons/semicolons/dashes)
    const softEndRe = /[,:;—–-]\s*$/;
    expect(chunks.slice(0, -1).some((c) => softEndRe.test(c.text))).toBe(true);

    // Last emitted chunk should be stream final
    expect(chunks[chunks.length - 1].isStreamFinal).toBe(true);
  });

  it('honors wordLimit when charLimit is Infinity', () => {
    const chunker = new SentenceStreamChunker({
      locale: 'en',
      charLimit: Number.POSITIVE_INFINITY,
      wordLimit: 5,
    });

    const longSentence =
      'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';

    const chunks: any[] = [];
    for (const c of chunker.push(longSentence)) chunks.push(c);
    for (const c of chunker.flush()) chunks.push(c);

    // Should split by word count
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      const words = (c.text.trim().match(/\S+/g) ?? []).length;
      expect(words).toBeLessThanOrEqual(5);
    }

    // Last emitted chunk should be stream final
    expect(chunks[chunks.length - 1].isStreamFinal).toBe(true);
  });
});
