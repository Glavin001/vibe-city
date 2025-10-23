import { useEffect, useRef } from 'react';

/**
 * Custom hook that runs a callback function at a specified interval
 * @param callback - The function to execute at each interval
 * @param delay - The delay in milliseconds (null to pause)
 * @param deps - Dependencies array
 */
export function useInterval(callback: () => void, delay: number | null, deps: unknown[] = []) {
  const savedCallback = useRef<() => void>(callback);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    if (delay === null) {
      return;
    }

    const tick = () => {
      if (savedCallback.current) {
        savedCallback.current();
      }
    };

    const id = setInterval(tick, delay);
    return () => clearInterval(id);
  }, [delay, ...deps]);
}

