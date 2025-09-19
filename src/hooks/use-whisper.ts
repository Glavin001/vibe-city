import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [isProcessing, setIsProcessing] = useState(false);
  // Number of chunks that were last decoded; used to avoid redundant decodes.
  const lastDecodedChunkCountRef = useRef<number>(0);
  // WebM header chunk captured at the beginning of a recording window, needed for decoding partial segments.
  const headerChunkRef = useRef<Blob | null>(null);
  // Finalization state: when true, periodic processing pauses and we resolve when next 'complete' arrives
  const finalizingRef = useRef<boolean>(false);
  const finalizeResolverRef = useRef<((text: string) => void) | null>(null);
  const finalizeRejectRef = useRef<((reason?: unknown) => void) | null>(null);
  // Logical segment boundary inside current recording window
  const segmentStartIndexRef = useRef<number>(0);

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
          finalizingRef.current = false;
        }
      }
      if (onTextChange) {
        onTextChange(finalText);
      }
    },
    // onTextUpdate,
    onError: (err) => {
      setError(err);
      onError?.(err);
    },
  });

  // Process audio chunks when they are available
  useEffect(() => {
    // Only process if we have new chunks, are recording, not already processing, and the model is ready
    // Additionally, avoid calling generate while recognition is mid-flight (status 'start'/'update')
    if (
      finalizingRef.current ||
      chunks.length <= lastDecodedChunkCountRef.current ||
      !isRecording ||
      isProcessing ||
      !isReady ||
      (status !== 'ready' && status !== 'complete')
    ) {
      return;
    }

    const processAudio = async () => {
      try {
        setIsProcessing(true);
        // console.log('Starting audio processing...');

        // Create audio context if it doesn't exist
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
          console.log('Created new AudioContext with sample rate:', WHISPER_SAMPLING_RATE);
        }

        // Ensure we captured the header (initialization) chunk at the start of this recording window
        if (!headerChunkRef.current && chunks.length > 0) {
          headerChunkRef.current = chunks[0];
        }

        // Build a small window of recent chunks, always prepending the header chunk for decodability
        // Keep the window size modest to limit decode cost
        const MAX_RECENT_CHUNKS = 12; // slightly longer window to avoid losing early tokens in live view
        const startRecent = Math.max(segmentStartIndexRef.current + 1, chunks.length - MAX_RECENT_CHUNKS);
        const toDecode: Blob[] = [];
        if (headerChunkRef.current) toDecode.push(headerChunkRef.current);
        toDecode.push(...chunks.slice(startRecent));

        const blob = new Blob(toDecode, { type: 'audio/webm' });
        // console.log('Created blob (header + recent) size:', blob.size, 'chunksUsed:', toDecode.length);

        // Read the blob as an array buffer
        const arrayBuffer = await blob.arrayBuffer();
        // console.log('Converted blob to arrayBuffer, size:', arrayBuffer.byteLength);

        // Decode the audio data
        const audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
        // console.log('Decoded audio data, duration:', audioData.duration, 'seconds');

        // Get the audio samples
        let audio = audioData.getChannelData(0);
        // console.log('Got audio samples, length:', audio.length);

        // Trim to max length if needed (safety cap)
        if (audio.length > MAX_SAMPLES) {
          console.warn(`[useWhisper] Trimming audio from ${audio.length} to ${MAX_SAMPLES} samples`);
          audio = audio.slice(-MAX_SAMPLES);
        }

        // Generate text from the audio (only when recognition is idle/ready)
        // console.log('Sending audio to speech recognition...');
        generateText(audio);
      } catch (err) {
        console.error('Error processing audio:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        onError?.(errorMessage);
      } finally {
        // Remember how many chunks we've considered to avoid immediate re-decode of the same window
        lastDecodedChunkCountRef.current = chunks.length;
        setIsProcessing(false);
      }
    };

    processAudio();
  }, [chunks, isRecording, isProcessing, isReady, status, generateText, onError]);

  // Safe reset function that handles the autoStart flag
  const safeResetRecording = useCallback(() => {
    // Stop recording if it's active
    if (isRecording) {
      stopRecording();
    }

    // Reset the audio recorder
    audioResetRecording();
    // Reset decoding state so we start fresh on next recording window
    lastDecodedChunkCountRef.current = 0;
    headerChunkRef.current = null;
    finalizingRef.current = false;
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
  }, [isRecording, stopRecording, audioResetRecording, autoStart, isReady, startRecording]);

  // Finalize by decoding full recording window and returning final transcript
  const finalizeCurrentRecording = useCallback(async (): Promise<string | null> => {
    try {
      if (!isReady) return null;
      if (!chunks.length) return (text ?? '') || null;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
      }

      finalizingRef.current = true;
      setIsProcessing(true);

      // Build full blob for CURRENT SEGMENT ONLY: header + chunks since segmentStartIndex
      const parts: Blob[] = [];
      if (headerChunkRef.current) {
        parts.push(headerChunkRef.current);
        const start = Math.max(segmentStartIndexRef.current + 1, 1);
        parts.push(...chunks.slice(start));
      } else {
        const start = Math.max(segmentStartIndexRef.current, 0);
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
        finalizingRef.current = false;
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
      setIsProcessing(false);
    }
  }, [isReady, chunks, generateText, onError, text]);

  const markSegmentBoundary = useCallback((endChunkIndex?: number) => {
    const nextStart = typeof endChunkIndex === 'number' ? Math.max(0, Math.min(endChunkIndex, chunks.length)) : chunks.length;
    segmentStartIndexRef.current = nextStart;
    // Allow live processor to pick up from the boundary on next chunk
    lastDecodedChunkCountRef.current = nextStart;
    if (!headerChunkRef.current && chunks.length > 0) {
      headerChunkRef.current = chunks[0];
    }
  }, [chunks]);

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
  };
}