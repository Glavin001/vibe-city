// Incrementally splits streamed text into sentence-sized chunks,
// then further splits overlong sentences at natural punctuation.
// Works in the browser; uses Intl.Segmenter when available.

/** A single emitted chunk, ready for TTS. */
export interface Chunk {
    /** Trimmed text for consumption (e.g., TTS). */
    text: string;
    /** Global emitted-chunk ordinal (0,1,2,...) */
    idx: number;
    /** Ordinal of the original sentence (0-based). */
    sentenceIdx: number;
    /** Piece ordinal within the sentence (0-based). */
    pieceIdx: number;
    /** True if this piece ends a sentence boundary. */
    isSentenceFinal: boolean;
    /** True only for the very last piece when end-of-stream is known. */
    isStreamFinal: boolean;
    /** [inclusive] char offset in the original stream. */
    startOffset: number;
    /** [exclusive] char offset in the original stream. */
    endOffset: number;
    /** True only for the first emitted chunk overall. */
    isFirst: boolean;
}

/** Tuning options for the chunker. */
export interface SentenceStreamChunkerOptions {
    /** Locale for Intl.Segmenter. */
    locale?: string;
    /** Max characters per emitted chunk (Infinity to disable). */
    charLimit?: number;
    /** Max words per emitted chunk (Infinity to disable). */
    wordLimit?: number;
    /**
     * Preferred inner split punctuation for long sentences.
     * Examples: commas, semicolons, colons, em/en dashes, hyphen.
     */
    softPunct?: RegExp;
}

/** Minimal shape of a Segmenter segment (keeps TS happy on older lib targets). */
interface SegmentLike {
    segment: string;
    index: number;
}
interface SegmenterLike {
    segment(input: string): Iterable<SegmentLike>;
}

export class SentenceStreamChunker {
    private readonly opts: Required<SentenceStreamChunkerOptions>;
    private buffer = '';
    private totalOffset = 0;   // characters consumed from the original stream
    private sentenceIdx = 0;   // ordinal of completed sentences
    private chunkIdx = 0;      // ordinal of all emitted chunks
    private seg?: SegmenterLike;
    private lastEmittedChunk?: Chunk; // track last emitted chunk so we can mark stream-final on flush

    constructor(opts: SentenceStreamChunkerOptions = {}) {
        this.opts = {
            locale: opts.locale ?? 'en',
            charLimit: opts.charLimit ?? 280,
            wordLimit: opts.wordLimit ?? Number.POSITIVE_INFINITY,
            softPunct: opts.softPunct ?? /[,;:—–\-\.{3}…]/,
        };

        if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
            this.seg = new (Intl as any).Segmenter(this.opts.locale, {
                granularity: 'sentence',
            }) as SegmenterLike;
        }
    }

    /**
     * Push new streamed text into the splitter.
     * Returns newly finalized chunks (if any).
     */
    push(text: string, opts: { eos?: boolean } = {}): Chunk[] {
        const { eos = false } = opts;
        if (text) this.buffer += text;

        const out: Chunk[] = [];
        let consumedThrough = 0;

        const emitSentenceWithLimits = (
            sentStart: number,
            sentEnd: number,
            isFinalBoundary: boolean,
            isEndOfStream: boolean
        ) => {
            const sentenceRaw = this.buffer.slice(sentStart, sentEnd);
            const splits = this.splitsForLimits(sentenceRaw);

            for (let i = 0; i < splits.length; i++) {
                const { from, to } = splits[i]; // indices relative to sentenceRaw
                const absStart = sentStart + from;
                const absEnd = sentStart + to;

                const rawSlice = this.buffer.slice(absStart, absEnd);
                const textOut = rawSlice.trim();
                if (!textOut) continue;

                const isFirst = this.chunkIdx === 0;
                const idx = this.chunkIdx++;

                const chunk: Chunk = {
                    text: textOut,
                    idx,
                    sentenceIdx: this.sentenceIdx,
                    pieceIdx: i,
                    isSentenceFinal: isFinalBoundary && i === splits.length - 1,
                    isStreamFinal: !!(isEndOfStream && i === splits.length - 1),
                    startOffset: this.totalOffset + absStart,
                    endOffset: this.totalOffset + absEnd,
                    isFirst,
                };
                out.push(chunk);
                this.lastEmittedChunk = chunk;
            }

            this.sentenceIdx++;
            consumedThrough = Math.max(consumedThrough, sentEnd);
        };

        if (this.seg) {
            // Robust sentence boundaries via Intl.Segmenter
            const segments = this.seg.segment(this.buffer);
            for (const s of segments) {
                const start = s.index;
                const end = start + s.segment.length;
                const isLast = end === this.buffer.length;
                const hasEOS = this.endsWithSentencePunct(s.segment);

                if (hasEOS || (!isLast && s.segment.trim())) {
                    // Confident boundary
                    emitSentenceWithLimits(start, end, hasEOS, eos && isLast);
                } else if (eos && isLast && s.segment.trim()) {
                    // Stream ended: flush trailing partial
                    emitSentenceWithLimits(start, end, /*finalBoundary*/ false, /*endOfStream*/ true);
                }
            }
        } else {
            // Fast regex fallback when Intl.Segmenter is unavailable.
            // Matches up to ., !, ?, …, or ... (optionally followed by quotes/brackets), then whitespace or EoB.
            const re = /([\s\S]*?)((?:\.{3}|[.?!…])(?:["'”’)\]]*)?)(?=\s+|$)/g;
            let m: RegExpExecArray | null;
            let lastEnd = 0;

            m = re.exec(this.buffer);
            while (m) {
                const body = m[1] ?? '';
                const punct = m[2] ?? '';
                const start = m.index;
                const end = re.lastIndex;
                const raw = body + punct;
                if (raw.trim()) {
                    emitSentenceWithLimits(start, end, punct.length > 0, false);
                }
                lastEnd = end;
                m = re.exec(this.buffer);
            }
            consumedThrough = Math.max(consumedThrough, lastEnd);

            if (eos && consumedThrough < this.buffer.length) {
                // flush remaining tail as partial
                emitSentenceWithLimits(consumedThrough, this.buffer.length, false, true);
                consumedThrough = this.buffer.length;
            }
        }

        // Drop consumed prefix & advance global offset
        if (consumedThrough > 0) {
            this.buffer = this.buffer.slice(consumedThrough);
            this.totalOffset += consumedThrough;
        }

        // If end-of-stream and nothing new emitted, mark the previously emitted
        // last chunk as stream-final so downstream can finalize cleanly.
        if (eos && out.length === 0 && this.lastEmittedChunk && !this.lastEmittedChunk.isStreamFinal) {
            this.lastEmittedChunk.isStreamFinal = true;
        }

        return out;
    }

    /** Finalize any remaining text and mark the last chunk as stream-final. */
    flush(): Chunk[] {
        return this.push('', { eos: true });
    }

    // -------------------- internals --------------------

    private endsWithSentencePunct(str: string): boolean {
        // Ends with ., !, ?, …, or ... possibly followed by quotes/closing brackets, then optional spaces.
        return /((?:\.{3}|[.?!…])(?:["'”’)\]]*)?)\s*$/.test(str);
    }

    /**
     * Compute inner splits for a sentence so it respects char/word limits.
     * Returns ranges [{from,to}] relative to the sentence string.
     */
    private splitsForLimits(sentenceRaw: string): Array<{ from: number; to: number }> {
        const { charLimit, wordLimit, softPunct } = this.opts;
        const res: Array<{ from: number; to: number }> = [];
        let from = 0;

        const finiteChars = Number.isFinite(charLimit);
        const finiteWords = Number.isFinite(wordLimit);

        const countWords = (s: string) => (s.trim().match(/\S+/g) ?? []).length;

        const indexAfterNWords = (s: string, n: number) => {
            if (!Number.isFinite(n)) return s.length;
            let count = 0;
            const re = /\S+\s*/g;
            let m: RegExpExecArray | null;
            let last = 0;
            m = re.exec(s);
            while (m && count < n) {
                last = re.lastIndex;
                count++;
                m = re.exec(s);
            }
            return last || s.length;
        };

        const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

        const findSoftBoundary = (s: string, preferred: number) => {
            const len = s.length;
            const half = finiteChars ? Math.floor((charLimit as number) * 0.5) : Math.floor(len * 0.5);
            const fwd = finiteChars ? Math.floor((charLimit as number) * 0.25) : Math.floor(len * 0.25);

            const backStart = clamp(preferred - half, 0, len);
            const backEnd = clamp(preferred, 0, len);

            // 1) backward: soft punctuation + following space
            for (let i = backEnd; i >= backStart; i--) {
                if (softPunct.test(s[i])) {
                    const after = i + 1 + ((s.slice(i + 1).match(/^\s+/)?.[0].length) ?? 0);
                    return after;
                }
            }
            // 2) backward: any whitespace
            for (let i = backEnd; i >= backStart; i--) {
                if (/\s/.test(s[i])) return i + 1;
            }
            // 3) forward a bit: soft punctuation
            const forwardEnd = clamp(preferred + fwd, 0, len);
            for (let i = preferred; i < forwardEnd; i++) {
                if (softPunct.test(s[i])) {
                    const after = i + 1 + ((s.slice(i + 1).match(/^\s+/)?.[0].length) ?? 0);
                    return after;
                }
            }
            // 4) hard cut
            return preferred;
        };

        while (from < sentenceRaw.length) {
            const remaining = sentenceRaw.slice(from);
            const words = countWords(remaining);

            const okChars = !finiteChars || remaining.length <= (charLimit as number);
            const okWords = !finiteWords || words <= (wordLimit as number);

            if (okChars && okWords) {
                res.push({ from, to: sentenceRaw.length });
                break;
            }

            const prefByChars = finiteChars ? Math.min(charLimit as number, remaining.length) : remaining.length;
            const prefByWords = finiteWords ? indexAfterNWords(remaining, wordLimit as number) : remaining.length;
            const preferred = Math.max(1, Math.min(prefByChars, prefByWords)); // avoid zero-length

            const cut = findSoftBoundary(remaining, preferred);

            // include trailing spaces so offsets remain contiguous
            const trailingWs = (remaining.slice(cut).match(/^\s+/)?.[0].length) ?? 0;
            const to = from + cut + trailingWs;

            res.push({ from, to });
            from = to;
        }

        return res;
    }
}
