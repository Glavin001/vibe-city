"use client";

import { useEffect, useRef, useState } from "react";
import { KokoroWorkerClient, type KokoroVoices } from "./kokoro-worker-client";

export function useKokoroWorker() {
  const clientRef = useRef<KokoroWorkerClient | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const [voices, setVoices] = useState<KokoroVoices>({});
  const [device, setDevice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (clientRef.current) return;
    const client = new KokoroWorkerClient();
    clientRef.current = client;
    client.init((v, d) => {
      setVoices(v);
      setDevice(d);
      setReady(true);
    }, (err) => {
      setError(err.message);
      setReady(false);
    });
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  return {
    client: clientRef.current,
    ready,
    voices,
    device,
    error,
  } as const;
}


