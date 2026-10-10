import type { QueryClient } from "@tanstack/react-query";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { threadTimelineQueryKey } from "../queries/query-keys";

const unseenTimelineSequencesByClient = new WeakMap<
  QueryClient,
  Map<string, number>
>();

export function markThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
  sequence: number,
): void {
  let sequences = unseenTimelineSequencesByClient.get(queryClient);
  if (!sequences) {
    sequences = new Map();
    unseenTimelineSequencesByClient.set(queryClient, sequences);
  }
  sequences.set(threadId, Math.max(sequences.get(threadId) ?? 0, sequence));
}

export function clearThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
  loadedSequence: number,
): void {
  const sequences = unseenTimelineSequencesByClient.get(queryClient);
  if (loadedSequence >= (sequences?.get(threadId) ?? 0)) {
    sequences?.delete(threadId);
  }
}

export function hasThreadTimelineUnseenEvents(
  queryClient: QueryClient,
  threadId: string,
): boolean {
  const sequence = unseenTimelineSequencesByClient
    .get(queryClient)
    ?.get(threadId);
  const timeline = queryClient.getQueryData<ThreadTimelineResponse>(
    threadTimelineQueryKey(threadId),
  );
  return sequence !== undefined && sequence > (timeline?.maxSeq ?? 0);
}
