import { useCallback, useSyncExternalStore } from "react";
import type { PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk";
import { createKeyedListeners } from "./keyed-listeners";

type ThreadRowStatusListener = () => void;
type ThreadRowStatusOwner = string | symbol;

const statusesByThreadId = new Map<
  string,
  Map<
    ThreadRowStatusOwner,
    { pluginId: string; status: PluginComposerThreadRowStatus }
  >
>();
const threadRowStatusListeners = createKeyedListeners<string>();
const groupListeners = new Set<ThreadRowStatusListener>();

function notify(threadId: string): void {
  threadRowStatusListeners.notify(threadId);
  for (const listener of [...groupListeners]) {
    listener();
  }
}

export function getPluginThreadRowStatus(
  threadId: string,
): PluginComposerThreadRowStatus | null {
  const statuses = statusesByThreadId.get(threadId);
  if (!statuses || statuses.size === 0) return null;
  return statuses.values().next().value?.status ?? null;
}

function getPluginThreadRowStatusForThreads(
  threads: readonly { id: string }[],
): PluginComposerThreadRowStatus | null {
  for (const thread of threads) {
    const status = getPluginThreadRowStatus(thread.id);
    if (status) return status;
  }
  return null;
}

export function setPluginThreadRowStatus(
  threadId: string | null,
  pluginId: string,
  status: PluginComposerThreadRowStatus | null,
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

export function clearPluginThreadRowStatuses(pluginId: string): void {
  for (const [threadId, statuses] of statusesByThreadId) {
    const previous = getPluginThreadRowStatus(threadId);
    for (const [owner, entry] of statuses) {
      if (entry.pluginId === pluginId) statuses.delete(owner);
    }
    if (statuses.size === 0) statusesByThreadId.delete(threadId);
    if (getPluginThreadRowStatus(threadId) !== previous) notify(threadId);
  }
}

export function clearPluginThreadRowStatusesByOwner(
  owner: ThreadRowStatusOwner,
): void {
  for (const [threadId, statuses] of statusesByThreadId) {
    const previous = getPluginThreadRowStatus(threadId);
    statuses.delete(owner);
    if (statuses.size === 0) statusesByThreadId.delete(threadId);
    if (getPluginThreadRowStatus(threadId) !== previous) notify(threadId);
  }
}

export function subscribePluginThreadRowStatus(
  threadId: string,
  listener: ThreadRowStatusListener,
): () => void {
  return threadRowStatusListeners.subscribe(threadId, listener);
}

function subscribePluginThreadRowStatusGroup(
  listener: ThreadRowStatusListener,
): () => void {
  groupListeners.add(listener);
  return () => groupListeners.delete(listener);
}

export function usePluginThreadRowStatus(
  threadId: string,
): PluginComposerThreadRowStatus | null {
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

export function usePluginThreadRowStatusForThreads(
  threads: readonly { id: string }[],
): PluginComposerThreadRowStatus | null {
  const getSnapshot = useCallback(
    () => getPluginThreadRowStatusForThreads(threads),
    [threads],
  );
  return useSyncExternalStore(
    subscribePluginThreadRowStatusGroup,
    getSnapshot,
    getSnapshot,
  );
}

export function resetPluginThreadRowStatusesForTest(): void {
  statusesByThreadId.clear();
  threadRowStatusListeners.notifyAll();
  for (const listener of [...groupListeners]) {
    listener();
  }
}
