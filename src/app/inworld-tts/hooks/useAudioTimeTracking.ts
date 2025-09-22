import { useState, useEffect } from "react";

export function useAudioTimeTracking(audioElement: HTMLAudioElement | null, audioUrl: string | null) {
  const [currentTime, setCurrentTime] = useState<number>(0);

  useEffect(() => {
    if (!audioElement) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audioElement.currentTime);
    };

    const handleEnded = () => {
      setCurrentTime(0);
    };

    const handleLoadedData = () => {
      setCurrentTime(0);
    };

    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('loadeddata', handleLoadedData);

    return () => {
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.removeEventListener('loadeddata', handleLoadedData);
    };
  }, [audioElement, audioUrl]);

  return currentTime;
}
