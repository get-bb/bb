import type { QueryClient } from "@tanstack/react-query";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { threadTimelineQueryKey } from "../queries/query-keys";

interface UnseenTimelineEvents {
  listenersByThreadId: Map<string, Set<() => void>>;
  sequencesByThreadId: Map<string, number>;
}

const unseenTimelineEventsByClient = new WeakMap<
  QueryClient,
  UnseenTimelineEvents
>();

function unseenTimelineEvents(queryClient: QueryClient): UnseenTimelineEvents {
  let state = unseenTimelineEventsByClient.get(queryClient);
  if (!state) {
    state = { listenersByThreadId: new Map(), sequencesByThreadId: new Map() };
    unseenTimelineEventsByClient.set(queryClient, state);
  }
  return state;
}

function notifyUnseenTimelineEventListeners(
  state: UnseenTimelineEvents,
  threadId: string,
): void {
  for (const listener of state.listenersByThreadId.get(threadId) ?? []) {
    listener();
  }
}

export function markThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
  sequence: number,
): void {
  const state = unseenTimelineEvents(queryClient);
  const previous = state.sequencesByThreadId.get(threadId) ?? 0;
  if (sequence <= previous) {
    return;
  }
  state.sequencesByThreadId.set(threadId, sequence);
  notifyUnseenTimelineEventListeners(state, threadId);
}

export function clearThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
  loadedSequence: number,
): void {
  const state = unseenTimelineEventsByClient.get(queryClient);
  const sequence = state?.sequencesByThreadId.get(threadId);
  if (state === undefined || sequence === undefined) {
    return;
  }
  if (loadedSequence >= sequence) {
    state.sequencesByThreadId.delete(threadId);
    notifyUnseenTimelineEventListeners(state, threadId);
  }
}

export function subscribeThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
  listener: () => void,
): () => void {
  const { listenersByThreadId } = unseenTimelineEvents(queryClient);
  let listeners = listenersByThreadId.get(threadId);
  if (!listeners) {
    listeners = new Set();
    listenersByThreadId.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (
      listeners.size === 0 &&
      listenersByThreadId.get(threadId) === listeners
    ) {
      listenersByThreadId.delete(threadId);
    }
  };
}

export function hasThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const sequence = unseenTimelineEventsByClient
    .get(queryClient)
    ?.sequencesByThreadId.get(threadId);
  const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
    threadTimelineQueryKey(threadId),
  );
  return sequence !== undefined && sequence > (timeline?.maxSeq ?? 0);
}
