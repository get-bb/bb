import { useCallback, useSyncExternalStore } from "react";
import type { experimental_PluginComposerThreadRowStatus } from "@bb/plugin-sdk";

type ThreadRowStatusListener = () => void;
type ThreadRowStatusOwner = string | symbol;

const statusesByThreadId = new Map<
  string,
  Map<
    ThreadRowStatusOwner,
    { pluginId: string; status: experimental_PluginComposerThreadRowStatus }
  >
>();
const listenersByThreadId = new Map<string, Set<ThreadRowStatusListener>>();

function notify(threadId: string): void {
  const listeners = listenersByThreadId.get(threadId);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getPluginThreadRowStatus(
  threadId: string,
): experimental_PluginComposerThreadRowStatus | null {
  const statuses = statusesByThreadId.get(threadId);
  if (!statuses || statuses.size === 0) return null;
  return statuses.values().next().value?.status ?? null;
}

export function setPluginThreadRowStatus(
  threadId: string | null,
  pluginId: string,
  status: experimental_PluginComposerThreadRowStatus | null,
  owner: ThreadRowStatusOwner = pluginId,
): void {
  if (threadId === null) return;
  const previous = getPluginThreadRowStatus(threadId);
  let statuses = statusesByThreadId.get(threadId);

  if (status === null) {
    statuses?.delete(owner);
    if (statuses?.size === 0) {
      statusesByThreadId.delete(threadId);
    }
  } else {
    if (!statuses) {
      statuses = new Map();
      statusesByThreadId.set(threadId, statuses);
    }
    statuses.set(owner, { pluginId, status: { ...status } });
  }

  if (getPluginThreadRowStatus(threadId) !== previous) {
    notify(threadId);
  }
}

export function subscribePluginThreadRowStatus(
  threadId: string,
  listener: ThreadRowStatusListener,
): () => void {
  let listeners = listenersByThreadId.get(threadId);
  if (!listeners) {
    listeners = new Set();
    listenersByThreadId.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByThreadId.delete(threadId);
    }
  };
}

export function usePluginThreadRowStatus(
  threadId: string,
): experimental_PluginComposerThreadRowStatus | null {
  const subscribe = useCallback(
    (listener: ThreadRowStatusListener) =>
      subscribePluginThreadRowStatus(threadId, listener),
    [threadId],
  );
  const getSnapshot = useCallback(
    () => getPluginThreadRowStatus(threadId),
    [threadId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function resetPluginThreadRowStatusesForTest(): void {
  statusesByThreadId.clear();
  for (const threadId of listenersByThreadId.keys()) {
    notify(threadId);
  }
}
