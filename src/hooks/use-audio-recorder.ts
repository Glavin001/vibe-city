import { useState, useRef, useEffect, useCallback } from 'react';

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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const dataIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (recorderRef.current) return; // Already set up

    console.log('Setting up audio recorder...');

    if (navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((mediaStream) => {
          console.log('Got media stream from microphone');
          setStream(mediaStream);

          try {
            console.log(`Creating MediaRecorder with mimeType: ${mimeType}`);
            recorderRef.current = new MediaRecorder(mediaStream, { mimeType });

            console.log(`Creating AudioContext with sampleRate: ${sampleRate}`);
            audioContextRef.current = new AudioContext({ sampleRate });

            recorderRef.current.onstart = () => {
              console.log('MediaRecorder started');
              setRecording(true);
              setChunks([]);
            };

            recorderRef.current.ondataavailable = (e) => {
              if (e.data.size > 0) {
                console.log(`Data available: ${e.data.size} bytes`);
                setChunks((prev) => {
                  const newChunks = [...prev, e.data];
                  if (onDataAvailable) {
                    onDataAvailable(newChunks);
                  }
                  return newChunks;
                });
              } else {
                console.log('Data available but empty');
              }
            };

            recorderRef.current.onstop = () => {
              console.log('MediaRecorder stopped');
              setRecording(false);
              // Clear the data request interval when stopping
              if (dataIntervalRef.current) {
                console.log('Clearing data request interval');
                window.clearInterval(dataIntervalRef.current);
                dataIntervalRef.current = null;
              }
            };

            recorderRef.current.onerror = (event) => {
              const error = event.error?.message || 'Unknown recording error';
              console.error('MediaRecorder error:', error);
              if (onError) {
                onError(error);
              }
            };

            console.log('MediaRecorder setup complete');
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error('Error setting up MediaRecorder:', errorMessage);
            if (onError) {
              onError(errorMessage);
            }
          }
        })
        .catch((err) => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error('Error accessing microphone:', errorMessage);
          if (onError) {
            onError(errorMessage);
          }
        });
    } else {
      const errorMessage = 'getUserMedia not supported in this browser!';
      console.error(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    }

    return () => {
      if (recorderRef.current && recording) {
        console.log('Stopping MediaRecorder on cleanup');
        recorderRef.current.stop();
      }
      if (stream) {
        console.log('Stopping media stream tracks on cleanup');
        stream.getTracks().forEach((track) => track.stop());
      }
      if (dataIntervalRef.current) {
        console.log('Clearing data request interval on cleanup');
        window.clearInterval(dataIntervalRef.current);
        dataIntervalRef.current = null;
      }
    };
  }, [sampleRate, mimeType, onDataAvailable, onError, recording, stream]);

  const requestData = useCallback(() => {
    if (!recorderRef.current) {
      console.warn('MediaRecorder not available');
      return;
    }
    if (recorderRef.current.state !== 'recording') {
      console.warn('MediaRecorder is not recording, skipping requestData');
      return;
    }
    recorderRef.current.requestData();
  }, []);

  const startRecording = useCallback(() => {
    if (recorderRef.current && !recording) {
      if (recorderRef.current.state !== 'recording') {
        try {
          console.log('Starting MediaRecorder');
          recorderRef.current.start();
          setChunks([]);

          // Set up an interval to request data regularly
          if (dataIntervalRef.current) {
            console.log('Clearing existing data request interval');
            window.clearInterval(dataIntervalRef.current);
          }

          console.log(`Setting up data request interval: ${dataRequestInterval}ms`);
          dataIntervalRef.current = window.setInterval(() => {
            requestData();
          }, dataRequestInterval);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error starting recording:', errorMessage);
          if (onError) {
            onError(errorMessage);
          }
        }
      } else {
        console.log('MediaRecorder is already recording');
      }
    } else {
      console.log('Cannot start recording: MediaRecorder not available or already recording');
    }
  }, [recording, onError, requestData, dataRequestInterval]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recording) {
      if (recorderRef.current.state === 'recording') {
        try {
          // Clear the data request interval
          if (dataIntervalRef.current) {
            console.log('Clearing data request interval');
            window.clearInterval(dataIntervalRef.current);
            dataIntervalRef.current = null;
          }

          console.log('Stopping MediaRecorder');
          recorderRef.current.stop();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error stopping recording:', errorMessage);
          if (onError) {
            onError(errorMessage);
          }
        }
      } else {
        console.log('MediaRecorder is not recording');
        setRecording(false);
      }
    } else {
      console.log('Cannot stop recording: MediaRecorder not available or not recording');
    }
  }, [recording, onError]);

  const resetRecording = useCallback(() => {
    console.log('Resetting recording');

    if (recorderRef.current && recorderRef.current.state === 'recording') {
      try {
        // Clear the data request interval
        if (dataIntervalRef.current) {
          console.log('Clearing data request interval');
          window.clearInterval(dataIntervalRef.current);
          dataIntervalRef.current = null;
        }

        console.log('Stopping MediaRecorder for reset');
        recorderRef.current.stop();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error stopping recording during reset:', errorMessage);
        if (onError) {
          onError(errorMessage);
        }
      }
    }

    setChunks([]);
    console.log('Chunks reset');

    setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state !== 'recording') {
        try {
          console.log('Starting MediaRecorder after reset');
          recorderRef.current.start();

          // Set up a new interval to request data regularly
          console.log(`Setting up data request interval after reset: ${dataRequestInterval}ms`);
          dataIntervalRef.current = window.setInterval(() => {
            requestData();
          }, dataRequestInterval);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error('Error starting recording after reset:', errorMessage);
          if (onError) {
            onError(errorMessage);
          }
        }
      } else {
        console.log('Cannot start recording after reset: MediaRecorder not available or already recording');
      }
    }, 100);
  }, [onError, requestData, dataRequestInterval]);

  return {
    stream,
    chunks,
    recording,
    isRecording: recording,
    startRecording,
    stopRecording,
    resetRecording,
    requestData,
  };
}