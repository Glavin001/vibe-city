import { useState, useEffect, useCallback } from "react";
import type { Voice, VoicesResponse } from "../page";

const API_KEY_STORAGE_KEY = "inworld-tts-api-key";

export function useVoiceManagement() {
  const [apiKey, setApiKey] = useState(() => {
    // Load API key from localStorage on initialization
    if (typeof window !== 'undefined') {
      return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    }
    return "";
  });

  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>("");

  // Save API key to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (apiKey.trim()) {
        localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
      } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
      }
    }
  }, [apiKey]);

  const loadVoices = useCallback(async () => {
    if (!apiKey.trim()) return;

    setLoadingVoices(true);

    try {
      const response = await fetch('https://api.inworld.ai/tts/v1/voices?filter=language=en', {
        headers: { 'Authorization': `Basic ${apiKey}` }
      });

      if (!response.ok) {
        throw new Error(`Failed to load voices: ${response.statusText}`);
      }

      const data: VoicesResponse = await response.json();
      setVoices(data.voices);

      // Set default voice if available and none selected
      if (data.voices.length > 0 && !selectedVoice) {
        setSelectedVoice(data.voices[0].voiceId);
      }
    } catch (error) {
      console.error("Failed to load voices:", error);
      setVoices([]);
    } finally {
      setLoadingVoices(false);
    }
  }, [apiKey, selectedVoice]);

  // Load voices when API key changes
  useEffect(() => {
    if (apiKey.trim()) {
      loadVoices();
    } else {
      setVoices([]);
      setSelectedVoice("");
    }
  }, [apiKey, loadVoices]);

  return {
    apiKey,
    setApiKey,
    voices,
    loadingVoices,
    selectedVoice,
    setSelectedVoice,
    loadVoices,
  };
}
