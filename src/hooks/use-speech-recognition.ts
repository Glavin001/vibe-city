import { useState } from 'react';
import { useActorRef, useSelector } from '@xstate/react';
import { speechRecognitionMachine, useSpeechRecognitionStatus, type SpeechRecognitionStatus } from '../machines/speechRecognition.machine';
import { inspect } from '@/machines/inspector';

// All model loading and inference are performed inside a Web Worker.

export interface SpeechRecognitionOptions {
  /**
   * The language to use for speech recognition
   * @default 'en'
   */
  language?: string;
  /**
   * Callback for when the status changes
   */
  onStatusChange?: (status: SpeechRecognitionStatus) => void;
  /**
   * Callback for when the final complete text is available
   * This is called only once at the end of recognition with the final result
   */
  onTextChange?: (text: string) => void;
  /**
   * Callback for incremental text updates during recognition
   * This is called multiple times during recognition as tokens are generated
   */
  onTextUpdate?: (text: string) => void;
  /**
   * Callback for when the tokens per second changes
   */
  onTpsChange?: (tps: number) => void;
  /**
   * Callback for when an error occurs
   */
  onError?: (error: string) => void;
}

export type { SpeechRecognitionStatus };

export interface SpeechRecognitionResult {
  /**
   * The current status of the speech recognition
   */
  status: SpeechRecognitionStatus;
  /**
   * The recognized text (contains either incremental updates or final text depending on status)
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
   * Load the model
   */
  loadModel: () => void;
  /**
   * Generate text from audio
   * 
   * @returns true if the audio was processed successfully, false otherwise
   */
  generateText: (audio: Float32Array) => boolean;
  /**
   * Any error that occurred
   */
  error: string | null;
}

/**
 * Hook for speech recognition using Transformers.js
 */
export function useSpeechRecognition({
  language = 'en',
  onStatusChange,
  onTextChange,
  onTextUpdate,
  onTpsChange,
  onError,
}: SpeechRecognitionOptions = {}): SpeechRecognitionResult {
  const actor = useActorRef(speechRecognitionMachine, {
    input: { language, onStatusChange, onTextChange, onTextUpdate, onTpsChange, onError },
    inspect: inspect,
  });
  const status = useSpeechRecognitionStatus(actor);
  const text = useSelector(actor, (s) => s.context.text as string);
  const tps = useSelector(actor, (s) => s.context.tps as number | null);
  const progressItems = useSelector(actor, (s) => s.context.progressItems as SpeechRecognitionResult['progressItems']);
  const loadingMessage = useSelector(actor, (s) => s.context.loadingMessage as string);
  const error = useSelector(actor, (s) => s.context.error as string | null);

  // Load and generate wrappers
  const loadModel = () => {
    console.log("[useSpeechRecognition] loadModel", status);
    actor.send({ type: 'LOAD' } as const);
  };
  const generateText = (audio: Float32Array): boolean => {
    console.log("[useSpeechRecognition] generateText", status);
    if (!(status === 'ready' || status === 'complete')) {
      console.warn("[useSpeechRecognition] generateText not ready", status);
      return false;
    }

    const canGenerate = actor.getSnapshot().can({ type: 'GENERATE', audio, language });
    if (!canGenerate) {
      console.warn("[useSpeechRecognition] GENERATE transition not enabled in current state", actor.getSnapshot().value);
      return false;
    }

    actor.send({ type: 'GENERATE', audio, language } as const);
    return true;
  };

  // No useEffects for callbacks; machine notifies via input actions

  return {
    status,
    text,
    tps,
    isLoading: status === 'loading',
    isReady: !['idle', 'loading', 'error'].includes(status),
    isProcessing: ['start', 'update'].includes(status),
    progressItems,
    loadingMessage,
    loadModel,
    generateText,
    error,
  };
}