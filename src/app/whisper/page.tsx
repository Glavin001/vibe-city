"use client";

import { useEffect, useState } from 'react';
import { Whisper } from '../../components/whisper/Whisper';

export default function WhisperDemoPage() {
  const [isWebGPUAvailable, setIsWebGPUAvailable] = useState<boolean | null>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [finalText, setFinalText] = useState('');

  useEffect(() => {
    setIsWebGPUAvailable(typeof navigator !== 'undefined' && !!navigator.gpu);
  }, []);

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

      <div className="mb-6 p-4 border border-blue-200 rounded-lg">
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

      <div className="mb-4 p-2 rounded text-sm">
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

      <Whisper
        onTextChange={setFinalText}
        // onTextUpdate={(t) => console.log("onTextUpdate", t)}
        onStatusChange={setStatus}
        onError={(e) => setError(e || null)}
        autoStart={false}
        initialLanguage="en"
        className="border rounded-lg p-4"
        debug={true}
      />

      <div className="mt-4">
        <h2 className="text-lg font-semibold mb-2">Final Transcription:</h2>
        <div className="p-4 border border-blue-200 rounded-lg min-h-[100px] whitespace-pre-wrap">
          {finalText.trim() || 'Speak to see final transcription...'}
        </div>
      </div>
    </div>
  );
}


