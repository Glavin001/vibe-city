import { useCallback, useEffect, useRef, useState } from 'react';

// All model loading and inference are performed inside a Web Worker.

// import SpeechRecognitionWorker from '../workers/speech-recognition.worker?worker';

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

export type SpeechRecognitionStatus = 'idle' | 'loading' | 'ready' | 'start' | 'update' | 'complete' | 'error';

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
   */
  generateText: (audio: Float32Array) => void;
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
  const [status, setStatus] = useState<SpeechRecognitionStatus>('idle');
  const [text, setText] = useState('');
  const [tps, setTps] = useState<number | null>(null);
  const [progressItems, setProgressItems] = useState<
    Array<{
      file: string;
      progress: number;
      total: number;
    }>
  >([]);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [, setWorkerInitialized] = useState(false);

  // Model work is handled inside a Web Worker
  const workerRef = useRef<Worker | null>(null);
  const statusCallbackCalledRef = useRef<Record<string, boolean>>({});
  const isGeneratingRef = useRef(false);
  // Store the current callbacks in refs to avoid recreating the worker message handler
  const onErrorRef = useRef(onError);
  const onStatusChangeRef = useRef(onStatusChange);
  const onTextChangeRef = useRef(onTextChange);
  const onTextUpdateRef = useRef(onTextUpdate);
  const onTpsChangeRef = useRef(onTpsChange);

  // Update the refs when callbacks change
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onTextChangeRef.current = onTextChange;
  }, [onTextChange]);

  useEffect(() => {
    onTextUpdateRef.current = onTextUpdate;
  }, [onTextUpdate]);

  useEffect(() => {
    onTpsChangeRef.current = onTpsChange;
  }, [onTpsChange]);

  // Handle worker messages
  const handleWorkerMessage = useCallback(
    (e: MessageEvent) => {
      console.log('Received message from worker:', e.data);

      const { status: messageStatus, error: messageError } = e.data;

      if (messageError) {
        console.error('Error from worker:', messageError);
        setError(messageError);
        if (onErrorRef.current) onErrorRef.current(messageError);
        setStatus('error');
        return;
      }

      switch (messageStatus) {
        case 'loading': {
          setStatus('loading');
          if (onStatusChangeRef.current) {
            setTimeout(() => {
              (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('loading');
            }, 0);
          }
          break;
        }
        case 'ready': {
          setStatus('ready');
          if (onStatusChangeRef.current) {
            setTimeout(() => {
              (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('ready');
            }, 0);
          }
          break;
        }
        case 'initiate':
          console.log('Initiating file download:', e.data.file);
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case 'progress':
          console.log(`Progress for ${e.data.file}: ${e.data.progress}/${e.data.total}`);
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            }),
          );
          break;

        case 'done':
          console.log(`File download complete: ${e.data.file}`);
          setProgressItems((prev) => prev.filter((item) => item.file !== e.data.file));
          break;

        case 'start':
          console.log('Starting speech recognition');
          // Reset the status callback tracking for the new status
          statusCallbackCalledRef.current = {};
          isGeneratingRef.current = true;
          setStatus('start');

          // Call status change callback if provided
          if (onStatusChangeRef.current) {
            setTimeout(() => {
              // Type assertion to handle the possibly undefined callback
              (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('start');
            }, 0);
          }
          break;

        case 'update':
          setStatus('update');

          // Call status change callback if provided
          if (onStatusChangeRef.current) {
            setTimeout(() => {
              // Type assertion to handle the possibly undefined callback
              (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('update');
            }, 0);
          }

          // For updates, we show the incremental tokens as they come in
          if (e.data.output) {
            console.log(`Token updated: "${e.data.output}"`);
            setText(e.data.output);

            // Call only the text update callback for incremental updates
            if (onTextUpdateRef.current) onTextUpdateRef.current(e.data.output);
          }

          if (e.data.tps !== undefined) {
            console.log(`TPS updated: ${e.data.tps}`);
            setTps(e.data.tps);
            if (onTpsChangeRef.current) onTpsChangeRef.current(e.data.tps);
          }
          break;

        case 'complete':
          console.log('Speech recognition complete');
          // Reset the status callback tracking for the new status
          statusCallbackCalledRef.current = {};
          isGeneratingRef.current = false;
          setStatus('complete');

          // Call status change callback if provided
          if (onStatusChangeRef.current) {
            setTimeout(() => {
              // Type assertion to handle the possibly undefined callback
              (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('complete');
            }, 0);
          }

          // For complete, we use the final output from the worker
          if (e.data.output) {
            console.log(`Final text: "${e.data.output}"`);
            setText(e.data.output);

            // Call only the text change callback for the final complete text
            if (onTextChangeRef.current) onTextChangeRef.current(e.data.output);
          }
          break;

        default:
          console.log('Unknown message status:', messageStatus);
          break;
      }
    },
    [], // No dependencies to avoid re-creating this function
  );

  // Create the worker only once when the hook is initialized
  const createWorker = useCallback(() => {
    if (typeof window === 'undefined') return false;
    if (workerRef.current) return true;
    try {
      /*
      const worker = new Worker(new URL('../workers/speech-recognition.worker.ts', import.meta.url), {
        type: 'module',
      });
      */
      // const worker = new SpeechRecognitionWorker();
      const worker: any = null;
      // Attach message handler immediately so events from worker are not missed
      worker.addEventListener('message', handleWorkerMessage as (e: MessageEvent) => void);
      workerRef.current = worker;
      setWorkerInitialized(true);
      console.log('Speech recognition worker created successfully');
      return true;
    } catch (err) {
      console.error('Error creating worker:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      if (onErrorRef.current) onErrorRef.current(errorMessage);
      setStatus('error');
      if (onStatusChangeRef.current) {
        setTimeout(() => {
          (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('error');
        }, 0);
      }
      return false;
    }
  }, [handleWorkerMessage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    console.log('Initializing speech recognition worker...');
    createWorker();
    return () => {
      if (workerRef.current) {
        console.log('Terminating speech recognition worker...');
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [createWorker]);


  // Message handler attached during worker creation

  // Progress is emitted directly from the worker

  // Load the model
  const loadModel = useCallback(async () => {
    if (!workerRef.current) {
      const ok = createWorker();
      if (!ok || !workerRef.current) {
        console.error('Whisper worker not initialized');
        const errorMessage = 'Whisper worker not initialized';
        setError(errorMessage);
        if (onErrorRef.current) onErrorRef.current(errorMessage);
        return;
      }
    }

    console.log('Request worker to load model...');

    // Reset state
    setText('');
    setTps(null);
    setProgressItems([]);
    setLoadingMessage('Loading model...');
    setError(null);
    statusCallbackCalledRef.current = {};
    isGeneratingRef.current = false;

    // Update status
    setStatus('loading');
    if (onStatusChangeRef.current) {
      setTimeout(() => {
        // Type assertion to handle the possibly undefined callback
        (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('loading');
      }, 0);
    }

    // Ask worker to load model; it will emit loading/progress/ready events
    workerRef.current.postMessage({ type: 'load' });
  }, [createWorker]);

  // Generate text from audio
  const generateText = useCallback(
    (audio: Float32Array) => {
      if (!workerRef.current) {
        const ok = createWorker();
        if (!ok || !workerRef.current) {
          console.error('Whisper worker not initialized');
          const errorMessage = 'Whisper worker not initialized';
          setError(errorMessage);
          if (onErrorRef.current) onErrorRef.current(errorMessage);
          return;
        }
      }

      if (status !== 'ready' && status !== 'complete') {
        console.warn('Model not ready, current status:', status);
        return;
      }

      if (isGeneratingRef.current) {
        console.warn('Already generating text, ignoring new request');
        return;
      }

      // Main thread no longer requires tokenizer/processor/model; all handled in worker

      console.log(`Generating text from audio (${audio.length} samples), language: ${language}`);

      try {
        // Send data to worker for processing, remove non-transferable model objects
        workerRef.current.postMessage({
          type: 'generate',
          data: { audio, language },
        });
      } catch (err) {
        console.error('Error generating text:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(errorMessage);
        if (onErrorRef.current) onErrorRef.current(errorMessage);
        setStatus('error');
        if (onStatusChangeRef.current) {
          setTimeout(() => {
            // Type assertion to handle the possibly undefined callback
            (onStatusChangeRef.current as (status: SpeechRecognitionStatus) => void)('error');
          }, 0);
        }
      }
    },
    [status, language, createWorker], // Depend on status, language, and worker creation
  );

  return {
    status,
    text,
    tps,
    isLoading: status === 'loading',
    // isReady: ['ready', 'start', 'update', 'complete'].includes(status),
    isReady: !['idle', 'loading', 'error'].includes(status),
    isProcessing: ['start', 'update'].includes(status),
    progressItems,
    loadingMessage,
    loadModel,
    generateText,
    error,
  };
}