"use client";

import { useState, useRef } from "react";
import { TtsConfigurationPanel } from "./components/TtsConfigurationPanel";
import { AudioPlayer } from "./components/AudioPlayer";
import { TimingDisplay } from "./components/TimingDisplay";
import { useVoiceManagement } from "./hooks/useVoiceManagement";
import { useAudioTimeTracking } from "./hooks/useAudioTimeTracking";

// TypeScript types for Inworld TTS API
export interface Voice {
  voiceId: string;
  displayName: string;
  description: string;
  languages: string[];
}

export interface VoicesResponse {
  voices: Voice[];
}

export interface TtsRequest {
  text: string;
  voiceId: string;
  modelId: string;
  audioConfig?: {
    audioEncoding: string;
    temperature?: number;
    speed?: number;
  };
  timestampType?: string;
}

export interface TtsResponse {
  audioContent: string;
  timestampInfo?: {
    wordAlignment?: {
      words: string[];
      wordStartTimeSeconds: number[];
      wordEndTimeSeconds: number[];
    };
    characterAlignment?: {
      characters: string[];
      characterStartTimeSeconds: number[];
      characterEndTimeSeconds: number[];
    };
  };
}

export interface AlignmentData {
  items: string[];
  startTimes: number[];
  endTimes: number[];
}

export default function Page() {
  const [text, setText] = useState("What a wonderful day to be a text-to-speech model!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("inworld-tts-1");
  const [temperature, setTemperature] = useState<number>(0.8);
  const [speed, setSpeed] = useState<number>(1.0);
  const [timestampType, setTimestampType] = useState<string>("TIMESTAMP_TYPE_UNSPECIFIED");
  const [timestampInfo, setTimestampInfo] = useState<TtsResponse['timestampInfo'] | null>(null);

  const playerRef = useRef<HTMLAudioElement>(null);

  // Custom hooks for managing complex state
  const voiceManagement = useVoiceManagement();
  const currentTime = useAudioTimeTracking(playerRef.current, audioUrl);

  const handleSpeak = async () => {
    if (!voiceManagement.apiKey.trim()) {
      setError("Please enter your Inworld API key");
      return;
    }

    if (!voiceManagement.selectedVoice) {
      setError("Please select a voice");
      return;
    }

    setLoading(true);
    setError(null);
    setAudioUrl(null);
    setTimestampInfo(null);

    try {
      const body: TtsRequest = {
        text,
        voiceId: voiceManagement.selectedVoice,
        modelId: selectedModel,
        audioConfig: {
          audioEncoding: "MP3", // ensure MP3 payload for easy playback
          temperature: temperature,
          speed: speed,
        },
        timestampType: timestampType !== "TIMESTAMP_TYPE_UNSPECIFIED" ? timestampType : undefined,
      };

      const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
        method: "POST",
        headers: {
          Authorization: `Basic ${voiceManagement.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`TTS request failed: ${errorText}`);
      }

      const data: TtsResponse = await response.json(); // base64 audio
      const u8 = Uint8Array.from(atob(data.audioContent), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([u8], { type: "audio/mpeg" }));
      setAudioUrl(url);

      // Store timestamp info for display
      setTimestampInfo(data.timestampInfo || null);

      // Auto-play the audio
      if (playerRef.current) {
        playerRef.current.src = url;
        playerRef.current.play();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] py-8 px-4 flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-4xl font-extrabold">Inworld Text-to-Speech</h1>
          <p className="text-gray-500">
            Powered by{" "}
            <a
              className="underline"
              href="https://docs.inworld.ai/docs/tts-api"
              target="_blank"
              rel="noreferrer"
            >
              Inworld AI TTS API
            </a>
          </p>
        </div>

        <TtsConfigurationPanel
          apiKey={voiceManagement.apiKey}
          setApiKey={voiceManagement.setApiKey}
          voices={voiceManagement.voices}
          loadingVoices={voiceManagement.loadingVoices}
          selectedVoice={voiceManagement.selectedVoice}
          setSelectedVoice={voiceManagement.setSelectedVoice}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          temperature={temperature}
          setTemperature={setTemperature}
          speed={speed}
          setSpeed={setSpeed}
          timestampType={timestampType}
          setTimestampType={setTimestampType}
          text={text}
          setText={setText}
          loading={loading}
          onSpeak={handleSpeak}
        />

        {error && (
          <div className="text-sm text-red-400 bg-red-900/20 border border-red-700/50 rounded-lg p-3">
            {error}
          </div>
        )}

        <AudioPlayer
          ref={playerRef}
          audioUrl={audioUrl}
          loading={loading}
        />

        <TimingDisplay
          timestampInfo={timestampInfo}
          currentTime={currentTime}
        />
      </div>
    </div>
  );
}
