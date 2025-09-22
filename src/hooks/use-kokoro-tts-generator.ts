import { useMachine } from "@xstate/react";
import { useCallback, useRef } from "react";
import { kokoroTtsMachine } from "../machines/kokoroTts.machine";
import { inspect } from "@/machines/inspector";

type GenerateArgs = { text: string; voice: string; speed: number };

export function useKokoroTtsGenerator() {
  const generationIdRef = useRef<number>(1);
  const [state, send] = useMachine(kokoroTtsMachine, {
    inspect,
    input: {
      onUtteranceGenerated: undefined,
    },
  });

  const {
    voices,
    selectedSpeaker: selectedVoice,
    speed,
    device,
    error,
    loadingMessage,
  } = state.context;

  const isBoot = state.matches("boot");
  const isReady = state.matches("ready");
  const isGenerating = state.matches("generating");

  const setSelectedVoice = useCallback((voice: string) => {
    send({ type: 'USER.SET_VOICE', voice });
  }, [send]);

  const setSpeed = useCallback((speed: number) => {
    send({ type: 'USER.SET_SPEED', speed });
  }, [send]);

  const generate = useCallback(async ({ text, voice, speed }: GenerateArgs) => {
    if (!isReady) {
      throw new Error("TTS generator not ready");
    }

    const generationId = generationIdRef.current++;

    return new Promise<{ url: string }>((resolve, reject) => {
      // Use concurrent generation path that doesn't change states
      send({
        type: 'GEN.START',
        generationId,
        text,
        voice,
        speed,
        resolve,
        reject,
      });
    });
  }, [isReady, send]);

  return {
    voices,
    selectedVoice,
    setSelectedVoice,
    speed,
    setSpeed,
    device,
    error: isBoot ? loadingMessage : error,
    ready: isReady,
    isGenerating,
    generate,
  };
}


