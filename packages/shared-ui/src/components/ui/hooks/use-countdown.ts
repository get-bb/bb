import { useState, useSyncExternalStore } from "react";

export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface CountdownClock {
  expiresAt: number;
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => number;
}

function createCountdownClock(expiresAt: number): CountdownClock {
  let now: number | undefined;
  return {
    expiresAt,
    subscribe: (onStoreChange) => {
      const interval = setInterval(() => {
        now = Date.now();
        onStoreChange();
      }, 1_000);
      return () => clearInterval(interval);
    },
    getSnapshot: () => {
      if (now === undefined) now = Date.now();
      return now;
    },
  };
}

export function useCountdown(expiresAt: number): number {
  const [storedClock, setClock] = useState(() =>
    createCountdownClock(expiresAt),
  );
  let clock = storedClock;
  if (clock.expiresAt !== expiresAt) {
    clock = createCountdownClock(expiresAt);
    setClock(clock);
  }
  const now = useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    clock.getSnapshot,
  );
  return expiresAt - now;
}
