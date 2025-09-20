import { useEffect, useMemo } from 'react';
import { useActorRef, useSelector } from '@xstate/react';
import { audioRecorderMachine } from '../machines/audioRecorder.machine';

interface UseAudioRecorderOptions {
  sampleRate?: number;
  mimeType?: string;
  onDataAvailable?: (data: Blob[]) => void;
  onError?: (error: string) => void;
  /**
   * Interval in milliseconds to request data from the recorder
   * @default 250
   */
  dataRequestInterval?: number;
}

interface UseAudioRecorderReturn {
  stream: MediaStream | null;
  chunks: Blob[];
  recording: boolean;
  isRecording: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
  requestData: () => void;
}

export function useAudioRecorder({
  sampleRate = 16_000,
  mimeType = 'audio/webm',
  onDataAvailable,
  onError,
  dataRequestInterval = 250,
}: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const actor = useActorRef(audioRecorderMachine, {
    input: { sampleRate, mimeType, dataRequestInterval },
  });
  const stream = useSelector(actor, (s) => (s.context as { stream: MediaStream | null }).stream);
  const chunks = useSelector(actor, (s) => (s.context as { chunks: Blob[] }).chunks);
  const recording = useSelector(actor, (s) => s.value === 'recording');
  const err = useSelector(actor, (s) => (s.context as { error: string | null }).error);
  // Surface errors
  useEffect(() => { if (err && onError) onError(err); }, [err, onError]);
  // Notify data available (mirror prior hook behavior) without causing re-render loops
  useEffect(() => {
    if (onDataAvailable) onDataAvailable(chunks);
  }, [chunks, onDataAvailable]);

  return {
    stream,
    chunks,
    recording,
    isRecording: recording,
    startRecording: () => actor.send({ type: 'START' } as const),
    stopRecording: () => actor.send({ type: 'STOP' } as const),
    resetRecording: () => actor.send({ type: 'RESET' } as const),
    requestData: () => actor.send({ type: 'REQUEST_DATA' } as const),
  };
}