import type { TtsResponse } from "../page";
import { getActiveTimingIndex, formatTime, createWordAlignmentData, createCharacterAlignmentData } from "../utils/timingUtils";

interface TimingDisplayProps {
  timestampInfo: TtsResponse['timestampInfo'] | null;
  currentTime: number;
}

interface AlignmentRowProps {
  item: string;
  startTime: number;
  endTime: number;
  isActive: boolean;
  isWord: boolean;
}

function AlignmentRow({ item, startTime, endTime, isActive, isWord }: AlignmentRowProps) {
  const duration = endTime - startTime;

  return (
    <div
      className={`grid grid-cols-4 gap-2 text-xs font-mono p-1 rounded transition-colors ${
        isActive ? 'bg-yellow-900/30 border border-yellow-600/50' : ''
      }`}
    >
      <div className={`font-medium ${isActive ? (isWord ? 'text-blue-300' : 'text-purple-300') : (isWord ? 'text-blue-400' : 'text-purple-400')}`}>
        "{item}"
      </div>
      <div className={isActive ? 'text-gray-200' : 'text-gray-400'}>
        {formatTime(startTime)}
      </div>
      <div className={isActive ? 'text-gray-200' : 'text-gray-400'}>
        {formatTime(endTime)}
      </div>
      <div className={isActive ? 'text-green-300' : 'text-green-400'}>
        {formatTime(duration)}
      </div>
    </div>
  );
}

function WordAlignmentDisplay({
  wordAlignment,
  currentTime
}: {
  wordAlignment: NonNullable<TtsResponse['timestampInfo']>['wordAlignment'];
  currentTime: number;
}) {
  const alignmentData = createWordAlignmentData(wordAlignment);
  const activeIndex = getActiveTimingIndex(alignmentData, currentTime);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Word Alignment</h3>
      <div className="max-h-60 overflow-auto border border-gray-600 rounded p-3 bg-gray-800/50">
        <div className="grid grid-cols-4 gap-2 text-xs font-mono mb-2 text-gray-400">
          <div className="font-semibold">Word</div>
          <div className="font-semibold">Start</div>
          <div className="font-semibold">End</div>
          <div className="font-semibold">Duration</div>
        </div>
        {wordAlignment.words.map((word, i) => (
          <AlignmentRow
            key={`word-${word}-${wordAlignment.wordStartTimeSeconds[i]}-${wordAlignment.wordEndTimeSeconds[i]}`}
            item={word}
            startTime={wordAlignment.wordStartTimeSeconds[i]}
            endTime={wordAlignment.wordEndTimeSeconds[i]}
            isActive={i === activeIndex}
            isWord={true}
          />
        ))}
      </div>
    </div>
  );
}

function CharacterAlignmentDisplay({
  characterAlignment,
  currentTime
}: {
  characterAlignment: NonNullable<TtsResponse['timestampInfo']>['characterAlignment'];
  currentTime: number;
}) {
  const alignmentData = createCharacterAlignmentData(characterAlignment);
  const activeIndex = getActiveTimingIndex(alignmentData, currentTime);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">Character Alignment</h3>
      <div className="max-h-60 overflow-auto border border-gray-600 rounded p-3 bg-gray-800/50">
        <div className="grid grid-cols-4 gap-2 text-xs font-mono mb-2 text-gray-400">
          <div className="font-semibold">Char</div>
          <div className="font-semibold">Start</div>
          <div className="font-semibold">End</div>
          <div className="font-semibold">Duration</div>
        </div>
        {characterAlignment.characters.map((char, i) => (
          <AlignmentRow
            key={`char-${char}-${characterAlignment.characterStartTimeSeconds[i]}-${characterAlignment.characterEndTimeSeconds[i]}`}
            item={char}
            startTime={characterAlignment.characterStartTimeSeconds[i]}
            endTime={characterAlignment.characterEndTimeSeconds[i]}
            isActive={i === activeIndex}
            isWord={false}
          />
        ))}
      </div>
    </div>
  );
}

export function TimingDisplay({ timestampInfo, currentTime }: TimingDisplayProps) {
  if (!timestampInfo) return null;

  return (
    <div className="border border-gray-600 rounded-xl p-4 space-y-3 bg-gray-800/30">
      <h2 className="text-lg font-semibold text-gray-200">Timing Data</h2>

      {timestampInfo.wordAlignment && (
        <WordAlignmentDisplay
          wordAlignment={timestampInfo.wordAlignment}
          currentTime={currentTime}
        />
      )}

      {timestampInfo.characterAlignment && (
        <CharacterAlignmentDisplay
          characterAlignment={timestampInfo.characterAlignment}
          currentTime={currentTime}
        />
      )}

      <p className="text-xs text-gray-400">
        Timing data shows when each word/character starts and ends in the audio.
        Useful for karaoke-style highlighting or lip-sync applications.
      </p>
    </div>
  );
}
