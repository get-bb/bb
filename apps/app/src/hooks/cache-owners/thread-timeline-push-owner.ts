import type { QueryClient } from "@tanstack/react-query";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getMediaQuerySnapshot } from "@bb/shared-ui/hooks/use-media-query";
import {
  applyTimelineDelta,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
} from "@bb/server-contract";
import { markStreamTrace } from "@/lib/stream-trace";
import { threadTimelineQueryKey } from "../queries/query-keys";
import { clearThreadTimelineUnseenEvents } from "./thread-timeline-unseen-events";

export const COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT = 8;

export function resolveThreadTimelineSegmentLimit(): number | undefined {
  return getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY)
    ? COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT
    : undefined;
}

function resolvePushedThreadTimeline(
  previous: ThreadTimelineResponse,
  signal: ThreadTimelineSignal,
): ThreadTimelineResponse | null {
  const { afterSequence, timeline } = signal;
  if (timeline.delta === undefined) {
    return timeline;
  }
  if (afterSequence === null || previous.maxSeq < afterSequence) {
    return null;
  }
  const rows = applyTimelineDelta(previous.rows, timeline.delta);
  return rows === null ? null : { ...timeline, rows, delta: undefined };
}

export function applyThreadTimelineSignal(
  queryClient: QueryClient,
  signal: ThreadTimelineSignal,
): void {
  const { target } = signal;
  if (target.segmentLimit !== (resolveThreadTimelineSegmentLimit() ?? null)) {
    return;
  }
  const queryKey = threadTimelineQueryKey(target.threadId);
  const previous = queryClient.getQueryData<ThreadTimelineResponse>(queryKey);
  if (previous === undefined || signal.timeline.maxSeq <= previous.maxSeq) {
    return;
  }
  const timeline = resolvePushedThreadTimeline(previous, signal);
  if (timeline === null) {
    void queryClient
      .refetchQueries(
        { exact: true, queryKey, type: "active" },
        { cancelRefetch: false },
      )
      .catch(() => {});
    return;
  }
  queryClient.setQueryData(queryKey, timeline);
  clearThreadTimelineUnseenEvents(
    queryClient,
    target.threadId,
    timeline.maxSeq,
  );
  markStreamTrace("bb:timeline-applied", {
    threadId: target.threadId,
    maxSeq: timeline.maxSeq,
    source: signal.afterSequence === null ? "push" : "push-delta",
  });
}
