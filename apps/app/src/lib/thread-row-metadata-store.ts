import { useLayoutEffect } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk";
import type { PluginThreadRowMetadataSlot } from "@/lib/plugin-slots";

export function slotKey(slot: PluginThreadRowMetadataSlot): string {
  return `${slot.pluginId}/${slot.id}/${slot.generation}`;
}

function createStore<Snapshot>(read: () => Snapshot) {
  const listeners = new Set<() => void>();
  let snapshot = read();
  let queued = false;
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    changed(): void {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        snapshot = read();
        for (const listener of listeners) listener();
      });
    },
  };
}

const lineThreads = new Map<
  string,
  { thread: PluginSidebarThread; lines: number }
>();
export const lineThreadsStore = createStore(() =>
  [...lineThreads.values()].map((entry) => entry.thread),
);

export function useRegisterLineThread(thread: PluginSidebarThread): void {
  useLayoutEffect(() => {
    const entry = lineThreads.get(thread.id);
    lineThreads.set(thread.id, { thread, lines: (entry?.lines ?? 0) + 1 });
    if (entry?.thread !== thread) lineThreadsStore.changed();
    return () => {
      const current = lineThreads.get(thread.id);
      if (current === undefined) return;
      if (current.lines > 1)
        lineThreads.set(thread.id, { ...current, lines: current.lines - 1 });
      else {
        lineThreads.delete(thread.id);
        lineThreadsStore.changed();
      }
    };
  }, [thread]);
}

const collectedData = new Map<string, { data: unknown }>();
export const collectedStore = createStore(() => new Map(collectedData));

export function publishCollected(key: string, data: unknown): void {
  collectedData.set(key, { data });
  collectedStore.changed();
}

export function dropCollected(key: string): void {
  collectedData.delete(key);
  collectedStore.changed();
}

