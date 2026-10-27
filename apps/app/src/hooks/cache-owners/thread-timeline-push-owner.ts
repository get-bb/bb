import type { QueryClient } from "@tanstack/react-query";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getMediaQuerySnapshot } from "@bb/shared-ui/hooks/use-media-query";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  type ReceivedThreadTimelineSignal,
  type SystemConfigResponse,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import { markStreamTrace } from "@/lib/stream-trace";
import { wsManager } from "@/lib/ws";
import {
  systemConfigQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";
import { clearThreadTimelineUnseenEvents } from "./thread-timeline-unseen-events";

export const COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT = 8;

export function resolveThreadTimelineSegmentLimit(): number | undefined {
  return getMediaQuerySnapshot(COMPACT_VIEWPORT_QUERY)
    ? COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT
    : undefined;
}

export function isThreadTimelinePushEnabled(
  config: SystemConfigResponse | undefined,
): boolean {
  return config?.experiments.timelinePush === true;
}

export function isCachedThreadTimelinePushEnabled(
  queryClient: QueryClient,
): boolean {
  return isThreadTimelinePushEnabled(
    queryClient.getQueryData<SystemConfigResponse>(systemConfigQueryKey()),
  );
}

export function syncThreadTimelineSubscriptionTag(
  queryClient: QueryClient,
  threadId: string,
  tag: string,
): void {
  if (!isCachedThreadTimelinePushEnabled(queryClient)) {
    return;
  }
  wsManager.syncThreadTimelineTag(
    {
      kind: "thread-timeline",
      threadId,
      segmentLimit: resolveThreadTimelineSegmentLimit() ?? null,
      deferContent: true,
    },
    tag,
  );
}

export function trackHeldThreadTimelineTags(
  queryClient: QueryClient,
): () => void {
  return wsManager.setHeldThreadTimelineTagSource(
    (target) =>
      queryClient.getQueryData<ThreadTimelineResponse>(
        threadTimelineQueryKey(target.threadId),
      )?.tag ?? null,
  );
}

type PushedThreadTimeline =
  | { kind: "apply"; timeline: ThreadTimelineResponse }
  | { kind: "ignore" }
  | { kind: "refetch" };

function resolvePushedThreadTimeline(
  previous: ThreadTimelineResponse,
  timeline: ThreadTimelineReadResponse | null,
): PushedThreadTimeline {
  if (timeline === null) {
    return { kind: "refetch" };
  }
  if (!isThreadTimelineDelta(timeline)) {
    return timeline.maxSeq > previous.maxSeq
      ? { kind: "apply", timeline }
      : { kind: "ignore" };
  }
  const applied = applyThreadTimelineDelta(previous, timeline);
  if (applied !== null) {
    return { kind: "apply", timeline: applied };
  }
  return timeline.maxSeq > previous.maxSeq
    ? { kind: "refetch" }
    : { kind: "ignore" };
}

export function applyThreadTimelineSignal(
  queryClient: QueryClient,
  signal: ReceivedThreadTimelineSignal,
): void {
  const { target } = signal;
  if (
    !isCachedThreadTimelinePushEnabled(queryClient) ||
    target.segmentLimit !== (resolveThreadTimelineSegmentLimit() ?? null)
  ) {
    return;
  }
  const queryKey = threadTimelineQueryKey(target.threadId);
  const previous = queryClient.getQueryData<ThreadTimelineResponse>(queryKey);
  if (previous === undefined) {
    return;
  }
  const resolved = resolvePushedThreadTimeline(previous, signal.timeline);
  if (resolved.kind === "ignore") {
    return;
  }
  if (resolved.kind === "refetch") {
    void queryClient
      .refetchQueries(
        { exact: true, queryKey, type: "active" },
        { cancelRefetch: false },
      )
      .catch(() => {});
    return;
  }
  const { timeline } = resolved;
  queryClient.setQueryData(queryKey, timeline);
  clearThreadTimelineUnseenEvents(
    queryClient,
    target.threadId,
    timeline.maxSeq,
  );
  markStreamTrace("bb:timeline-applied", {
    threadId: target.threadId,
    maxSeq: timeline.maxSeq,
    source:
      signal.timeline !== null && isThreadTimelineDelta(signal.timeline)
        ? "push-delta"
        : "push",
  });
}
