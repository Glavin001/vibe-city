import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactRealTimeVADOptions } from '@ricky0123/vad-react';
import { useMicVAD } from '@ricky0123/vad-react';
import { useWhisper, type WhisperOptions } from './use-whisper';
import type { SpeechRecognitionStatus } from './use-speech-recognition';
import { useActorRef, useSelector } from '@xstate/react';
import { voiceSegmentsMachine } from '@/machines/voiceSegments.machine';
import { inspect } from '@/machines/inspector';

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
  autoLoad?: boolean;

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
  const settleMs = options.settleMs ?? 300;
  const whisperWaitMs = options.whisperWaitMs ?? 1500;

  // console.log("[useVoiceSegments] render");
  useEffect(() => {
    console.log("[useVoiceSegments] mount");
    return () => {
      console.log("[useVoiceSegments] unmount");
    }
  }, []);

  // Errors (scoped)
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [vadError, setVadError] = useState<string | null>(null);

  // Machine
  const vsActor = useActorRef(voiceSegmentsMachine, { input: { settleMs, whisperWaitMs }, inspect });

  const liveText = useSelector(vsActor, (s) => s.context.liveText);
  const lastFinalText = useSelector(vsActor, (s) => s.context.lastFinalText);
  const waitingForWhisper = useSelector(vsActor, (s) => s.context.waitingForWhisper);
  const settleDeadline = useSelector(vsActor, (s) => s.context.settleDeadline);
  const waitingDeadline = useSelector(vsActor, (s) => s.context.waitingDeadline);
  const bestLiveText = useSelector(vsActor, (s) => s.context.bestLiveText);

  // Derived countdowns for UI
  const [settleRemainingMs, setSettleRemainingMs] = useState<number | null>(null);
  const [waitingRemainingMs, setWaitingRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setSettleRemainingMs(settleDeadline ? Math.max(0, settleDeadline - now) : null);
      setWaitingRemainingMs(waitingDeadline ? Math.max(0, waitingDeadline - now) : null);
    }, 50);
    return () => window.clearInterval(id);
  }, [settleDeadline, waitingDeadline]);

  // Whisper integration

  // Extract whisper options into variables
  const whisperLanguage = options.whisper?.language ?? 'en';
  const whisperAutoStart = options.whisper?.autoStart ?? true;
  const whisperDataRequestInterval = options.whisper?.dataRequestInterval ?? 250;

  // Memoize event handlers as callbacks
  const handleWhisperTextChange = useCallback((t: string) => {
    const txt = t ?? '';
    if (options.onLiveUpdate) options.onLiveUpdate(txt);
  }, [options]);

  // Finalization helper (defined after markSegmentBoundary is initialized below)
  let finalizeAndFlush: (finalText: string) => void;

  const handleWhisperStatusChange = useCallback((s: SpeechRecognitionStatus) => {
    // Keep machine in sync
    vsActor.send({ type: 'WHISPER.STATUS', status: s });
  }, [vsActor]);

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
    finalizeUpTo,
    markSegmentBoundary,
    getChunkCount,
  } = useWhisper({
    language: whisperLanguage,
    autoStart: whisperAutoStart,
    dataRequestInterval: whisperDataRequestInterval,
    onTextChange: (txt) => {
      const canSend = vsActor.getSnapshot().can({ type: 'LIVE_UPDATE', text: txt ?? '' });
      console.log("[useVoiceSegments] onTextChange", canSend, txt);
      vsActor.send({ type: 'LIVE_UPDATE', text: txt ?? '' });
      handleWhisperTextChange(txt ?? '');
    },
    onStatusChange: (s) => {
      vsActor.send({ type: 'WHISPER.STATUS', status: s });
      handleWhisperStatusChange(s);
      // If we're waiting for Whisper to complete (post-VAD end), finalize once ready
      if (s === 'complete') {
        const snap = vsActor.getSnapshot();
        const waiting = !!(snap.context as any).waitingForWhisper;
        if (waiting) {
          finalizeCurrentRecording()
            .then((txt) => {
              const candidate = (txt || '').trim();
              const best = (bestLiveText || '').trim();
              const live = (liveText || '').trim();
              const finalOut = [candidate, best, live].reduce((a, b) => (b.length > a.length ? b : a), '');
              finalizeAndFlush(finalOut);
              vsActor.send({ type: 'WHISPER.COMPLETE' });
            })
            .catch(() => {
              const best = (bestLiveText || '').trim();
              const live = (liveText || '').trim();
              const fallback = best.length >= live.length ? best : live;
              finalizeAndFlush(fallback);
              vsActor.send({ type: 'WHISPER.COMPLETE' });
            });
        }
      }
    },
    onError: handleWhisperError,
  });

  // Define finalizeAndFlush now that markSegmentBoundary is initialized
  finalizeAndFlush = useCallback((finalText: string) => {
    const candidate = (finalText || '').trim();
    const best = (bestLiveText || '').trim();
    const live = (liveText || '').trim();
    const text = [candidate, best, live].reduce((a, b) => (b.length > a.length ? b : a), '');
    if (text.length > 0) {
      if (options.onSegment) options.onSegment(text);
      try { markSegmentBoundary(); } catch {}
    }
  }, [bestLiveText, liveText, markSegmentBoundary, options]);

  useEffect(() => {
    if (whisperErr) {
      setWhisperError(whisperErr);
      if (options.onWhisperError) options.onWhisperError(whisperErr);
    }
  }, [whisperErr, options]);

  // Auto-load disabled per upstream constraint; expose load() control instead

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
      vsActor.send({ type: 'VAD.END' });
      // Trigger finalization then flush using longest of (final, best-live, live) BEFORE signaling machine completion
      finalizeCurrentRecording()
        .then((txt) => {
          const candidate = (txt || '').trim();
          const best = (bestLiveText || '').trim();
          const live = (liveText || '').trim();
          const finalOut = [candidate, best, live].reduce((a, b) => (b.length > a.length ? b : a), '');
          finalizeAndFlush(finalOut);
          vsActor.send({ type: 'WHISPER.COMPLETE' });
        })
        .catch(() => {
          const best = (bestLiveText || '').trim();
          const live = (liveText || '').trim();
          const fallback = best.length >= live.length ? best : live;
          finalizeAndFlush(fallback);
          vsActor.send({ type: 'WHISPER.COMPLETE' });
        });
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
      if ((liveText || '').trim().length > 0 && options.onInterruption) options.onInterruption();
      vsActor.send({ type: 'VAD.START' });
    }
  }, [vad.userSpeaking, options, liveText, vsActor]);

  // Keep Whisper recorder aligned to VAD listening state
  useEffect(() => {
    if (!whisperIsReady) return;
    if (vad.listening && !whisperIsRecording) {
      whisperStartRecording();
    } else if (!vad.listening && whisperIsRecording) {
      whisperStopRecording();
    }
  }, [vad.listening, whisperIsReady, whisperIsRecording, whisperStartRecording, whisperStopRecording]);

  // Safety: mid-speech forced sub-segment flush if chunk span grows too large
  useEffect(() => {
    if (!whisperIsRecording || !whisperIsReady) return;
    if (!(whisperStatus === 'ready' || whisperStatus === 'complete')) return;
    const MAX_SEC = 30; // Whisper limit
    const EST_CHUNK_MS = options.whisper?.dataRequestInterval ?? 250;
    const MAX_CHUNKS = Math.floor((MAX_SEC * 1000) / EST_CHUNK_MS);

    const maybeFlush = async () => {
      try {
        const count = getChunkCount();
        // We cannot directly read the current segment start; we conservatively flush the oldest ~MAX_CHUNKS window
        if (count > MAX_CHUNKS * 1.5) {
          const end = Math.max(MAX_CHUNKS, Math.floor(count * 0.6));
          const txt = (await finalizeUpTo(end)) || '';
          const best = (bestLiveText || '').trim();
          const live = (liveText || '').trim();
          const finalOut = [txt.trim(), best, live].reduce((a, b) => (b.length > a.length ? b : a), '');
          if (finalOut.length > 0) {
            finalizeAndFlush(finalOut);
            try { markSegmentBoundary(end); } catch {}
            // Tell machine a completion happened; it will re-enter speaking on next VAD START
            vsActor.send({ type: 'WHISPER.COMPLETE' });
          }
        }
      } catch {}
    };

    const id = window.setInterval(maybeFlush, 500);
    return () => window.clearInterval(id);
  }, [whisperIsRecording, whisperIsReady, whisperStatus, bestLiveText, liveText, vsActor, options.whisper?.dataRequestInterval, finalizeUpTo, finalizeAndFlush, getChunkCount, markSegmentBoundary]);

  // Debug: force immediate finalize and flush
  const debugForceFlush = useCallback(() => {
    finalizeCurrentRecording().then((txt) => {
      const candidate = (txt || '').trim();
      const best = (bestLiveText || '').trim();
      const live = (liveText || '').trim();
      const finalOut = [candidate, best, live].reduce((a, b) => (b.length > a.length ? b : a), '');
      finalizeAndFlush(finalOut);
      vsActor.send({ type: 'WHISPER.COMPLETE' });
    }).catch(() => {
      const best = (bestLiveText || '').trim();
      const live = (liveText || '').trim();
      const fallback = best.length >= live.length ? best : live;
      finalizeAndFlush(fallback);
      vsActor.send({ type: 'WHISPER.COMPLETE' });
    });
  }, [bestLiveText, liveText, finalizeCurrentRecording, finalizeAndFlush, vsActor]);

  // Combined status
  const combinedStatus: VoiceSegmentsResult['status'] = useMemo(() => {
    if (whisperError || vadError) return 'error';
    if (!whisperIsReady || vad.loading) return 'boot';
    if (vad.userSpeaking) return 'speaking';
    if (waitingForWhisper) return 'settling';
    if (vad.listening) return 'ready';
    return 'idle';
  }, [whisperError, vadError, whisperIsReady, vad.loading, vad.userSpeaking, vad.listening, waitingForWhisper]);

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


