import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadTimelineResponse,
  TimelineDeltaMessage,
  TimelineRow,
} from "@bb/server-contract";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { createAppQueryClient } from "@/lib/query-client";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { threadTimelineQueryKey } from "../queries/query-keys";
import {
  createTimelinePushCacheOwner,
  isThreadTimelineCaughtUpByPush,
  recordThreadTimelineChange,
  trackedTimelineReceiptThreadIdsForTest,
} from "./timeline-push-cache-owner";

const TIMELINE_KEY = threadTimelineQueryKey("thr_1");

function row(id: string, title: string, seq: number): TimelineRow {
  return {
    id,
    kind: "system",
    threadId: "thr_1",
    turnId: null,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: 1,
    createdAt: 1,
    systemKind: "debug",
    title,
    detail: null,
    status: null,
  };
}

function push(
  fromMaxSeq: number,
  maxSeq: number,
  upsertRows: TimelineRow[],
  rowOrder?: string[],
): TimelineDeltaMessage {
  return {
    type: "timeline-delta",
    threadId: "thr_1",
    segmentLimit: null,
    fromMaxSeq,
    body: {
      ...makeThreadTimelineResponse({ maxSeq }),
      delta: rowOrder === undefined ? { upsertRows } : { upsertRows, rowOrder },
    },
  };
}

function createOwner() {
  const queryClient = createAppQueryClient({
    defaultOptions: { queries: { gcTime: Infinity, retry: false } },
    showMutationErrorToasts: false,
  });
  const frames: Array<() => void> = [];
  const owner = createTimelinePushCacheOwner({
    queryClient,
    scheduleFrame: (callback) => {
      frames.push(callback);
      return () => {
        frames.splice(frames.indexOf(callback), 1);
      };
    },
  });
  const runFrame = () => {
    for (const callback of frames.splice(0)) {
      callback();
    }
  };
  queryClient.setQueryData<ThreadTimelineResponse>(
    TIMELINE_KEY,
    makeThreadTimelineResponse({ maxSeq: 3, rows: [row("a", "first", 3)] }),
  );
  const cachedTimeline = () =>
    queryClient.getQueryData<ThreadTimelineResponse>(TIMELINE_KEY);
  return { cachedTimeline, frames, owner, queryClient, runFrame };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createTimelinePushCacheOwner", () => {
  it("applies chained pushes from one frame in arrival order", () => {
    const { cachedTimeline, frames, owner, runFrame } = createOwner();

    owner.handleTimelineDelta(push(3, 4, [row("a", "first edit", 4)]));
    owner.handleTimelineDelta(push(4, 5, [row("b", "second", 5)], ["a", "b"]));
    expect(frames).toHaveLength(1);
    expect(cachedTimeline()?.maxSeq).toBe(3);

    runFrame();

    expect(cachedTimeline()?.maxSeq).toBe(5);
    expect(cachedTimeline()?.rows.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(cachedTimeline()?.delta).toBeUndefined();
  });

  it("ignores a push that does not continue from the cached sequence", () => {
    const { cachedTimeline, owner, queryClient, runFrame } = createOwner();
    const before = cachedTimeline();

    owner.handleTimelineDelta(push(2, 4, [row("a", "stale", 4)]));
    runFrame();

    expect(cachedTimeline()).toBe(before);
    recordThreadTimelineChange(queryClient, "thr_1");
    expect(isThreadTimelineCaughtUpByPush(queryClient, "thr_1")).toBe(false);
  });

  it("ignores a push for another window size", () => {
    vi.stubGlobal("window", {
      matchMedia: (query: string) => ({
        matches: query === COMPACT_VIEWPORT_QUERY,
      }),
    });
    const { cachedTimeline, owner, runFrame } = createOwner();
    const before = cachedTimeline();

    owner.handleTimelineDelta(push(3, 4, [row("a", "wide", 4)]));
    runFrame();

    expect(cachedTimeline()).toBe(before);
  });

  it("reports a thread caught up only while an applied push is newer than its last change", () => {
    const { owner, queryClient, runFrame } = createOwner();

    recordThreadTimelineChange(queryClient, "thr_1");
    owner.handleTimelineDelta(push(3, 4, [row("a", "edit", 4)]));
    expect(isThreadTimelineCaughtUpByPush(queryClient, "thr_1")).toBe(false);
    runFrame();
    expect(isThreadTimelineCaughtUpByPush(queryClient, "thr_1")).toBe(true);

    recordThreadTimelineChange(queryClient, "thr_1");
    expect(isThreadTimelineCaughtUpByPush(queryClient, "thr_1")).toBe(false);
  });

  it("tracks receipts only for threads with a cached timeline", () => {
    const { owner, queryClient, runFrame } = createOwner();
    recordThreadTimelineChange(queryClient, "thr_never_opened");
    owner.handleTimelineDelta(push(3, 4, [row("a", "edit", 4)]));
    runFrame();
    expect(trackedTimelineReceiptThreadIdsForTest(queryClient)).toEqual([
      "thr_1",
    ]);

    queryClient.removeQueries({ queryKey: TIMELINE_KEY });
    recordThreadTimelineChange(queryClient, "thr_1");
    expect(trackedTimelineReceiptThreadIdsForTest(queryClient)).toEqual([]);
  });

});
