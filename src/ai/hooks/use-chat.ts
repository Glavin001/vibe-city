import {
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from "@ai-sdk/react";
import { type ChatInit, type LanguageModel } from "ai";
import { useEffect, useRef } from "react";
import { CustomChatTransport } from "../custom-chat-transport";

type CustomChatOptions = Omit<ChatInit<UIMessage>, "transport"> &
  Pick<UseChatOptions<UIMessage>, "experimental_throttle" | "resume">;

export function useChat(model: LanguageModel, options?: CustomChatOptions) {
  const transportRef = useRef<CustomChatTransport | null>(null);

  if (!transportRef.current) {
    transportRef.current = new CustomChatTransport(model);
  }

  useEffect(() => {
    transportRef.current?.updateModel(model);
  }, [model]);

  return useChatSDK({
    transport: transportRef.current,
    ...options,
  });
}


