// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExperiments } from "@bb/domain";
import type {
  ReceivedThreadTimelineSignal,
  ThreadTimelineReadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadTimelineRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  applyThreadTimelineSignal,
  COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
} from "../cache-owners/thread-timeline-push-owner";
import { systemConfigQueryKey, threadTimelineQueryKey } from "./query-keys";
import { useThreadTimeline } from "./thread-panel-queries";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      timeline: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadTimelineRealtimeSubscription: vi.fn(),
}));

function mockMatchMedia(matching: readonly string[]) {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: matching.includes(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  vi.mocked(sdk.threads.timeline).mockResolvedValue(
    makeThreadTimelineResponse({}),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("pushed thread timeline", () => {
  const firstRow = {
    id: "row-1",
    kind: "system",
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: 7,
    sourceSeqEnd: 7,
    startedAt: 1,
    createdAt: 1,
    systemKind: "debug",
    title: "First row",
    detail: null,
    status: null,
  } satisfies ThreadTimelineResponse["rows"][number];
  const secondRow = {
    ...firstRow,
    id: "row-2",
    sourceSeqStart: 9,
    sourceSeqEnd: 9,
    title: "Second row",
  } satisfies ThreadTimelineResponse["rows"][number];
  const target = {
    kind: "thread-timeline",
    threadId: "thread-1",
    segmentLimit: null,
    deferContent: true,
  } as const;

  function setTimelinePush(
    queryClient: ReturnType<typeof createQueryClientTestHarness>["queryClient"],
    timelinePush: boolean,
  ) {
    queryClient.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({
        experiments: { ...defaultExperiments, timelinePush },
      }),
    );
  }

  function seedTimeline(
    maxSeq: number,
    timelinePush = true,
    tag = `timeline-${maxSeq}`,
  ) {
    mockMatchMedia([]);
    const harness = createQueryClientTestHarness();
    setTimelinePush(harness.queryClient, timelinePush);
    harness.queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeThreadTimelineResponse({ rows: [firstRow], maxSeq, tag }),
    );
    return harness;
  }

  function deltaSignal(
    afterTag: string,
    maxSeq = 9,
  ): ReceivedThreadTimelineSignal {
    return {
      type: "thread-timeline",
      target,
      timeline: {
        maxSeq,
        tag: `timeline-${maxSeq}`,
        delta: {
          afterTag,
          upsertRows: [secondRow],
          rowOrder: [[0, 1], "row-2"],
          fields: {},
        },
      },
    };
  }

  function cachedTimeline(
    queryClient: ReturnType<typeof createQueryClientTestHarness>["queryClient"],
  ) {
    return queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey("thread-1"),
    );
  }

  it("subscribes to the window the query fetches", () => {
    mockMatchMedia([COMPACT_VIEWPORT_QUERY]);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    setTimelinePush(queryClient, true);
    renderHook(() => useThreadTimeline("thread-1"), { wrapper });
    expect(useThreadTimelineRealtimeSubscription).toHaveBeenCalledWith(
      "thread-1",
      {
        deferContent: true,
        enabled: true,
        segmentLimit: COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
      },
    );
  });

  it("neither subscribes nor applies pushes while the experiment is off", () => {
    const { queryClient, wrapper } = seedTimeline(7, false);
    renderHook(() => useThreadTimeline("thread-1", { staleTime: Infinity }), {
      wrapper,
    });
    expect(useThreadTimelineRealtimeSubscription).toHaveBeenLastCalledWith(
      "thread-1",
      { deferContent: true, enabled: false, segmentLimit: null },
    );
    applyThreadTimelineSignal(queryClient, deltaSignal("timeline-7"));
    expect(cachedTimeline(queryClient)).toMatchObject({
      maxSeq: 7,
      rows: [firstRow],
    });
  });

  it("applies a delta built on the held window without fetching", () => {
    const { queryClient } = seedTimeline(7);
    applyThreadTimelineSignal(queryClient, deltaSignal("timeline-7"));
    expect(cachedTimeline(queryClient)).toEqual(
      makeThreadTimelineResponse({ rows: [firstRow, secondRow], maxSeq: 9 }),
    );
    expect(sdk.threads.timeline).not.toHaveBeenCalled();
  });

  it("refetches from its own tag when a delta was built on another window", async () => {
    for (const held of [
      { maxSeq: 8, tag: "timeline-8" },
      { maxSeq: 7, tag: "idle-built-7" },
    ]) {
      const { queryClient, wrapper } = seedTimeline(
        held.maxSeq,
        true,
        held.tag,
      );
      renderHook(() => useThreadTimeline("thread-1", { staleTime: Infinity }), {
        wrapper,
      });
      applyThreadTimelineSignal(queryClient, deltaSignal("timeline-7"));
      expect(cachedTimeline(queryClient)).toMatchObject({
        maxSeq: held.maxSeq,
        rows: [firstRow],
      });
      await waitFor(() => {
        expect(sdk.threads.timeline).toHaveBeenCalledWith(
          expect.objectContaining({ afterTag: held.tag }),
        );
      });
      cleanup();
      vi.mocked(sdk.threads.timeline).mockClear();
    }
  });

  it("refetches missed or unreadable pushes and ignores stale or foreign windows", async () => {
    const { queryClient, wrapper } = seedTimeline(5);
    renderHook(() => useThreadTimeline("thread-1", { staleTime: Infinity }), {
      wrapper,
    });
    applyThreadTimelineSignal(queryClient, {
      ...deltaSignal("timeline-5"),
      target: {
        ...target,
        segmentLimit: COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
      },
    });
    applyThreadTimelineSignal(queryClient, deltaSignal("timeline-3", 5));
    applyThreadTimelineSignal(queryClient, {
      type: "thread-timeline",
      target,
      timeline: makeThreadTimelineResponse({ maxSeq: 4 }),
    });
    expect(cachedTimeline(queryClient)).toMatchObject({
      maxSeq: 5,
      rows: [firstRow],
    });
    expect(sdk.threads.timeline).not.toHaveBeenCalled();

    applyThreadTimelineSignal(queryClient, {
      type: "thread-timeline",
      target,
      timeline: null,
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledWith(
        expect.objectContaining({ afterTag: "timeline-5" }),
      );
    });
  });

  it("reports each fetched window's tag to the timeline subscription", async () => {
    const sync = vi.spyOn(wsManager, "syncThreadTimelineTag");
    const { queryClient, wrapper } = seedTimeline(7);
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce({
      maxSeq: 8,
      tag: "timeline-8",
      delta: { afterTag: "timeline-7", upsertRows: [], fields: {} },
    });
    renderHook(() => useThreadTimeline("thread-1", { staleTime: Infinity }), {
      wrapper,
    });
    await queryClient.refetchQueries({
      queryKey: threadTimelineQueryKey("thread-1"),
    });
    expect(sync).toHaveBeenLastCalledWith(target, "timeline-8");
  });

  it("keeps a pushed window that lands while an older fetch is in flight", async () => {
    const { queryClient, wrapper } = seedTimeline(7);
    let resolveFetch: (value: ThreadTimelineReadResponse) => void = () => {};
    vi.mocked(sdk.threads.timeline).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { result } = renderHook(
      () => useThreadTimeline("thread-1", { staleTime: Infinity }),
      { wrapper },
    );
    const refetch = queryClient.refetchQueries({
      queryKey: threadTimelineQueryKey("thread-1"),
    });
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    });
    applyThreadTimelineSignal(queryClient, deltaSignal("timeline-7"));
    resolveFetch({
      maxSeq: 8,
      tag: "timeline-8",
      delta: { afterTag: "timeline-7", upsertRows: [], fields: {} },
    });
    await refetch;
    await waitFor(() => {
      expect(result.current.data).toMatchObject({
        maxSeq: 9,
        rows: [firstRow, secondRow],
      });
    });
  });
});
