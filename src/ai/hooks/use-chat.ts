import { useChat as useChatSDK, type UIMessage, type UseChatOptions } from "@ai-sdk/react";
import type { LanguageModel } from "ai";
// biome-ignore lint: streamText is needed for type extraction via typeof
import { streamText } from "ai";
import { useEffect, useRef } from "react";
import { CustomChatTransport } from "../custom-chat-transport";

// Extract the tools type from streamText parameters
type StreamTextParams = Parameters<typeof streamText>[0];
type ToolsType = StreamTextParams["tools"];

type ClientChatOptions = Omit<UseChatOptions<UIMessage>, "api" | "transport"> & {
  tools?: ToolsType;
};

export function useClientSideChat(
  model: LanguageModel,
  options?: ClientChatOptions,
) {
  const transportRef = useRef<CustomChatTransport | null>(null);

  if (!transportRef.current) {
    transportRef.current = new CustomChatTransport(model, options?.tools);
  }

  useEffect(() => {
    transportRef.current?.updateModel(model);
  }, [model]);

  useEffect(() => {
    transportRef.current?.updateTools(options?.tools);
  }, [options?.tools]);

  const setSystemPrompt = (prompt: string) => {
    transportRef.current?.updateSystemPrompt(prompt ?? "");
  };

  const result = useChatSDK({ transport: transportRef.current, ...(options ?? {}) });
  return { ...result, setSystemPrompt } as typeof result & { setSystemPrompt: (prompt: string) => void };
}


