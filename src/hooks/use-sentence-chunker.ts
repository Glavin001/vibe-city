import { useCallback, useEffect, useRef } from "react";
import { SentenceStreamChunker } from "../lib/sentence-stream-chunker/sentence-stream-chunker";

type UseSentenceChunkerOptions = {
  locale?: string;
  charLimit?: number;
  wordLimit?: number;
  softPunct?: RegExp;
};

export function useSentenceChunker(options: UseSentenceChunkerOptions = {}) {
  const {
    locale = "en",
    charLimit = 220,
    wordLimit = Number.POSITIVE_INFINITY,
    softPunct = /[,;:—–\-]/,
  } = options;

  const chunkerRef = useRef<SentenceStreamChunker | null>(null);

  const reset = useCallback(() => {
    chunkerRef.current = new SentenceStreamChunker({
      locale,
      charLimit,
      wordLimit,
      softPunct,
    });
  }, [charLimit, locale, softPunct, wordLimit]);

  useEffect(() => {
    reset();
  }, [reset]);

  const push = useCallback((text: string, eos: boolean = false) => {
    if (!chunkerRef.current) reset();
    const ck = chunkerRef.current;
    if (!ck) return [] as ReturnType<SentenceStreamChunker["push"]>;
    return ck.push(text, { eos });
  }, [reset]);

  const flush = useCallback(() => {
    if (!chunkerRef.current) return [] as ReturnType<SentenceStreamChunker["flush"]>;
    return chunkerRef.current.flush();
  }, []);

  return { push, flush, reset };
}


