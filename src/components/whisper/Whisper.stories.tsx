import type { Meta, StoryObj } from '@storybook/react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Whisper } from './Whisper';
import { useAudioRecorder } from '../../hooks/use-audio-recorder';
import { useSpeechRecognition } from '../../hooks/use-speech-recognition';

// Define the WebGPU interfaces for TypeScript
interface GPUAdapter {
  readonly name: string;
  readonly features: Set<string>;
  readonly limits: Record<string, number>;
  requestDevice(): Promise<GPUDevice | null>;
}

interface GPUDevice {
  readonly features: Set<string>;
  readonly limits: Record<string, number>;
  readonly queue: GPUQueue;
}

// Define GPUCommandBuffer interface to fix linter error
interface GPUCommandBuffer {
  readonly label: string;
}

interface GPUQueue {
  submit(commandBuffers: Iterable<GPUCommandBuffer>): void;
}

interface GPU {
  requestAdapter: () => Promise<GPUAdapter | null>;
}

// Extend the Navigator interface to include gpu property
declare global {
  interface Navigator {
    gpu?: GPU;
  }
}

const meta = {
  title: 'Whisper/Whisper',
  component: Whisper,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Whisper>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Basic example of the Whisper component.
 */
export const Basic: Story = {
  args: {
    autoStart: false,
    initialLanguage: 'en',
  },
};

/**
 * Real-time speech recognition demo using Whisper.
 * This demo showcases the full functionality of the Whisper component,
 * including loading the model, recording audio, and displaying transcriptions.
 */
export const RealTimeDemo = () => {
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('idle');
  const [isWebGPUAvailable, setIsWebGPUAvailable] = useState<boolean | null>(null);

  // Check if WebGPU is available
  useEffect(() => {
    setIsWebGPUAvailable(!!navigator.gpu);
  }, []);

  // Handle final text changes
  const handleTextChange = (newText: string) => {
    setFinalText(newText);
    console.log('Final text:', newText);
  };

  // Handle status changes
  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus);
    console.log('Status changed:', newStatus);
  };

  // Handle errors
  const handleError = (newError: string) => {
    setError(newError);
    console.error('Error:', newError);
  };

  if (isWebGPUAvailable === false) {
    return (
      <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
        <div>
          <h1 className="text-3xl mb-4">WebGPU is not supported</h1>
          <p className="text-xl">
            This demo requires WebGPU support, which is not available in your browser.
            <br />
            Please use Chrome 113+ or Edge 113+ with WebGPU enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h1 className="text-4xl font-bold mb-1 text-center">Whisper WebGPU</h1>
      <h2 className="text-xl font-semibold mb-4 text-center">Real-time in-browser speech recognition</h2>

      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">How to use this demo:</h3>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Click the <strong>"Load Model"</strong> button to download the Whisper model (~200MB)
          </li>
          <li>Wait for the model to load and initialize (this may take a minute)</li>
          <li>
            Once ready, click <strong>"Start Recording"</strong> to begin capturing audio
          </li>
          <li>Speak clearly into your microphone</li>
          <li>Watch as your speech is transcribed in real-time below</li>
        </ol>
      </div>

      {/* Status info */}
      <div className="mb-4 p-2 bg-gray-100 rounded text-sm">
        <p>
          <strong>Status:</strong> {status}
        </p>
        <p>
          <strong>WebGPU Available:</strong> {isWebGPUAvailable ? 'Yes' : 'No'}
        </p>
        {error && (
          <p className="text-red-500">
            <strong>Error:</strong> {error}
          </p>
        )}
      </div>

      {/* Whisper component */}
      <Whisper
        onTextChange={handleTextChange}
        onStatusChange={handleStatusChange}
        onError={handleError}
        autoStart={false}
        initialLanguage="en"
        className="border rounded-lg p-4"
        debug={true}
        showTranscription={false}
      />

      {/* Final transcription display */}
      <div className="mt-4">
        <h2 className="text-lg font-semibold mb-2">Final Transcription:</h2>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg min-h-[100px] whitespace-pre-wrap">
          {finalText.trim() || 'Speak to see final transcription...'}
        </div>
      </div>

      <div className="mt-6 text-center text-sm text-gray-500">
        <p className="mb-2">
          This demo uses{' '}
          <a
            href="https://huggingface.co/onnx-community/whisper-base"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline"
          >
            whisper-base
          </a>
          , a 73 million parameter speech recognition model optimized for the web.
        </p>
        <p>
          Everything runs directly in your browser using{' '}
          <a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer" className="underline">
            🤗 Transformers.js
          </a>{' '}
          and WebGPU - no data is sent to a server.
        </p>
      </div>
    </div>
  );
};

/**
 * Audio Recorder Test Story
 * This story specifically tests the useAudioRecorder hook functionality,
 * showing how to use it independently of the Whisper component.
 */
export const AudioRecorderTest = () => {
  const [audioData, setAudioData] = useState<Blob[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Initialize the audio recorder hook
  const { stream, chunks, recording, isRecording, startRecording, stopRecording, resetRecording, requestData } =
    useAudioRecorder({
      sampleRate: 16000,
      mimeType: 'audio/webm',
      dataRequestInterval: 500,
      onDataAvailable: (data) => {
        setAudioData(data);
        console.log('Data available:', data.length, 'chunks');
      },
      onError: (error) => {
        setErrorMessage(error);
        console.error('Audio recorder error:', error);
      },
    });

  // Create audio URL when recording stops
  useEffect(() => {
    // Only create a new URL if we have chunks and we're not recording
    if (chunks.length > 0 && !recording && !audioUrl) {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    }

    // Cleanup function
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
    // We intentionally exclude audioUrl from deps to prevent infinite loop
    // while still referencing it in the condition and cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, recording, audioUrl]);

  // Display recording status
  const getStatusText = () => {
    if (errorMessage) return `Error: ${errorMessage}`;
    if (isRecording) return 'Recording in progress...';
    if (chunks.length > 0) return 'Recording complete';
    return 'Ready to record';
  };

  // Debug information items with keys
  const debugItems = [
    { key: 'recording-status', label: 'Recording', value: isRecording ? 'Yes' : 'No' },
    { key: 'chunks-count', label: 'Chunks', value: chunks.length.toString() },
    { key: 'stream-status', label: 'Stream', value: stream ? 'Available' : 'Not available' },
    {
      key: 'data-size',
      label: 'Total data size',
      value: `${chunks.reduce((acc, chunk) => acc + chunk.size, 0)} bytes`,
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h1 className="text-3xl font-bold mb-2 text-center">Audio Recorder Test</h1>
      <p className="text-center mb-6 text-gray-600">Testing the useAudioRecorder hook independently</p>

      <div className="flex flex-col gap-4 items-center">
        {/* Status display */}
        <div className="w-full p-3 bg-gray-100 rounded-lg text-center">
          <p className="font-medium">{getStatusText()}</p>
          <p className="text-sm text-gray-600">{isRecording ? `Recording time: ${chunks.length * 0.5}s` : ''}</p>
        </div>

        {/* Control buttons */}
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={startRecording}
            disabled={isRecording}
            className={`px-4 py-2 rounded-lg font-medium ${
              isRecording ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            Start Recording
          </button>

          <button
            type="button"
            onClick={stopRecording}
            disabled={!isRecording}
            className={`px-4 py-2 rounded-lg font-medium ${
              !isRecording ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            Stop Recording
          </button>

          <button
            type="button"
            onClick={resetRecording}
            disabled={!isRecording}
            className={`px-4 py-2 rounded-lg font-medium ${
              !isRecording ? 'bg-gray-300 cursor-not-allowed' : 'bg-yellow-500 hover:bg-yellow-600 text-white'
            }`}
          >
            Reset Recording
          </button>

          <button
            type="button"
            onClick={requestData}
            disabled={!isRecording}
            className={`px-4 py-2 rounded-lg font-medium ${
              !isRecording ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            Request Data
          </button>
        </div>

        {/* Audio playback */}
        {audioUrl && (
          <div className="w-full mt-4">
            <h3 className="text-lg font-medium mb-2">Recorded Audio:</h3>
            <audio controls src={audioUrl} className="w-full">
              <track kind="captions" src="" label="English captions" />
            </audio>
          </div>
        )}

        {/* Debug info */}
        <div className="w-full mt-4 p-3 bg-gray-100 rounded-lg">
          <h3 className="text-lg font-medium mb-2">Debug Information:</h3>
          <div className="text-sm font-mono">
            {debugItems.map((item) => (
              <p key={item.key}>
                {item.label}: {item.value}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Speech Recognition Hook Demo
 * This story demonstrates the useSpeechRecognition hook functionality,
 * showing how to use it independently of the Whisper component.
 */
export const SpeechRecognitionDemo = () => {
  const [isWebGPUAvailable, setIsWebGPUAvailable] = useState<boolean | null>(null);
  const [finalText, setFinalText] = useState<string>('');

  // Check if WebGPU is available
  useEffect(() => {
    setIsWebGPUAvailable(!!navigator.gpu);
  }, []);

  // Initialize the speech recognition hook
  const {
    status,
    text,
    tps,
    isLoading,
    isReady,
    isProcessing,
    progressItems,
    loadingMessage,
    loadModel,
    generateText,
    error,
  } = useSpeechRecognition({
    language: 'en',
    onStatusChange: (newStatus) => console.log('Status changed:', newStatus),
    onTextChange: (newText) => {
      console.log('Final text:', newText);
      setFinalText(newText);
    },
    onTpsChange: (newTps) => console.log('TPS updated:', newTps),
    onError: (err) => console.error('Error:', err),
  });

  // Function to handle file upload for audio processing
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('handleFileUpload', event);
    if (!event.target.files || event.target.files.length === 0) {
      console.error('No file selected');
      return;
    }

    const file = event.target.files[0];
    const arrayBuffer = await file.arrayBuffer();

    // Create audio context
    const audioContext = new AudioContext({ sampleRate: 16000 });

    try {
      // Decode audio data
      const audioData = await audioContext.decodeAudioData(arrayBuffer);
      const audioSamples = audioData.getChannelData(0);

      // Process audio with speech recognition
      if (isReady) {
        console.log('Processing audio file...');
        generateText(audioSamples);
      } else {
        console.warn('Model not ready. Please load the model first.');
      }
    } catch (err) {
      console.error('Error processing audio file:', err);
    }
  };

  if (isWebGPUAvailable === false) {
    return (
      <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
        <div>
          <h1 className="text-3xl mb-4">WebGPU is not supported</h1>
          <p className="text-xl">
            This demo requires WebGPU support, which is not available in your browser.
            <br />
            Please use Chrome 113+ or Edge 113+ with WebGPU enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto p-4">
      <h1 className="text-3xl font-bold mb-2 text-center">Speech Recognition Demo</h1>
      <p className="text-center mb-6 text-gray-600">Testing the useSpeechRecognition hook</p>

      {/* Status display */}
      <div className="w-full p-3 bg-gray-100 rounded-lg text-center mb-4">
        <p className="font-medium">Status: {status}</p>
        {error && <p className="text-red-500">Error: {error}</p>}
        {isLoading && <p>Loading: {loadingMessage}</p>}
        {tps !== null && <p>Processing speed: {tps.toFixed(2)} tokens/sec</p>}
      </div>

      {/* Controls */}
      <div className="flex gap-3 justify-center mb-6">
        <button
          type="button"
          onClick={loadModel}
          disabled={isLoading || isReady}
          className={`px-4 py-2 rounded-lg font-medium ${
            isLoading || isReady ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          Load Model
        </button>

        <label
          className={`px-4 py-2 rounded-lg font-medium ${
            !isReady ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-500 hover:bg-green-600 text-white cursor-pointer'
          }`}
        >
          <input type="file" accept="audio/*" onChange={handleFileUpload} disabled={!isReady} className="hidden" />
          Upload Audio File
        </label>
      </div>

      {/* Progress display */}
      {progressItems.length > 0 && (
        <div className="w-full mb-4">
          <h3 className="text-lg font-medium mb-2">Loading Progress:</h3>
          {progressItems.map((item, index) => (
            <div key={`${item.file}-${index}`} className="mb-2">
              <p className="text-sm">{item.file}</p>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="bg-blue-600 h-2.5 rounded-full"
                  style={{ width: `${(item.progress / item.total) * 100}%` }}
                />
              </div>
              <p className="text-xs text-right">{Math.round((item.progress / item.total) * 100)}%</p>
            </div>
          ))}
        </div>
      )}

      {/* Live transcription display */}
      <div className="mt-4">
        <h2 className="text-lg font-semibold mb-2">Live Transcription:</h2>
        <div className="p-4 bg-gray-50 border rounded-lg min-h-[100px] whitespace-pre-wrap">
          {text || 'Upload an audio file to see transcription...'}
        </div>
      </div>

      {/* Final transcription display */}
      <div className="mt-4">
        <h2 className="text-lg font-semibold mb-2">Final Transcription:</h2>
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg min-h-[100px] whitespace-pre-wrap">
          {finalText || 'Upload an audio file to see final transcription...'}
        </div>
      </div>

      <div className="mt-6 text-center text-sm text-gray-500">
        <p>
          This demo uses the useSpeechRecognition hook to transcribe audio files using the Whisper model.
          <br />
          All processing happens directly in your browser - no data is sent to a server.
        </p>
      </div>
    </div>
  );
};