import type { Voice } from "../page";

interface TtsConfigurationPanelProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  voices: Voice[];
  loadingVoices: boolean;
  selectedVoice: string;
  setSelectedVoice: (voice: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  timestampType: string;
  setTimestampType: (type: string) => void;
  text: string;
  setText: (text: string) => void;
  loading: boolean;
  onSpeak: () => void;
}

export function TtsConfigurationPanel({
  apiKey,
  setApiKey,
  voices,
  loadingVoices,
  selectedVoice,
  setSelectedVoice,
  selectedModel,
  setSelectedModel,
  temperature,
  setTemperature,
  speed,
  setSpeed,
  timestampType,
  setTimestampType,
  text,
  setText,
  loading,
  onSpeak,
}: TtsConfigurationPanelProps) {
  return (
    <div className="border border-gray-600 rounded-xl p-4 space-y-4 bg-gray-800/30">
      <div className="space-y-3">
        <div>
          <label htmlFor="api-key" className="block text-sm font-medium text-gray-300 mb-1">
            Base64 API Key
          </label>
          <input
            id="api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Paste your Base64 Inworld API key"
            className="w-full rounded-lg border px-3 py-2"
          />
          {apiKey && (
            <p className="text-xs text-green-400 mt-1">
              ✓ API key saved locally
            </p>
          )}
        </div>

        <div>
          <label htmlFor="voice-select" className="block text-sm font-medium text-gray-300 mb-1">
            Voice
          </label>
          <select
            id="voice-select"
            value={selectedVoice}
            onChange={(e) => setSelectedVoice(e.target.value)}
            disabled={loadingVoices || voices.length === 0}
            className="w-full rounded-lg border px-3 py-2 disabled:opacity-50"
          >
            {loadingVoices ? (
              <option>Loading voices...</option>
            ) : voices.length === 0 ? (
              <option disabled>Enter API key to load voices</option>
            ) : (
              voices.map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId}>
                  {voice.voiceId}
                  {voice.displayName && ` - ${voice.displayName}`}
                  {voice.description && ` (${voice.description})`}
                </option>
              ))
            )}
          </select>
          {voices.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {voices.length} voice{voices.length !== 1 ? 's' : ''} available
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="model-select" className="block text-sm font-medium text-gray-300 mb-1">
              Model
            </label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="inworld-tts-1">inworld-tts-1 (Standard)</option>
              <option value="inworld-tts-1-max">inworld-tts-1-max (Enhanced)</option>
            </select>
          </div>

          <div>
            <label htmlFor="speed-range" className="block text-sm font-medium text-gray-300 mb-1">
              Speaking Speed: {speed.toFixed(1)}x
            </label>
            <input
              id="speed-range"
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0.5x</span>
              <span className="text-center">Normal</span>
              <span>2.0x</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Controls speaking speed. 1.0x is normal speed.
            </p>
          </div>

          <div>
            <label htmlFor="temperature-range" className="block text-sm font-medium text-gray-300 mb-1">
              Temperature: {temperature.toFixed(1)}
            </label>
            <input
              id="temperature-range"
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0.0</span>
              <span className="text-center">Stable</span>
              <span>2.0</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Controls randomness. 0.6-1.0 recommended for stability.
            </p>
          </div>

          <div>
            <label htmlFor="timestamp-select" className="block text-sm font-medium text-gray-300 mb-1">
              Timing Data
            </label>
            <select
              id="timestamp-select"
              value={timestampType}
              onChange={(e) => setTimestampType(e.target.value)}
              className="w-full rounded-lg border px-3 py-2"
            >
              <option value="TIMESTAMP_TYPE_UNSPECIFIED">None</option>
              <option value="WORD">Word-level timing</option>
              <option value="CHARACTER">Character-level timing</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="text-input" className="block text-sm font-medium text-gray-300 mb-1">
            Text to Speak
          </label>
          <textarea
            id="text-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text..."
            rows={4}
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        <button
          type="button"
          onClick={onSpeak}
          disabled={loading || !apiKey.trim() || !selectedVoice}
          className="w-full rounded-lg px-4 py-2 text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
        >
          {loading ? "Generating..." : "Speak (MP3)"}
        </button>
      </div>
    </div>
  );
}
