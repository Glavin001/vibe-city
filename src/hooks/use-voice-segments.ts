import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactRealTimeVADOptions } from '@ricky0123/vad-react';
import { useMicVAD } from '@ricky0123/vad-react';
import { useWhisper, type WhisperOptions } from './use-whisper';
import type { SpeechRecognitionStatus } from './use-speech-recognition';

export interface VoiceSegmentsOptions {
  /** Options forwarded to Whisper hook */
  whisper?: Omit<WhisperOptions, 'onTextUpdate' | 'onTextChange' | 'onStatusChange' | 'onError' | 'autoStart'> & {
    /** Auto-start Whisper recorder when ready (managed relative to VAD state). Default: true */
    autoStart?: boolean;
  };

  /** Options forwarded to VAD */
  vad?: {
    model?: ReactRealTimeVADOptions['model']; // e.g., 'v5'
    startOnLoad?: boolean; // whether to start listening immediately
    userSpeakingThreshold?: number; // default 0.6
    baseAssetPath?: string; // default '/vad/'
    onnxWASMBasePath?: string; // default '/vad/'
  };

  /** Delay after VAD end before finalizing a segment (ms). Default: 300ms */
  settleMs?: number;
  /** Optional maximum time to wait for Whisper 'complete' after settle elapses (ms). Default: 1500ms */
  whisperWaitMs?: number;
  /**
   * Auto-load Whisper model on mount.
   * Default: true
   * @deprecated Causes Speech Recognition machine to get stuck in 'loading' state
   * */
  // autoLoad?: boolean;

  /** Live preview callback (token updates) */
  onLiveUpdate?: (text: string) => void;
  /** Final segment callback after settle period */
  onSegment?: (finalText: string) => void;
  /** Called when speech resumes and we should consider pausing TTS */
  onInterruption?: () => void;

  /** Scoped error callbacks */
  onWhisperError?: (err: string) => void;
  onVadError?: (err: string) => void;
}

export interface VoiceSegmentsResult {
  // High-level combined status
  status: 'boot' | 'ready' | 'speaking' | 'settling' | 'idle' | 'error';

  // Live and recent final
  liveText: string;
  lastFinalText: string | null;

  // Underlying statuses
  whisperStatus: SpeechRecognitionStatus;
  vadListening: boolean;
  vadUserSpeaking: boolean;
  whisperIsReady: boolean;
  whisperIsRecording: boolean;

  // Flush/settle indicators
  settleRemainingMs: number | null;
  waitingForWhisper: boolean;
  waitingRemainingMs: number | null;

  // Errors
  errors: { whisper: string | null; vad: string | null };

  // Controls
  start: () => void; // start listening (VAD)
  stop: () => void; // stop listening (VAD)
  toggle: () => void; // toggle listening (VAD)
  load: () => void; // load Whisper model
  // Debug info
  chunkCount: number;
  debugForceFlush: () => void;
}

export function useVoiceSegments(options: VoiceSegmentsOptions = {}): VoiceSegmentsResult {
  // console.log("[useVoiceSegments] useVoiceSegments");

  const settleMs = options.settleMs ?? 300;
  const whisperWaitMs = 60_000; // options.whisperWaitMs ?? 1500;
  // const autoLoad = options.autoLoad !== false;
  const autoLoad = false; // FIXME: causes Speech Recognition machine to get stuck in 'loading' state

  // Errors (scoped)
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [vadError, setVadError] = useState<string | null>(null);

  // Live preview text and last finalized text
  const [liveText, setLiveText] = useState<string>('');
  const liveTextRef = useRef<string>('');
  const [lastFinalText, setLastFinalText] = useState<string | null>(null);
  // Track the longest transcript observed during the current speaking segment to avoid losing early words
  const bestLiveTextRef = useRef<string>('');

  // Settle timer for end-of-speech finalization
  const settleTimerRef = useRef<number | null>(null);
  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  // Waiting timer for Whisper completion after settle
  const waitingTimerRef = useRef<number | null>(null);
  const clearWaitingTimer = useCallback(() => {
    if (waitingTimerRef.current) {
      window.clearTimeout(waitingTimerRef.current);
      waitingTimerRef.current = null;
    }
  }, []);

  // Deadlines and countdowns for UI
  const settleDeadlineRef = useRef<number | null>(null);
  const waitingDeadlineRef = useRef<number | null>(null);
  const [settleRemainingMs, setSettleRemainingMs] = useState<number | null>(null);
  const [waitingRemainingMs, setWaitingRemainingMs] = useState<number | null>(null);
  const waitingForWhisperRef = useRef<boolean>(false);
  const [waitingForWhisper, setWaitingForWhisper] = useState<boolean>(false);

  // Internal ticker to update countdowns while active
  const tickerRef = useRef<number | null>(null);
  const ensureTicker = useCallback(() => {
    if (tickerRef.current) return;
    tickerRef.current = window.setInterval(() => {
      const now = Date.now();
      if (settleDeadlineRef.current) {
        const rem = Math.max(0, settleDeadlineRef.current - now);
        setSettleRemainingMs(rem);
      } else {
        setSettleRemainingMs(null);
      }
      if (waitingDeadlineRef.current) {
        const remW = Math.max(0, waitingDeadlineRef.current - now);
        setWaitingRemainingMs(remW);
      } else {
        setWaitingRemainingMs(null);
      }
      if (!settleDeadlineRef.current && !waitingDeadlineRef.current && tickerRef.current) {
        window.clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    }, 50);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearSettleTimer();
      clearWaitingTimer();
      if (tickerRef.current) {
        window.clearInterval(tickerRef.current);
        tickerRef.current = null;
      }
    };
  }, [clearSettleTimer, clearWaitingTimer]);

  // Whisper integration

  // Extract whisper options into variables
  const whisperLanguage = options.whisper?.language ?? 'en';
  const whisperAutoStart = options.whisper?.autoStart ?? true;
  const whisperDataRequestInterval = options.whisper?.dataRequestInterval ?? 250;

  // Memoize event handlers as callbacks
  const handleWhisperTextChange = useCallback((t: string) => {
    // console.log("[useVoiceSegments] onTextChange", t);
    // console.log("[useVoiceSegments] onTextUpdate", t);
    const txt = t ?? '';
    liveTextRef.current = txt;
    setLiveText(txt);
    // Preserve the longest version seen this segment
    if (txt.length > (bestLiveTextRef.current?.length ?? 0)) {
      bestLiveTextRef.current = txt;
    }
    if (options.onLiveUpdate) options.onLiveUpdate(txt);
  }, [options]);

  // Finalization helper
  const finalizeAndFlush = useCallback((_reason: 'settle' | 'whisper-complete' | 'timeout', textOverride?: string) => {
    // Clear timers/state
    clearSettleTimer();
    clearWaitingTimer();
    settleDeadlineRef.current = null;
    waitingDeadlineRef.current = null;
    setSettleRemainingMs(null);
    setWaitingRemainingMs(null);
    waitingForWhisperRef.current = false;
    setWaitingForWhisper(false);

    const candidate = (textOverride ?? liveTextRef.current ?? '').trim();
    const best = (bestLiveTextRef.current ?? '').trim();
    const text = best.length >= candidate.length ? best : candidate;
    if (text.length > 0) {
      setLastFinalText(text);
      if (options.onSegment) options.onSegment(text);
    }
    liveTextRef.current = '';
    bestLiveTextRef.current = '';
    setLiveText('');
    // Advance the logical boundary to the end of the committed text so no chunks are re-used
    try {
      // markSegmentBoundary();
    } catch {}
  }, [clearSettleTimer, clearWaitingTimer, options]);

  const handleWhisperStatusChange = useCallback((s: string) => {
    // console.log("[useVoiceSegments] onStatusChange", s);
    if (s === 'complete' && waitingForWhisperRef.current) {
      // Flush immediately on Whisper completion if we were waiting
      finalizeAndFlush('whisper-complete', liveTextRef.current || '');
    }
  }, [finalizeAndFlush]);

  const handleWhisperError = useCallback((e: string) => {
    console.log("[useVoiceSegments] onError", e);
    setWhisperError(e);
    if (options.onWhisperError) options.onWhisperError(e);
  }, [options]);

  const {
    status: whisperStatus,
    isReady: whisperIsReady,
    isRecording: whisperIsRecording,
    startRecording: whisperStartRecording,
    stopRecording: whisperStopRecording,
    loadModel: whisperLoadModel,
    error: whisperErr,
    finalizeCurrentRecording,
    markSegmentBoundary,
    getChunkCount,
  } = useWhisper({
    language: whisperLanguage,
    autoStart: whisperAutoStart,
    dataRequestInterval: whisperDataRequestInterval,
    onTextChange: handleWhisperTextChange,
    onStatusChange: handleWhisperStatusChange,
    onError: handleWhisperError,
  });

  useEffect(() => {
    if (whisperErr) {
      setWhisperError(whisperErr);
      if (options.onWhisperError) options.onWhisperError(whisperErr);
    }
  }, [whisperErr, options]);

  // Auto-load Whisper model
  useEffect(() => {
    if (!autoLoad) return;
    whisperLoadModel();
  }, [autoLoad, whisperLoadModel]);

  // VAD integration
  const prevSpeakingRef = useRef<boolean>(false);
  const vad = useMicVAD({
    model: options.vad?.model ?? 'v5',
    startOnLoad: options.vad?.startOnLoad ?? false,
    userSpeakingThreshold: options.vad?.userSpeakingThreshold ?? 0.6,
    baseAssetPath: options.vad?.baseAssetPath ?? '/vad/',
    onnxWASMBasePath: options.vad?.onnxWASMBasePath ?? '/vad/',
    onSpeechEnd: () => {
      console.log("[useVoiceSegments] onSpeechEnd");
      // Start settle window; finalize after delay
      clearSettleTimer();
      settleDeadlineRef.current = Date.now() + settleMs;
      ensureTicker();
      settleTimerRef.current = window.setTimeout(() => {
        // After settle, prefer Whisper 'complete'. If not yet complete, wait up to whisperWaitMs.
        if (whisperStatus === 'complete') {
          // Already have final text
          finalizeAndFlush('settle', liveTextRef.current || '');
          return;
        }

        // Otherwise, ask Whisper to finalize using the full recording window
        waitingForWhisperRef.current = true;
        setWaitingForWhisper(true);
        waitingDeadlineRef.current = Date.now() + whisperWaitMs;
        ensureTicker();
        clearWaitingTimer();
        finalizeCurrentRecording()
          .then((finalText) => {
            finalizeAndFlush('whisper-complete', finalText || liveTextRef.current || '');
          })
          .catch(() => {
            // Allow fallback timer to handle it
          });

        waitingTimerRef.current = window.setTimeout(() => {
          // Fallback: flush whatever we have (may be empty)
          finalizeAndFlush('timeout', liveTextRef.current || '');
        }, whisperWaitMs) as unknown as number;
      }, settleMs) as unknown as number;
    },
  });

  useEffect(() => {
    if (vad.errored) {
      setVadError(vad.errored);
      if (options.onVadError) options.onVadError(vad.errored);
    }
  }, [vad.errored, options]);

  // Detect speaking start to trigger interruption callback
  useEffect(() => {
    const now = !!vad.userSpeaking;
    const prev = prevSpeakingRef.current;
    prevSpeakingRef.current = now;
    if (!prev && now) {
      // Interruption if there is any live text or external policy says so
      const txt = (liveTextRef.current || '').trim();
      if (txt.length > 0 && options.onInterruption) options.onInterruption();
      // Cancel pending settle if any
      clearSettleTimer();
      // Reset best-live accumulator at start of a new speaking segment
      bestLiveTextRef.current = '';
      // Establish a fresh logical segment boundary at start of speech so we never lose early chunks in long runs
      try {
        markSegmentBoundary(getChunkCount());
      } catch {}
    }
  }, [vad.userSpeaking, options, clearSettleTimer, markSegmentBoundary, getChunkCount]);

  // Keep Whisper recorder aligned to VAD listening state
  useEffect(() => {
    if (!whisperIsReady) return;
    if (vad.listening && !whisperIsRecording) {
      whisperStartRecording();
    } else if (!vad.listening && whisperIsRecording) {
      whisperStopRecording();
    }
  }, [vad.listening, whisperIsReady, whisperIsRecording, whisperStartRecording, whisperStopRecording]);

  // Debug: force immediate finalize and flush
  const debugForceFlush = useCallback(() => {
    waitingForWhisperRef.current = true;
    setWaitingForWhisper(true);
    finalizeCurrentRecording()
      .then((txt) => finalizeAndFlush('whisper-complete', (txt || liveTextRef.current || '').trim()))
      .catch(() => finalizeAndFlush('timeout', (liveTextRef.current || '').trim()));
  }, [finalizeCurrentRecording, finalizeAndFlush]);

  // Combined status
  const combinedStatus: VoiceSegmentsResult['status'] = useMemo(() => {
    if (whisperError || vadError) return 'error';
    if (!whisperIsReady || vad.loading) return 'boot';
    if (vad.userSpeaking) return 'speaking';
    if (settleTimerRef.current) return 'settling';
    if (vad.listening) return 'ready';
    return 'idle';
  }, [whisperError, vadError, whisperIsReady, vad.loading, vad.userSpeaking, vad.listening]);

  // Controls
  const start = useCallback(() => {
    if (!vad.listening) vad.toggle();
  }, [vad]);
  const stop = useCallback(() => {
    if (vad.listening) vad.toggle();
  }, [vad]);
  const toggle = useCallback(() => {
    vad.toggle();
  }, [vad]);
  const load = useCallback(() => {
    whisperLoadModel();
  }, [whisperLoadModel]);

  return {
    status: combinedStatus,
    liveText,
    lastFinalText,
    whisperStatus,
    vadListening: vad.listening,
    vadUserSpeaking: vad.userSpeaking,
    whisperIsReady,
    whisperIsRecording,
    settleRemainingMs,
    waitingForWhisper,
    waitingRemainingMs,
    errors: { whisper: whisperError, vad: vadError },
    start,
    stop,
    toggle,
    load,
    chunkCount: getChunkCount(),
    debugForceFlush,
  };
}


