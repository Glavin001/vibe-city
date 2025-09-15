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
    onTextChange,
    // onTextUpdate,
    onError: (err) => {
      setError(err);
      onError?.(err);
    },
  });

  // Process audio chunks when they are available
  useEffect(() => {
    // Only process if we have chunks, are recording, not already processing, and the model is ready
    // Additionally, avoid calling generate while recognition is mid-flight (status 'start'/'update')
    if (
      !chunks.length ||
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
        console.log('Starting audio processing...');

        // Create audio context if it doesn't exist
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
          console.log('Created new AudioContext with sample rate:', WHISPER_SAMPLING_RATE);
        }

        // Create a blob from the chunks
        const blob = new Blob(chunks, { type: 'audio/webm' });
        console.log('Created blob from chunks, size:', blob.size);

        // Read the blob as an array buffer
        const arrayBuffer = await blob.arrayBuffer();
        console.log('Converted blob to arrayBuffer, size:', arrayBuffer.byteLength);

        // Decode the audio data
        const audioData = await audioContextRef.current.decodeAudioData(arrayBuffer);
        console.log('Decoded audio data, duration:', audioData.duration, 'seconds');

        // Get the audio samples
        let audio = audioData.getChannelData(0);
        console.log('Got audio samples, length:', audio.length);

        // Trim to max length if needed
        if (audio.length > MAX_SAMPLES) {
          console.log(`Trimming audio from ${audio.length} to ${MAX_SAMPLES} samples`);
          audio = audio.slice(-MAX_SAMPLES);
        }

        // Generate text from the audio (only when recognition is idle/ready)
        console.log('Sending audio to speech recognition...');
        generateText(audio);
      } catch (err) {
        console.error('Error processing audio:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        onError?.(errorMessage);
      } finally {
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
  };
}