import type { AlignmentData } from "../page";

/**
 * Finds the index of the currently active item based on current time
 */
export function getActiveTimingIndex(alignment: AlignmentData, currentTime: number): number {
  for (let i = 0; i < alignment.startTimes.length; i++) {
    if (currentTime >= alignment.startTimes[i] && currentTime <= alignment.endTimes[i]) {
      return i;
    }
  }
  return -1;
}

/**
 * Formats time in seconds to a display string with appropriate precision
 */
export function formatTime(seconds: number, precision: number = 3): string {
  return `${seconds.toFixed(precision)}s`;
}

/**
 * Calculates duration between start and end times
 */
export function calculateDuration(startTime: number, endTime: number): number {
  return endTime - startTime;
}

/**
 * Converts word alignment data to AlignmentData format
 */
export function createWordAlignmentData(wordAlignment: {
  words: string[];
  wordStartTimeSeconds: number[];
  wordEndTimeSeconds: number[];
}): AlignmentData {
  return {
    items: wordAlignment.words,
    startTimes: wordAlignment.wordStartTimeSeconds,
    endTimes: wordAlignment.wordEndTimeSeconds,
  };
}

/**
 * Converts character alignment data to AlignmentData format
 */
export function createCharacterAlignmentData(characterAlignment: {
  characters: string[];
  characterStartTimeSeconds: number[];
  characterEndTimeSeconds: number[];
}): AlignmentData {
  return {
    items: characterAlignment.characters,
    startTimes: characterAlignment.characterStartTimeSeconds,
    endTimes: characterAlignment.characterEndTimeSeconds,
  };
}
