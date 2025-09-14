import { useCallback, useEffect, useRef, useState } from "react";
import { KokoroWorkerClient } from "../lib/tts/kokoro-worker-client";
import type { VoiceInfo } from "./tts-types";

type GenerateArgs = { text: string; voice: string; speed: number };

export function useKokoroTtsGenerator() {
  const workerClientRef = useRef<KokoroWorkerClient | null>(null);
  const [voices, setVoices] = useState<Record<string, VoiceInfo>>({});
  const [selectedVoice, setSelectedVoice] = useState<string>("af_heart");
  const [speed, setSpeed] = useState<number>(1.3);
  const [device, setDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    if (workerClientRef.current) return;
    const client = new KokoroWorkerClient();
    workerClientRef.current = client;
    client.init((v, d) => {
      setVoices(v);
      setDevice(d);
      setReady(true);
      if (v && Object.keys(v).length > 0) setSelectedVoice(Object.keys(v)[0]);
    }, (err) => {
      setError(err.message);
    });
    return () => {
      client.dispose();
      workerClientRef.current = null;
    };
  }, []);

  const generate = useCallback(async ({ text, voice, speed }: GenerateArgs) => {
    const client = workerClientRef.current;
    if (!client) throw new Error("Worker not ready");
    return client.generate({ text, voice, speed });
  }, []);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    speed,
    setSpeed,
    device,
    error,
    ready,
    generate,
  };
}


