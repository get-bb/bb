import {
  applyTimelineDelta,
  type ThreadTimelineResponse,
} from "@bb/server-contract";

/**
 * Pure timeline-window fetch policy (mirrors `fetchThreadTimeline` in
 * apps/app/src/hooks/queries/thread-queries.ts). Kept free of TanStack and
 * the SDK so the delta merge can be tested against a fake fetcher.
 */

export interface TimelineWindowFetchArgs {
  /** `maxSeq` of the window already held; asks the server for a delta. */
  afterSequence?: string;
  signal?: AbortSignal;
  threadId: string;
}

export type TimelineWindowFetcher = (
  args: TimelineWindowFetchArgs,
) => Promise<ThreadTimelineResponse>;

export interface FetchThreadTimelineWindowArgs {
  fetchTimeline: TimelineWindowFetcher;
  /** The window currently cached for this thread, if any. */
  previous: ThreadTimelineResponse | undefined;
  signal?: AbortSignal;
  threadId: string;
}

/**
 * Resolve a timeline response into the full window to cache. A `delta`
 * response is applied to the window we already hold (preserving unchanged row
 * identity); a full response is returned as-is. Falls back to a full fetch if
 * the delta's base is stale (the server only sends a delta when it can
 * reconstruct our exact window, so this is defensive).
 */
async function mergeThreadTimelineDelta(
  previous: ThreadTimelineResponse | undefined,
  response: ThreadTimelineResponse,
  fetchFull: () => Promise<ThreadTimelineResponse>,
): Promise<ThreadTimelineResponse> {
  if (response.delta === undefined) {
    return response;
  }
  const merged = previous
    ? applyTimelineDelta(previous.rows, response.delta)
    : null;
  if (merged !== null) {
    return { ...response, rows: merged, delta: undefined };
  }
  return fetchFull();
}

/**
 * Ask for a delta against the window we already hold; the server honors it
 * only when it can still reconstruct exactly what we have and otherwise
 * returns the full window.
 */
export async function fetchThreadTimelineWindow({
  fetchTimeline,
  previous,
  signal,
  threadId,
}: FetchThreadTimelineWindowArgs): Promise<ThreadTimelineResponse> {
  const response = await fetchTimeline({
    threadId,
    ...(signal ? { signal } : {}),
    ...(previous?.maxSeq !== undefined
      ? { afterSequence: String(previous.maxSeq) }
      : {}),
  });
  return mergeThreadTimelineDelta(previous, response, () =>
    fetchTimeline({ threadId, ...(signal ? { signal } : {}) }),
  );
}
