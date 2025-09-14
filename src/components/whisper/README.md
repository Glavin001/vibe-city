# Whisper Speech Recognition Components

This directory contains reusable components and hooks for implementing real-time speech recognition using the Whisper model from Hugging Face Transformers.js.

## Components

### Whisper

The main component that provides a complete speech recognition interface.

```tsx
import { Whisper } from './Whisper';

function MyComponent() {
  const handleTextChange = (text) => {
    console.log('Transcription:', text);
  };

  return <Whisper onTextChange={handleTextChange} initialLanguage="en" autoStart={false} />;
}
```

#### Props

- `onTextChange`: Callback function that receives the transcribed text
- `initialLanguage`: Initial language code (default: 'en')
- `autoStart`: Whether to start recording automatically when the model is ready (default: false)
- `className`: Additional CSS classes to apply to the component

### AudioVisualizer

A component that visualizes audio input as a waveform.

```tsx
import { AudioVisualizer } from './AudioVisualizer';

function MyComponent({ stream }) {
  return <AudioVisualizer stream={stream} className="w-full rounded-lg" />;
}
```

#### Props

- `stream`: MediaStream object from getUserMedia
- Plus any standard HTML canvas attributes

### LanguageSelector

A dropdown component for selecting the language for speech recognition.

```tsx
import { LanguageSelector } from './LanguageSelector';

function MyComponent() {
  const [language, setLanguage] = useState('en');

  return <LanguageSelector language={language} setLanguage={setLanguage} />;
}
```

#### Props

- `language`: Current language code
- `setLanguage`: Function to update the language

### Progress

A component for displaying progress bars.

```tsx
import { Progress } from './Progress';

function MyComponent() {
  return <Progress text="Loading model..." percentage={75} total={200000000} />;
}
```

#### Props

- `text`: Text to display in the progress bar
- `percentage`: Percentage of completion (0-100)
- `total`: Total size in bytes (optional)

## Hooks

### useWhisper

The main hook that combines audio recording and speech recognition.

```tsx
import { useWhisper } from '../../hooks/use-whisper';

function MyComponent() {
  const {
    stream,
    status,
    text,
    tps,
    progressItems,
    loadingMessage,
    isRecording,
    isLoading,
    isReady,
    isProcessing,
    startRecording,
    stopRecording,
    resetRecording,
    loadModel,
  } = useWhisper({
    language: 'en',
    autoStart: false,
    dataRequestInterval: 250,
    onTextChange: (text) => console.log('Final text:', text),
    onTextUpdate: (text) => console.log('Text update:', text),
    onStatusChange: (status) => console.log('Status changed:', status),
    onError: (error) => console.error('Error:', error),
  });

  return (
    <div>
      <button onClick={loadModel}>Load Model</button>
      <button onClick={startRecording} disabled={!isReady || isRecording}>
        Start Recording
      </button>
      <button onClick={stopRecording} disabled={!isRecording}>
        Stop Recording
      </button>
      <p>Status: {status}</p>
      <p>Transcription: {text}</p>
    </div>
  );
}
```

### useAudioRecorder

A hook for recording audio from the microphone.

```tsx
import { useAudioRecorder } from '../../hooks/use-audio-recorder';

function MyComponent() {
  const { stream, chunks, recording, isRecording, startRecording, stopRecording, resetRecording, requestData } =
    useAudioRecorder({
      sampleRate: 16000,
      mimeType: 'audio/webm',
      dataRequestInterval: 250,
      onDataAvailable: (data) => {
        console.log('Audio data:', data);
      },
      onError: (error) => {
        console.error('Recording error:', error);
      },
    });

  return (
    <div>
      <button onClick={startRecording} disabled={recording}>
        Start Recording
      </button>
      <button onClick={stopRecording} disabled={!recording}>
        Stop Recording
      </button>
    </div>
  );
}
```

### useSpeechRecognition

A hook for speech recognition using the Whisper model.

```tsx
import { useSpeechRecognition } from '../../hooks/use-speech-recognition';

function MyComponent() {
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
    onStatusChange: (status) => {
      console.log('Status changed:', status);
    },
    onTextChange: (text) => {
      console.log('Final text:', text);
    },
    onTextUpdate: (text) => {
      console.log('Text updated:', text);
    },
    onTpsChange: (tps) => {
      console.log('Tokens per second:', tps);
    },
    onError: (error) => {
      console.error('Error:', error);
    },
  });

  return (
    <div>
      <button onClick={loadModel}>Load Model</button>
      <p>Status: {status}</p>
      <p>Transcription: {text}</p>
    </div>
  );
}
```

## Implementation Notes

1. Web Worker is required and created by the hooks using the ESM pattern `new URL('...', import.meta.url)`. Ensure your bundler supports ESM Web Workers.
2. Whisper inference runs on WebGPU in the browser. Use Chrome/Edge 113+ with WebGPU enabled.
3. Install `@huggingface/transformers` to use the model: `npm i @huggingface/transformers`.
4. The worker lives at `src/workers/speech-recognition.worker.ts` and is automatically bundled when imported via the hooks.

### Storybook (Vite) configuration

If you run these stories in Storybook with the Vite builder, set worker format to ESM, exclude transformers from optimizeDeps, and target modern output:

```ts
import type { StorybookConfig } from '@storybook/nextjs-vite';
import type { InlineConfig } from 'vite';

const config: StorybookConfig = {
  // ...
  async viteFinal(config) {
    const viteConfig = config as unknown as InlineConfig;
    viteConfig.worker = viteConfig.worker ?? {};
    viteConfig.worker.format = 'es';
    viteConfig.optimizeDeps = viteConfig.optimizeDeps ?? {};
    viteConfig.optimizeDeps.exclude = [
      ...(viteConfig.optimizeDeps.exclude || []),
      '@huggingface/transformers',
    ];
    viteConfig.build = viteConfig.build ?? {};
    viteConfig.build.target = 'esnext';
    return viteConfig as unknown as typeof config;
  },
};

export default config;
```

### Demo page

A live demo page exists at `src/app/whisper/page.tsx` in the Next.js app. Visit `/whisper` when the dev server is running.