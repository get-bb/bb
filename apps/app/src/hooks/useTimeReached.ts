import { useCallback, useSyncExternalStore } from "react";

const TIMER_SLACK_MS = 1_000;

export function useTimeReached(at: number | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (at === null) return () => undefined;
      const timer = setTimeout(
        onChange,
        Math.max(0, at - Date.now()) + TIMER_SLACK_MS,
      );
      return () => clearTimeout(timer);
    },
    [at],
  );
  return useSyncExternalStore(subscribe, () => at !== null && Date.now() >= at);
}
