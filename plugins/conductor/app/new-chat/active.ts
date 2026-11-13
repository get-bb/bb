import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const mounted: string[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): string | null {
  return mounted.at(-1) ?? null;
}

export function useNewChatEnvironment(): string | null {
  return useSyncExternalStore(subscribe, current, current);
}

export function useMarkNewChatEnvironment(environmentId: string | null): void {
  useEffect(() => {
    if (environmentId === null) return;
    mounted.push(environmentId);
    notify();
    return () => {
      const index = mounted.lastIndexOf(environmentId);
      if (index !== -1) mounted.splice(index, 1);
      notify();
    };
  }, [environmentId]);
}
