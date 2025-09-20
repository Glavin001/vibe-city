import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActorRef, useSelector } from '@xstate/react';
import { createWhisperLocalMachine } from '../machines/whisper.machine';
import { useAudioRecorder } from './use-audio-recorder';
import { useSpeechRecognition } from './use-speech-recognition';
import type { SpeechRecognitionStatus } from './use-speech-recognition';

export interface WhisperOptions {
  /**
   * The language to use for speech recognition
   * @default 'en'
   */
  language?: string;
  /**
   * Whether to automatically start recording when the model is ready
   * @default false
   */
  autoStart?: boolean;
  /**
   * Callback for when the final complete text is available
   * This is called only once at the end of recognition with the final result
   */
  onTextChange?: (text: string) => void;
  /**
   * Callback for incremental text updates during recognition
   * This is called multiple times during recognition as tokens are generated
   * @deprecated Doesn't work
   */
  // onTextUpdate?: (text: string) => void;
  /**
   * Callback for when the status changes
   */
  onStatusChange?: (status: SpeechRecognitionStatus) => void;
  /**
   * Callback for when an error occurs
   */
  onError?: (error: string) => void;
  /**
   * Interval in milliseconds to request data from the recorder
   * @default 250
   */
  dataRequestInterval?: number;
}

export interface WhisperResult {
  /**
   * The current status of the speech recognition
   */
  status: SpeechRecognitionStatus;
  /**
   * The recognized text
   */
  text: string;
  /**
   * The tokens per second
   */
  tps: number | null;
  /**
   * Whether the model is currently loading
   */
  isLoading: boolean;
  /**
   * Whether the model is ready to use
   */
  isReady: boolean;
  /**
   * Whether the model is currently processing audio
   */
  isProcessing: boolean;
  /**
   * Whether the microphone is currently recording
   */
  isRecording: boolean;
  /**
   * The current loading progress items
   */
  progressItems: Array<{
    file: string;
    progress: number;
    total: number;
  }>;
  /**
   * The current loading message
   */
  loadingMessage: string;
  /**
   * The audio stream from the microphone
   */
  stream: MediaStream | null;
  /**
   * Start recording from the microphone
   */
  startRecording: () => void;
  /**
   * Stop recording from the microphone
   */
  stopRecording: () => void;
  /**
   * Reset the recording and transcription
   */
  resetRecording: () => void;
  /**
   * Load the speech recognition model
   */
  loadModel: () => void;
  /**
   * Any error that occurred
   */
  error: string | null;
  /**
   * Finalize current recording window by decoding full audio and returning final transcript
   */
  finalizeCurrentRecording: () => Promise<string | null>;
  /**
   * Mark the current MediaRecorder chunk index as the start of the next segment (soft reset, no recorder stop)
   */
  markSegmentBoundary: (endChunkIndex?: number) => void;
  /**
   * Get the current number of MediaRecorder chunks captured so far
   */
  getChunkCount: () => number;
  /**
   * Finalize a partial window up to the provided chunk index (exclusive), returning final transcript
   */
  finalizeUpTo: (endChunkIndex: number) => Promise<string | null>;
}

const WHISPER_SAMPLING_RATE = 16000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;

/**
 * Hook for using Whisper speech recognition
 */
export function useWhisper({
  language = 'en',
  autoStart = false,
  onTextChange,
  // onTextUpdate,
  onStatusChange,
  onError,
  dataRequestInterval = 250,
}: WhisperOptions = {}): WhisperResult {
  const [error, setError] = useState<string | null>(null);
  const autoStartedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  // Local orchestration via XState
  const whisperLogic = useMemo(() => createWhisperLocalMachine(), []);
  const whisperActor = useActorRef(whisperLogic);
  const isProcessing = useSelector(whisperActor, (s) => s.context.isProcessing);
  const finalizing = useSelector(whisperActor, (s) => s.context.finalizing);
  const segmentStartIndex = useSelector(whisperActor, (s) => s.context.segmentStartIndex);
  const lastDecodedChunkCount = useSelector(whisperActor, (s) => s.context.lastDecodedChunkCount);
  const headerChunk = useSelector(whisperActor, (s) => s.context.headerChunk);
  // Finalization promise control (kept as refs)
  const finalizeResolverRef = useRef<((text: string) => void) | null>(null);
  const finalizeRejectRef = useRef<((reason?: unknown) => void) | null>(null);

  // Initialize the audio recorder
  const {
    startRecording,
    stopRecording,
    resetRecording: audioResetRecording,
    isRecording,
    stream,
    chunks,
  } = useAudioRecorder({
    mimeType: 'audio/webm',
    dataRequestInterval,
    onError: (err) => {
      setError(err);
      onError?.(err);
    },
  });

  // Initialize the speech recognition
  const {
    status,
    text,
    tps,
    isLoading,
    isReady,
    isProcessing: recognitionProcessing,
    progressItems,
    loadingMessage,
    loadModel,
    generateText,
    error: recognitionError,
  } = useSpeechRecognition({
    language,
    onStatusChange: (newStatus) => {
      if (onStatusChange) {
        onStatusChange(newStatus);
      }

      // Auto-start recording when the model is ready
      if (newStatus === 'ready' && autoStart && !autoStartedRef.current && !isRecording) {
        autoStartedRef.current = true;
        // Use setTimeout to avoid state update conflicts
        setTimeout(() => {
          startRecording();
        }, 100);
      }
    },
    onTextChange: (finalText) => {
      // Resolve a pending finalize promise first
      if (finalizeResolverRef.current) {
        try {
          finalizeResolverRef.current(finalText ?? '');
        } finally {
          finalizeResolverRef.current = null;
          finalizeRejectRef.current = null;
          whisperActor.send({ type: 'SET_FINALIZING', value: false });
        }
      }
      if (onTextChange) {
        onTextChange(finalText);
      }
    },
    onTextUpdate: (live) => {
      // Bridge incremental updates to the consumer's onTextChange for live transcript
      if (onTextChange) onTextChange(live);
    },
    onError: (err) => {
      setError(err);
      onError?.(err);
    },
  });

  // Process audio chunks when they are available
  useEffect(() => {
    // Only process if we have new chunks, are recording, not already processing, and the model is ready
    // Additionally, avoid calling generate while recognition is mid-flight (status 'start'/'update')
    // Debug gates
    console.debug('[Whisper] gate', {
      finalizing,
      chunks: chunks.length,
      lastDecodedChunkCount,
      isRecording,
      isProcessing,
      isReady,
      status,
    });
    if (
      finalizing ||
      chunks.length <= lastDecodedChunkCount ||
      !isRecording ||
      isProcessing ||
      !isReady ||
      (status !== 'ready' && status !== 'complete')
    ) {
      // Explain which gate blocked
      if (finalizing) {
        console.debug('[Whisper] skip: finalizing');
      } else if (chunks.length <= lastDecodedChunkCount) {
        // console.debug('[Whisper] skip: no new chunks'); // Happens often
      } else if (!isRecording) {
        console.debug('[Whisper] skip: not recording');
      } else if (isProcessing) {
        console.debug('[Whisper] skip: already processing');
      } else if (!isReady) {
        console.debug('[Whisper] skip: model not ready');
      } else {
        console.debug('[Whisper] skip: status not ready/complete', status);
      }
      return;
    }

    const processAudio = async () => {
      try {
        whisperActor.send({ type: 'SET_PROCESSING', value: true });
        // console.log('Starting audio processing...');

        // Create audio context if it doesn't exist
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
          console.log('Created new AudioContext with sample rate:', WHISPER_SAMPLING_RATE);
        }

        // Ensure we captured the header (initialization) chunk at the start of this recording window
        if (!headerChunk && chunks.length > 0) {
          whisperActor.send({ type: 'SET_HEADER_CHUNK', blob: chunks[0] });
          console.debug('[Whisper] captured header');
        }

        // Build a small window of recent chunks, always prepending the header chunk for decodability
        // Guard: need header and at least 2 recent chunks to form a decodable WebM segment
        if (!headerChunk) {
          console.debug('[Whisper] header missing; waiting');
          return;
        }
        const MAX_RECENT_CHUNKS = 12; // ~window
        const segStartForWindow = headerChunk && segmentStartIndex === 0 ? 1 : segmentStartIndex;
        const startRecent = Math.max(segStartForWindow, chunks.length - MAX_RECENT_CHUNKS);
        const recent = chunks.slice(startRecent);
        if (recent.length < 2) {
          console.debug('[Whisper] too few recent chunks', { startRecent, recent: recent.length });
          return; // wait for more data
        }
        const toDecode: Blob[] = [headerChunk, ...recent];
        // Ensure minimum blob size to reduce decode failures on partial clusters
        const totalBytes = toDecode.reduce((acc, b) => acc + (b?.size || 0), 0);
        if (totalBytes < 16 * 1024) {
          console.debug('[Whisper] window too small', { totalBytes });
          return;
        }

        const blob = new Blob(toDecode, { type: 'audio/webm' });
        // console.log('Created blob (header + recent) size:', blob.size, 'chunksUsed:', toDecode.length);

        // Read the blob as an array buffer
        const arrayBuffer = await blob.arrayBuffer();
        // console.log('Converted blob to arrayBuffer, size:', arrayBuffer.byteLength);

        // Decode the audio data (may fail for incomplete WebM; skip on failure without surfacing error)
        let audioData: AudioBuffer;
        try {
          audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
        } catch (_) {
          console.debug('[Whisper] decode failed; will retry next tick');
          return; // try again on next tick with more data
        }
        // console.log('Decoded audio data, duration:', audioData.duration, 'seconds');

        // Get the audio samples
        let audio = audioData.getChannelData(0);
        console.debug('[Whisper] decoded samples', { length: audio.length });
        // console.log('Got audio samples, length:', audio.length);

        // Trim to max length if needed (safety cap)
        if (audio.length > MAX_SAMPLES) {
          console.warn(`[useWhisper] Trimming audio from ${audio.length} to ${MAX_SAMPLES} samples`);
          audio = audio.slice(-MAX_SAMPLES);
        }

        // Generate text from the audio (only when recognition is idle/ready)
        // console.log('Sending audio to speech recognition...');
        const ok = generateText(audio);
        console.debug('[Whisper] generateText sent', { ok });
        if (ok) {
          whisperActor.send({ type: 'SET_LAST_DECODED_COUNT', count: chunks.length });
        }
      } catch (_) {
        // Swallow sporadic decode errors; let the next data window retry.
      } finally {
        whisperActor.send({ type: 'SET_PROCESSING', value: false });
      }
    };

    processAudio();
  }, [chunks, isRecording, isProcessing, isReady, status, generateText, finalizing, lastDecodedChunkCount, segmentStartIndex, headerChunk, whisperActor]);

  // Safe reset function that handles the autoStart flag
  const safeResetRecording = useCallback(() => {
    // Stop recording if it's active
    if (isRecording) {
      stopRecording();
    }

    // Reset the audio recorder
    audioResetRecording();
    // Reset decoding state so we start fresh on next recording window
    whisperActor.send({ type: 'RESET_SEGMENT' });
    whisperActor.send({ type: 'SET_FINALIZING', value: false });
    finalizeResolverRef.current = null;
    finalizeRejectRef.current = null;

    // Reset the autoStarted flag
    autoStartedRef.current = false;

    // If autoStart is enabled and the model is ready, start recording again after a short delay
    if (autoStart && isReady) {
      setTimeout(() => {
        autoStartedRef.current = true;
        startRecording();
      }, 100);
    }
  }, [isRecording, stopRecording, audioResetRecording, autoStart, isReady, startRecording, whisperActor]);

  // Finalize by decoding full recording window and returning final transcript
  const finalizeCurrentRecording = useCallback(async (): Promise<string | null> => {
    try {
      if (!isReady) return null;
      if (!chunks.length) return (text ?? '') || null;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
      }

      whisperActor.send({ type: 'SET_FINALIZING', value: true });
      whisperActor.send({ type: 'SET_PROCESSING', value: true });

      // Build full blob for CURRENT SEGMENT ONLY: header + chunks since segmentStartIndex (off-by-one safe)
      const parts: Blob[] = [];
      if (headerChunk) {
        parts.push(headerChunk);
        const start = segmentStartIndex === 0 ? 1 : segmentStartIndex;
        parts.push(...chunks.slice(start));
      } else {
        const start = Math.max(segmentStartIndex, 0);
        parts.push(...chunks.slice(start));
      }
      const fullBlob = new Blob(parts, { type: 'audio/webm' });
      const arrayBuffer = await fullBlob.arrayBuffer();
      const audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
      let audio = audioData.getChannelData(0);
      if (audio.length > MAX_SAMPLES) {
        audio = audio.slice(-MAX_SAMPLES);
      }

      const resultPromise = new Promise<string>((resolve, reject) => {
        finalizeResolverRef.current = resolve;
        finalizeRejectRef.current = reject;
      });

      const ok = generateText(audio);
      if (!ok) {
        whisperActor.send({ type: 'SET_FINALIZING', value: false });
        finalizeResolverRef.current = null;
        finalizeRejectRef.current = null;
        return (text ?? '') || null;
      }

      const finalText = await resultPromise;
      return finalText ?? ((text ?? '') || null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      onError?.(errorMessage);
      if (finalizeRejectRef.current) finalizeRejectRef.current(errorMessage);
      return (text ?? '') || null;
    } finally {
      whisperActor.send({ type: 'SET_PROCESSING', value: false });
    }
  }, [isReady, chunks, generateText, text, headerChunk, segmentStartIndex, whisperActor, onError]);

  // Finalize up to (but not including) a specific chunk index
  const finalizeUpTo = useCallback(async (endChunkIndex: number): Promise<string | null> => {
    try {
      if (!isReady) return null;
      const safeEnd = Math.max(0, Math.min(endChunkIndex, chunks.length));
      const safeStart = segmentStartIndex === 0 ? 1 : Math.max(0, Math.min(segmentStartIndex, safeEnd));
      if (safeEnd <= safeStart) return (text ?? '') || null;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
      }

      whisperActor.send({ type: 'SET_FINALIZING', value: true });
      whisperActor.send({ type: 'SET_PROCESSING', value: true });

      const parts: Blob[] = [];
      if (headerChunk) {
        parts.push(headerChunk);
        parts.push(...chunks.slice(safeStart, safeEnd));
      } else {
        parts.push(...chunks.slice(safeStart, safeEnd));
      }
      const fullBlob = new Blob(parts, { type: 'audio/webm' });
      const arrayBuffer = await fullBlob.arrayBuffer();
      const audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
      let audio = audioData.getChannelData(0);
      if (audio.length > MAX_SAMPLES) {
        audio = audio.slice(-MAX_SAMPLES);
      }

      const resultPromise = new Promise<string>((resolve, reject) => {
        finalizeResolverRef.current = resolve;
        finalizeRejectRef.current = reject;
      });

      const ok = generateText(audio);
      if (!ok) {
        whisperActor.send({ type: 'SET_FINALIZING', value: false });
        finalizeResolverRef.current = null;
        finalizeRejectRef.current = null;
        return (text ?? '') || null;
      }

      const finalText = await resultPromise;
      return finalText ?? ((text ?? '') || null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      onError?.(errorMessage);
      if (finalizeRejectRef.current) finalizeRejectRef.current(errorMessage);
      return (text ?? '') || null;
    } finally {
      whisperActor.send({ type: 'SET_PROCESSING', value: false });
    }
  }, [isReady, chunks, generateText, text, headerChunk, segmentStartIndex, whisperActor, onError]);

  const markSegmentBoundary = useCallback((endChunkIndex?: number) => {
    const nextStart = typeof endChunkIndex === 'number' ? Math.max(0, Math.min(endChunkIndex, chunks.length)) : chunks.length;
    whisperActor.send({ type: 'SET_SEGMENT_START', index: nextStart });
    whisperActor.send({ type: 'SET_LAST_DECODED_COUNT', count: nextStart });
    if (!headerChunk && chunks.length > 0) {
      whisperActor.send({ type: 'SET_HEADER_CHUNK', blob: chunks[0] });
    }
  }, [chunks, whisperActor, headerChunk]);

  const getChunkCount = useCallback(() => chunks.length, [chunks]);

  // Combine errors from both hooks
  useEffect(() => {
    if (recognitionError) {
      setError(recognitionError);
      onError?.(recognitionError);
    }
  }, [recognitionError, onError]);

  return {
    status,
    text,
    tps,
    isLoading,
    isReady,
    isProcessing: isProcessing || recognitionProcessing,
    isRecording,
    progressItems,
    loadingMessage,
    stream,
    startRecording,
    stopRecording,
    resetRecording: safeResetRecording,
    loadModel,
    error,
    finalizeCurrentRecording,
    markSegmentBoundary,
    getChunkCount,
    finalizeUpTo,
  };
}