import { type UIMessage } from "@ai-sdk/react";
import {
  convertToModelMessages,
  streamText,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
} from "ai";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

export class CustomChatTransport implements ChatTransport<UIMessage> {
  private model: LanguageModel;
  private systemPrompt: string = "";

  constructor(model: LanguageModel) {
    this.model = model;
  }

  updateModel(model: LanguageModel) {
    this.model = model;
  }

  updateSystemPrompt(prompt: string) {
    this.systemPrompt = prompt ?? "";
  }

  async sendMessages(
    options: {
      chatId: string;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & {
      trigger: "submit-message" | "regenerate-message";
      messageId: string | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const result = streamText({
      model: this.model,
      messages: convertToModelMessages(options.messages),
      abortSignal: options.abortSignal,
      toolChoice: "auto",
      system: this.systemPrompt || undefined,
      providerOptions: {
        google: {
          thinkingConfig: {
            // thinkingBudget: 8192,
            thinkingBudget: 512,
            includeThoughts: true,
          },
        } satisfies GoogleGenerativeAIProviderOptions,
      },
    });

    console.log('Result', result);

    /*
    result.consumeStream();

    for await (const chunk of result.fullStream) {
      console.log('Chunk', chunk);
    }
      */

    return result.toUIMessageStream({
      onError: (error) => {
        if (error == null) return "Unknown error";
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        try {
          return JSON.stringify(error);
        } catch {
          return "An error occurred";
        }
      },
    });
  }

  async reconnectToStream(
    _options: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}


