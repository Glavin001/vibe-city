export type SplitOptions = {
  softPunctRegex?: RegExp;
  hardPunctRegex?: RegExp;
  spaceWeight?: number;
  charWeight?: number;
  softPunctPauseWeight?: number;
  hardPunctPauseWeight?: number;
  snapToWordBoundary?: boolean;
};

/**
 * Compute an index in `text` corresponding to an approximate spoken progress
 * given a playback `ratio` in [0, 1]. The mapping is character-based but
 * weighted by punctuation to better reflect speaking pauses, and it snaps the
 * resulting index to the nearest word boundary by default.
 */
export function splitIndexByWeightedRatio(
  text: string,
  ratio: number,
  options: SplitOptions = {},
): number {
  const length = text.length;
  if (length === 0) return 0;

  const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

  const softPunct = options.softPunctRegex ?? /[,;:—–\-]/;
  const hardPunct = options.hardPunctRegex ?? /[.!?]/;
  const baseCharWeight = options.charWeight ?? 1.0;
  const spaceWeight = options.spaceWeight ?? 0.3;
  const softPause = options.softPunctPauseWeight ?? 3; // tuned empirically
  const hardPause = options.hardPunctPauseWeight ?? 9; // tuned empirically
  const snapToWord = options.snapToWordBoundary ?? true;

  // Precompute per-character weights
  const weights = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const ch = text[i];
    let w = baseCharWeight;
    if (ch === " ") w = spaceWeight;
    if (softPunct.test(ch)) w = Math.max(w, 0.2);
    if (hardPunct.test(ch)) w = Math.max(w, 0.2);

    // Add pause weighting at the punctuation itself to emulate speaking pauses
    if (softPunct.test(ch)) w += softPause;
    if (hardPunct.test(ch)) w += hardPause;
    weights[i] = w;
  }

  // Compute target cumulative weight
  let total = 0;
  for (let i = 0; i < length; i++) total += weights[i];
  const target = total * r;

  // Walk to the index where cumulative weight meets/exceeds target
  let cumulative = 0;
  let i = 0;
  for (; i < length; i++) {
    cumulative += weights[i];
    if (cumulative >= target) break;
  }
  if (!snapToWord) return Math.max(0, Math.min(length, i));

  // Snap to nearest word boundary (whitespace) to avoid mid-word splits
  // Find left boundary (index of whitespace or 0)
  let left = i;
  while (left > 0 && !/\s/.test(text[left])) left--;
  // Find right boundary (index of whitespace or length)
  let right = i;
  while (right < length && !/\s/.test(text[right])) right++;

  if (left === 0) return Math.min(right, length);
  if (right === length) return Math.max(left, 0);

  // Choose whichever boundary is closer to i
  const distLeft = i - left;
  const distRight = right - i;
  return distLeft <= distRight ? left : right;
}

/**
 * Convenience helper that returns the spoken/remaining split of text using
 * `splitIndexByWeightedRatio`.
 */
export function splitTextByWeightedRatio(
  text: string,
  ratio: number,
  options?: SplitOptions,
): { spoken: string; remaining: string; index: number } {
  const idx = splitIndexByWeightedRatio(text, ratio, options);
  return {
    spoken: text.slice(0, idx),
    remaining: text.slice(idx),
    index: idx,
  };
}


