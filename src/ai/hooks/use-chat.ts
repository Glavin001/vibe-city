import { type UIMessage, type UseChatOptions, useChat as useChatSDK } from "@ai-sdk/react";
import { type ChatInit, type LanguageModel } from "ai";
import { useEffect, useRef } from "react";
import { CustomChatTransport } from "../custom-chat-transport";

type ClientChatOptions = Omit<ChatInit<UIMessage>, "transport"> &
  Pick<UseChatOptions<UIMessage>, "experimental_throttle" | "resume">;

export function useClientSideChat(
  model: LanguageModel,
  options?: ClientChatOptions,
) {
  const transportRef = useRef<CustomChatTransport | null>(null);

  if (!transportRef.current) {
    transportRef.current = new CustomChatTransport(model);
  }

  useEffect(() => {
    transportRef.current?.updateModel(model);
  }, [model]);

  const setSystemPrompt = (prompt: string) => {
    transportRef.current?.updateSystemPrompt(prompt ?? "");
  };

  const result = useChatSDK({ transport: transportRef.current, ...(options ?? {}) });
  return { ...result, setSystemPrompt } as typeof result & { setSystemPrompt: (prompt: string) => void };
}


