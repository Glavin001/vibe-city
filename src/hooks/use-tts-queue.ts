import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TtsQueueStatus =
  | "pending"
  | "generating"
  | "ready"
  | "playing"
  | "paused"
  | "played"
  | "error"
  | "skipped";

export type TtsQueueItem = {
  audioUrl?: string;
  status: TtsQueueStatus;
};

type UseTtsQueueParams = {
  items: TtsQueueItem[];
  playhead: number;
  setPlayhead: React.Dispatch<React.SetStateAction<number>>;
  autoplay: boolean;
  setAutoplay: React.Dispatch<React.SetStateAction<boolean>>;
  isUserPaused: boolean;
  setIsUserPaused: React.Dispatch<React.SetStateAction<boolean>>;
  onStatusChange: (index: number, status: TtsQueueStatus) => void;
  onError?: (message: string) => void;
  crossfadeMs?: number; // overlap duration in ms; 0 disables crossfade
};

type UseTtsQueueResult = {
  audioARef: React.RefObject<HTMLAudioElement | null>;
  audioBRef: React.RefObject<HTMLAudioElement | null>;
  activeAudioIndex: number;
  progressRatio: number;
  play: () => void;
  pause: () => void;
  stop: () => void;
  skip: () => void;
  clearAudioSources: () => void;
};

export function useTtsQueue({
  items,
  playhead,
  setPlayhead,
  autoplay,
  setAutoplay,
  isUserPaused,
  setIsUserPaused,
  onStatusChange,
  onError,
  crossfadeMs = 0,
}: UseTtsQueueParams): UseTtsQueueResult {
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const [activeAudioIndex, setActiveAudioIndex] = useState<number>(0);

  // Progress for current active audio (0..1)
  const [progressRatio, setProgressRatio] = useState<number>(0);

  const getActive = useCallback(() => (activeAudioIndex === 0 ? audioARef.current : audioBRef.current), [activeAudioIndex]);
  const getIdle = useCallback(() => (activeAudioIndex === 0 ? audioBRef.current : audioARef.current), [activeAudioIndex]);

  // Crossfade scheduling/cancellation
  const crossfadeScheduledForPlayheadRef = useRef<number | null>(null);
  const cancelCrossfadeRef = useRef<(() => void) | null>(null);

  // Preload next ready item into idle element
  useEffect(() => {
    const next = items[playhead + 1];
    const idle = getIdle();
    if (!idle) return;
    if (next && next.status === "ready" && next.audioUrl) {
      if (idle.src !== next.audioUrl) {
        idle.preload = "auto";
        idle.src = next.audioUrl;
        if (idle.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          idle.load();
        }
      }
    }
  }, [items, playhead, getIdle]);

  // Attach events to active element for ended/pause/timeupdate
  useEffect(() => {
    const audio = getActive();
    if (!audio) return;
    const onEnded = () => {
      onStatusChange(playhead, "played");
      setPlayhead((p) => p + 1);
      setIsUserPaused(false);
      setProgressRatio(0);
      // If we started next on idle (crossfade), adopt it as active
      const idle = getIdle();
      if (idle && !idle.paused) {
        // Reset ended element volume for future reuse
        try { audio.volume = 1; } catch {}
        // Switch active index to the idle element now playing
        setActiveAudioIndex((i) => 1 - i);
      } else {
        try { audio.volume = 1; } catch {}
      }
      crossfadeScheduledForPlayheadRef.current = null;
      if (cancelCrossfadeRef.current) {
        cancelCrossfadeRef.current();
        cancelCrossfadeRef.current = null;
      }
    };
    const onPlay = () => {
      setIsUserPaused(false);
    };
    const onPauseEvent = () => {
      if (audio.ended) return;
      setIsUserPaused(true);
      if (items[playhead] && items[playhead].status === "playing") {
        onStatusChange(playhead, "paused");
      }
    };
    const onTimeUpdate = () => {
      const dur = audio.duration || 0;
      const cur = audio.currentTime || 0;
      const ratio = dur > 0 ? Math.max(0, Math.min(1, cur / dur)) : 0;
      setProgressRatio(ratio);
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPauseEvent);
    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPauseEvent);
      audio.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [getActive, getIdle, items, onStatusChange, playhead, setIsUserPaused, setPlayhead]);

  // Crossfade: start next track early and ramp volumes
  useEffect(() => {
    if (!autoplay || isUserPaused) return;
    if (!crossfadeMs || crossfadeMs <= 0) return;
    const active = getActive();
    const idle = getIdle();
    const current = items[playhead];
    const next = items[playhead + 1];
    if (!active || !current || !next || !idle) return;
    if (next.status !== "ready" || !next.audioUrl) return;
    if (idle.src !== next.audioUrl || idle.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (active.paused) return;
    const duration = active.duration || 0;
    if (!(duration > 0)) return;
    const timeLeftSec = duration * (1 - (Number.isFinite(duration) ? (active.currentTime / duration) : 1));
    if (timeLeftSec * 1000 > crossfadeMs) return;
    if (crossfadeScheduledForPlayheadRef.current === playhead) return;
    crossfadeScheduledForPlayheadRef.current = playhead;

    let rafId = 0;
    let stopped = false;
    const startTs = performance.now();
    const fadeMs = Math.max(1, crossfadeMs);
    const activeStartVol = Math.max(0, Math.min(1, active.volume));
    const idleTargetVol = Math.max(0, Math.min(1, idle.volume || 1));
    try { idle.volume = 0; } catch {}

    // Mark next as playing for UI
    onStatusChange(playhead + 1, "playing");

    idle.play().catch(() => {
      setAutoplay(false);
      setIsUserPaused(true);
      if (onError) onError("Autoplay blocked or failed during crossfade");
    });

    const step = (now: number) => {
      if (stopped) return;
      const t = Math.max(0, Math.min(1, (now - startTs) / fadeMs));
      try { active.volume = (1 - t) * activeStartVol; } catch {}
      try { idle.volume = t * idleTargetVol; } catch {}
      if (t < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);

    cancelCrossfadeRef.current = () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      try { active.volume = activeStartVol; } catch {}
      try { idle.volume = idleTargetVol; } catch {}
    };

    return () => {
      if (cancelCrossfadeRef.current) {
        cancelCrossfadeRef.current();
        cancelCrossfadeRef.current = null;
      }
    };
  }, [autoplay, isUserPaused, crossfadeMs, getActive, getIdle, items, onError, onStatusChange, playhead, setAutoplay, setIsUserPaused]);

  // Autoplay current item and optionally swap to preloaded idle element
  useEffect(() => {
    if (!autoplay || isUserPaused) return;
    const active = getActive();
    const idle = getIdle();
    if (!active) return;
    const current = items[playhead];
    if (!current) return;
    if ((current.status === "ready" || current.status === "paused") && current.audioUrl) {
      const url = current.audioUrl;
      const canSwapToIdle = !!idle && idle.src === url && idle.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
      const performPlay = (element: HTMLAudioElement) => {
        element.play().then(() => {
          onStatusChange(playhead, "playing");
        }).catch(() => {
          setAutoplay(false);
          setIsUserPaused(true);
          if (onError) onError("Autoplay blocked or failed to play");
        });
      };
      if (canSwapToIdle && idle) {
        if (!active.paused) active.pause();
        performPlay(idle);
        setActiveAudioIndex((i) => 1 - i);
      } else {
        if (active.src !== url) {
          active.src = url;
        }
        performPlay(active);
      }
    } else if (current.status === "played" || current.status === "skipped") {
      setPlayhead((p) => p + 1);
    }
  }, [autoplay, isUserPaused, items, playhead, getActive, getIdle, onStatusChange, setAutoplay, setIsUserPaused, setPlayhead, onError]);

  const play = useCallback(() => {
    setAutoplay(true);
    setIsUserPaused(false);
    const active = getActive();
    const idle = getIdle();
    if (!active) return;
    const current = items[playhead];
    if (!current || !current.audioUrl) return;
    const url = current.audioUrl;
    const canSwapToIdle = !!idle && idle.src === url && idle.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    if (canSwapToIdle && idle) {
      if (!active.paused) active.pause();
      idle.play().catch(() => {
        setAutoplay(false);
        setIsUserPaused(true);
        if (onError) onError("Autoplay blocked or failed to play");
      });
      setActiveAudioIndex((i) => 1 - i);
    } else {
      if (active.src !== url) active.src = url;
      active.play().catch(() => {
        setAutoplay(false);
        setIsUserPaused(true);
        if (onError) onError("Autoplay blocked or failed to play");
      });
    }
  }, [getActive, getIdle, items, onError, playhead, setAutoplay, setIsUserPaused]);

  const pause = useCallback(() => {
    const audio = getActive();
    setIsUserPaused(true);
    if (audio && !audio.paused) audio.pause();
  }, [getActive, setIsUserPaused]);

  const stop = useCallback(() => {
    const a1 = audioARef.current;
    const a2 = audioBRef.current;
    if (a1) { a1.pause(); a1.currentTime = 0; }
    if (a2) { a2.pause(); a2.currentTime = 0; }
    setIsUserPaused(true);
    setAutoplay(false);
    if (cancelCrossfadeRef.current) {
      cancelCrossfadeRef.current();
      cancelCrossfadeRef.current = null;
    }
    crossfadeScheduledForPlayheadRef.current = null;
  }, [setAutoplay, setIsUserPaused]);

  const skip = useCallback(() => {
    const audio = getActive();
    if (audio && !audio.paused) audio.pause();
    const cur = items[playhead];
    if (cur && (cur.status === "playing" || cur.status === "paused")) {
      onStatusChange(playhead, "skipped");
    }
    setPlayhead((p) => p + 1);
    if (cancelCrossfadeRef.current) {
      cancelCrossfadeRef.current();
      cancelCrossfadeRef.current = null;
    }
    crossfadeScheduledForPlayheadRef.current = null;
  }, [getActive, items, onStatusChange, playhead, setPlayhead]);

  const clearAudioSources = useCallback(() => {
    const a1 = audioARef.current;
    const a2 = audioBRef.current;
    if (a1) { a1.removeAttribute("src"); a1.load(); }
    if (a2) { a2.removeAttribute("src"); a2.load(); }
    setActiveAudioIndex(0);
    setProgressRatio(0);
  }, []);

  return useMemo(() => ({
    audioARef,
    audioBRef,
    activeAudioIndex,
    progressRatio,
    play,
    pause,
    stop,
    skip,
    clearAudioSources,
  }), [activeAudioIndex, pause, play, progressRatio, skip, stop, clearAudioSources]);
}


