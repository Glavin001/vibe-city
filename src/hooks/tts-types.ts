export type VoiceInfo = {
  name: string;
  language: string;
  gender: string;
};

export type TtsUiChunkStatus =
  | "pending"
  | "generating"
  | "ready"
  | "playing"
  | "paused"
  | "played"
  | "error"
  | "skipped";

export type TtsUiChunk = {
  id: number;
  chunkIdx: number;
  sentenceIdx: number;
  pieceIdx: number;
  text: string;
  isSentenceFinal: boolean;
  isStreamFinal: boolean;
  startOffset: number;
  endOffset: number;
  status: TtsUiChunkStatus;
  audioUrl?: string;
  requestId?: number;
};


