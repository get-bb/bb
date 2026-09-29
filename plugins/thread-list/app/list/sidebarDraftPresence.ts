import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { useSidebarThreadDraftIds } from "@get-bb/plugin-sdk/app";

const NO_DRAFT_THREAD_IDS: ReadonlySet<string> = new Set();
export const NO_THREAD_IDS: readonly string[] = [];

let publishedDraftThreadIds: ReadonlySet<string> = NO_DRAFT_THREAD_IDS;
let mountedSyncCount = 0;
const listeners = new Set<() => void>();

function publishDraftThreadIds(draftThreadIds: ReadonlySet<string>): void {
  if (publishedDraftThreadIds === draftThreadIds) return;
  publishedDraftThreadIds = draftThreadIds;
  for (const listener of listeners) {
    listener();
  }
}

function subscribeDraftThreadIds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function SidebarDraftPresenceSync(): null {
  const draftThreadIds = useSidebarThreadDraftIds();
  useLayoutEffect(() => {
    publishDraftThreadIds(draftThreadIds);
  }, [draftThreadIds]);
  useLayoutEffect(() => {
    mountedSyncCount += 1;
    return () => {
      mountedSyncCount -= 1;
      if (mountedSyncCount === 0) {
        publishDraftThreadIds(NO_DRAFT_THREAD_IDS);
      }
    };
  }, []);
  return null;
}

export function useThreadsHaveDraft(threadIds: readonly string[]): boolean {
  const getSnapshot = useCallback(
    () => threadIds.some((threadId) => publishedDraftThreadIds.has(threadId)),
    [threadIds],
  );
  return useSyncExternalStore(subscribeDraftThreadIds, getSnapshot, () => false);
}
