import type { UIMessage } from "@ai-sdk/react";
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type ChatRequestOptions,
  type ChatTransport,
  type LanguageModel,
  type UIMessageChunk,
} from "ai";
import type { GoogleGenerativeAIProviderOptions } from "@ai-sdk/google";

// Extract the tools type from streamText parameters
type StreamTextParams = Parameters<typeof streamText>[0];
type ToolsType = StreamTextParams["tools"];

export class CustomChatTransport implements ChatTransport<UIMessage> {
  private model: LanguageModel;
  private systemPrompt: string = "";
  private tools: ToolsType;

  constructor(model: LanguageModel, tools?: ToolsType) {
    this.model = model;
    this.tools = tools;
  }

  updateModel(model: LanguageModel) {
    this.model = model;
  }

  updateSystemPrompt(prompt: string) {
    this.systemPrompt = prompt ?? "";
  }

  updateTools(tools: ToolsType) {
    this.tools = tools;
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
      tools: this.tools,
      stopWhen: this.tools ? stepCountIs(5) : undefined,
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


