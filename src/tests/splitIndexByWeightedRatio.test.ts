import { describe, expect, it } from "vitest";
import { splitIndexByWeightedRatio, splitTextByWeightedRatio } from "../lib/tts/progressSplit";

describe("splitIndexByWeightedRatio", () => {
  it("clamps ratio and handles empty text", () => {
    expect(splitIndexByWeightedRatio("", 0.5)).toBe(0);
    expect(splitIndexByWeightedRatio("abc", -1)).toBeGreaterThanOrEqual(0);
    expect(splitIndexByWeightedRatio("abc", 2)).toBeLessThanOrEqual(3);
  });

  it("is monotonic with ratio", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    let prev = -1;
    for (let r = 0; r <= 10; r++) {
      const idx = splitIndexByWeightedRatio(text, r / 10);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("snaps to word boundaries by default", () => {
    const text = "Hello wonderful world";
    const idx = splitIndexByWeightedRatio(text, 0.33);
    // Should not split inside a word
    expect(idx === 0 || /\s/.test(text[idx]) || /\s/.test(text[idx - 1])).toBe(true);
  });

  it("weights punctuation to delay progress across clauses", () => {
    const withPunct = "Hello, this is a test. Short.";
    const withoutPunct = withPunct.replaceAll(/[,!.?]/g, "");
    const r = 0.5;
    const idxPunct = splitIndexByWeightedRatio(withPunct, r);
    const idxNoPunct = splitIndexByWeightedRatio(withoutPunct, r);
    // With punctuation weighting, index should be further along characters
    // for the same ratio (because pauses add weight early on)
    expect(idxPunct).toBeGreaterThanOrEqual(Math.min(idxNoPunct, withPunct.length));
  });

  it("snapping alters an interior raw index", () => {
    const text = "This has anextremelylongword inside for snapping check";
    let found = false;
    for (let step = 1; step < 99; step++) {
      const r = step / 100;
      const idxRaw = splitIndexByWeightedRatio(text, r, { snapToWordBoundary: false });
      if (idxRaw > 0 && idxRaw < text.length && !/\s/.test(text[idxRaw]) && !/\s/.test(text[idxRaw - 1])) {
        const idxSnapped = splitIndexByWeightedRatio(text, r, { snapToWordBoundary: true });
        // Snapped index should move to a boundary and differ from raw when raw is interior
        expect(idxSnapped).not.toBe(idxRaw);
        expect(idxSnapped === 0 || /\s/.test(text[idxSnapped]) || /\s/.test(text[idxSnapped - 1])).toBe(true);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});

describe("splitTextByWeightedRatio", () => {
  it("returns spoken and remaining parts consistent with index", () => {
    const text = "A short sentence.";
    const { spoken, remaining, index } = splitTextByWeightedRatio(text, 0.4);
    expect(spoken.length + remaining.length).toBe(text.length);
    expect(spoken + remaining).toBe(text);
    expect(index).toBe(spoken.length);
  });
});

describe("no character loss across ratios", () => {
  it("keeps all characters for the provided example input", () => {
    const text = "Hey there! I'm doing well, thanks for asking. Just taking it all in, you know? How about yourself? What's new in your world?";
    for (let i = 0; i <= 100; i++) {
      const r = i / 100;
      const idx = splitIndexByWeightedRatio(text, r);
      const spoken = text.slice(0, idx);
      const remaining = text.slice(idx);
      expect(spoken.length + remaining.length).toBe(text.length);
      expect(spoken + remaining).toBe(text);
    }
  });
});
