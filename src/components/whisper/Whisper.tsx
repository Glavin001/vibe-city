import React, { useEffect, useState } from 'react';
import { useWhisper } from '../../hooks/use-whisper';
import { AudioVisualizer } from '../AudioVisualizer';
import { Progress } from './Progress';
import { LanguageSelector } from './LanguageSelector';

export interface WhisperProps {
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
   * The initial language to use for speech recognition
   * @default 'en'
   */
  initialLanguage?: string;
  /**
   * Whether to automatically start recording when the model is ready
   * @default false
   */
  autoStart?: boolean;
  /**
   * Callback for when the status changes
   */
  onStatusChange?: (status: string) => void;
  /**
   * Callback for when an error occurs
   */
  onError?: (error: string) => void;
  /**
   * Whether to show the language selector
   * @default true
   */
  showLanguageSelector?: boolean;
  /**
   * Whether to show the reset button
   * @default true
   */
  showResetButton?: boolean;
  /**
   * Whether to show the load model button
   * @default true
   */
  showLoadModelButton?: boolean;
  /**
   * Whether to show the audio visualizer
   * @default true
   */
  showAudioVisualizer?: boolean;
  /**
   * Whether to show the progress indicators
   * @default true
   */
  showProgress?: boolean;
  /**
   * Whether to show the transcription text
   * @default true
   */
  showTranscription?: boolean;
  /**
   * Whether to show the tokens per second
   * @default true
   */
  showTps?: boolean;
  /**
   * Whether to show debug information
   * @default false
   */
  debug?: boolean;
  /**
   * Additional class name for the container
   */
  className?: string;
}

/**
 * A component for real-time speech recognition using Whisper
 */
export function Whisper({
  onTextChange,
  // onTextUpdate,
  initialLanguage = 'en',
  autoStart = false,
  onStatusChange,
  onError,
  showLanguageSelector = true,
  showResetButton = true,
  showLoadModelButton = true,
  showAudioVisualizer = true,
  showProgress = true,
  showTranscription = true,
  showTps = true,
  debug = false,
  className = '',
}: WhisperProps) {
  const [language, setLanguage] = useState(initialLanguage);
  const [isWebGPUAvailable, setIsWebGPUAvailable] = useState<boolean | null>(null);

  // Check if WebGPU is available
  useEffect(() => {
    setIsWebGPUAvailable(!!navigator.gpu);
  }, []);

  const {
    status,
    text,
    tps,
    isLoading,
    isReady,
    isProcessing,
    isRecording,
    progressItems,
    loadingMessage,
    stream,
    startRecording,
    stopRecording,
    resetRecording,
    loadModel,
    error,
  } = useWhisper({
    language,
    autoStart,
    onTextChange,
    // onTextUpdate,
    onStatusChange,
    onError,
  });

  // Handle language change
  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage);
    // Reset recording to apply the new language
    resetRecording();
  };

  // Handle errors
  useEffect(() => {
    if (error) {
      console.error('Whisper error:', error);
      onError?.(error);
    }
  }, [error, onError]);

  // If WebGPU is not available, show an error message
  if (isWebGPUAvailable === false) {
    return (
      <div className={`flex flex-col items-center p-4 ${className}`}>
        <div className="w-full max-w-md bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <strong className="font-bold">WebGPU Not Available</strong>
          <p className="mt-2">
            This component requires WebGPU support, which is not available in your browser. Please use a browser that
            supports WebGPU, such as Chrome 113+ or Edge 113+.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center p-4 ${className}`}>
      {/* Status display for debugging */}
      {debug && (
        <div className="w-full max-w-md mb-4 p-2 rounded text-xs">
          <h3 className="font-bold mb-1">Debug Info:</h3>
          <p>Status: {status}</p>
          <p>Recording: {isRecording ? 'yes' : 'no'}</p>
          <p>Processing: {isProcessing ? 'yes' : 'no'}</p>
          <p>WebGPU Available: {isWebGPUAvailable ? 'yes' : 'no'}</p>
          <p>Language: {language}</p>
          <p>Auto Start: {autoStart ? 'yes' : 'no'}</p>
          <p>Ready: {isReady ? 'yes' : 'no'}</p>
          <p>Loading: {isLoading ? 'yes' : 'no'}</p>
          <p>Stream Available: {stream ? 'yes' : 'no'}</p>
          <p>TPS: {tps !== null ? tps.toFixed(2) : 'n/a'}</p>
        </div>
      )}

      {/* Simple status display with stable layout to avoid flicker */}
      {!debug && (
        <div className="text-xs mb-2 min-h-[1.25rem] text-gray-500">
          Status: {status} | Recording: {isRecording ? 'yes' : 'no'} | Processing: {isProcessing ? 'yes' : 'no'}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="w-full max-w-md bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4 relative">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
          <button type="button" className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => onError?.('')}>
            <span className="sr-only">Dismiss</span>
            <svg
              className="h-6 w-6 text-red-500"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Initial load button */}
      {status === 'idle' && showLoadModelButton && (
        <div className="flex flex-col items-center mb-4">
          <p className="mb-4 text-center max-w-md">
            Click the button below to load the Whisper speech recognition model. This will download the model
            (approximately 200MB) and prepare it for use.
          </p>
          <button
            type="button"
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            onClick={loadModel}
          >
            Load Model
          </button>
        </div>
      )}

      {/* Loading progress (reserve space to reduce layout shift) */}
      {showProgress && (
        <div className="w-full max-w-md mb-4">
          {isLoading ? (
            <>
              <p className="text-center mb-2">{loadingMessage}</p>
              {progressItems.map((item, index) => (
                <Progress key={`${item.file}-${index}`} text={item.file} percentage={item.progress} total={item.total} />
              ))}
            </>
          ) : (
            <div className="h-0" />
          )}
        </div>
      )}

      {/* Audio visualizer */}
      {showAudioVisualizer && stream && (
        <div className="w-full max-w-md mb-4">
          <AudioVisualizer stream={stream} className="w-full h-32 border rounded" />
        </div>
      )}

      {/* Transcription display (keep mounted to prevent flicker) */}
      {showTranscription && (
        <div className="w-full max-w-md mb-4 relative">
          <div className="w-full min-h-[80px] max-h-[200px] overflow-y-auto border rounded p-2">
            {isReady
              ? text
                ? text
                : isRecording || isProcessing
                ? 'Listening...'
                : 'Speak to see transcription...'
              : ''}
          </div>
          {showTps && tps !== null && (
            <div className="absolute bottom-2 right-2 text-xs text-gray-500">{tps.toFixed(2)} tok/s</div>
          )}
        </div>
      )}

      {/* Controls */}

      <div className="flex flex-wrap justify-center gap-2 w-full max-w-md">
        {/* Recording controls */}
        <div className="flex gap-2">
          <button
            type="button"
            className={`py-2 px-4 rounded font-bold ${
              !isReady
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : isRecording
                ? 'bg-red-500 hover:bg-red-700 text-white'
                : 'bg-green-500 hover:bg-green-700 text-white'
            }`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={!isReady}
          >
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>

          {showResetButton && (
            <button
              type="button"
              className={`py-2 px-4 rounded font-bold ${
                !isReady || !isRecording
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-300 hover:bg-gray-400 text-gray-800'
              }`}
              onClick={resetRecording}
              disabled={!isReady || !isRecording}
            >
              Reset
            </button>
          )}
        </div>

        {/* Language selector */}
        {showLanguageSelector && (
          <div className="flex items-center">
            <LanguageSelector
              language={language}
              setLanguage={handleLanguageChange}
              disabled={!isReady || isRecording}
            />
          </div>
        )}
      </div>
    </div>
  );
}