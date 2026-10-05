import type { QueryClient } from "@tanstack/react-query";

const unseenTimelineEventThreadIdsByClient = new WeakMap<
  QueryClient,
  Set<string>
>();

export function markThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
): void {
  let threadIds = unseenTimelineEventThreadIdsByClient.get(queryClient);
  if (!threadIds) {
    threadIds = new Set();
    unseenTimelineEventThreadIdsByClient.set(queryClient, threadIds);
  }
  threadIds.add(threadId);
}

export function clearThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
): void {
  unseenTimelineEventThreadIdsByClient.get(queryClient)?.delete(threadId);
}

export function hasThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  return (
    unseenTimelineEventThreadIdsByClient.get(queryClient)?.has(threadId) ===
    true
  );
}
