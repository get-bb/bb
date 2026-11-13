import { useSyncExternalStore } from "react";

type Listener = () => void;

function createStoredRecord(storageKey: string) {
  let cache: Readonly<Record<string, string>> | null = null;
  const listeners = new Set<Listener>();

  function read(): Readonly<Record<string, string>> {
    if (cache !== null) return cache;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(globalThis.localStorage?.getItem(storageKey) ?? "{}");
    } catch {
      parsed = null;
    }
    const next: Record<string, string> = {};
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") next[key] = value;
      }
    }
    cache = next;
    return next;
  }

  function write(next: Record<string, string>): void {
    cache = next;
    try {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(next));
    } catch {
      return;
    }
    for (const listener of listeners) listener();
  }

  return {
    read,
    set(key: string, value: string | null): void {
      const current = read();
      if ((current[key] ?? null) === value) return;
      const next = { ...current };
      if (value === null) delete next[key];
      else next[key] = value;
      write(next);
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const projectExpansion = createStoredRecord("conductor.sidebar.projects");
const lastActiveThreads = createStoredRecord("conductor.sidebar.lastThread");

export function useProjectExpansion(): Readonly<Record<string, string>> {
  return useSyncExternalStore(
    projectExpansion.subscribe,
    projectExpansion.read,
    projectExpansion.read,
  );
}

export function setProjectExpanded(projectId: string, expanded: boolean): void {
  projectExpansion.set(projectId, expanded ? "open" : "closed");
}

export function useLastActiveThreads(): Readonly<Record<string, string>> {
  return useSyncExternalStore(
    lastActiveThreads.subscribe,
    lastActiveThreads.read,
    lastActiveThreads.read,
  );
}

export function rememberActiveThread(workspaceKey: string, threadId: string) {
  lastActiveThreads.set(workspaceKey, threadId);
}
