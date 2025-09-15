"use client";

import { createGoogleGenerativeAI } from "@ai-sdk/google";

export function google(modelId: string, options: { apiKey: string }) {
  const googleAI = createGoogleGenerativeAI({ apiKey: options.apiKey });
  return googleAI(modelId);
}


