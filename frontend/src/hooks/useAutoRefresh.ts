import { useEffect, useRef } from 'react';

/**
 * Reusable hook for auto-refreshing data at a configurable interval.
 * @param callback - async function to call on each refresh
 * @param intervalMs - interval in milliseconds (default 15000)
 * @param enabled - whether auto-refresh is currently enabled
 */
export function useAutoRefresh(
  callback: () => void | Promise<void>,
  intervalMs: number = 15000,
  enabled: boolean = false,
) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      savedCallback.current();
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
