// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExperiments } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadTimelineRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { sdk } from "@/lib/sdk";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { makeThreadTimelineResponse } from "@/test/fixtures/thread-responses";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  applyThreadTimelineSignal,
  COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
} from "../cache-owners/thread-timeline-push-owner";
import { systemConfigQueryKey, threadTimelineQueryKey } from "./query-keys";
import { useThreadTimeline } from "./thread-queries";

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

  function seedTimeline(maxSeq: number, timelinePush = true) {
    mockMatchMedia([]);
    const harness = createQueryClientTestHarness();
    setTimelinePush(harness.queryClient, timelinePush);
    harness.queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      makeThreadTimelineResponse({ rows: [firstRow], maxSeq }),
    );
    return harness;
  }

  function deltaSignal(afterSequence: number, maxSeq = 9) {
    return {
      type: "thread-timeline",
      target,
      afterSequence,
      timeline: makeThreadTimelineResponse({
        rows: [],
        maxSeq,
        delta: { upsertRows: [secondRow], rowOrder: ["row-1", "row-2"] },
      }),
    } as const;
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
    applyThreadTimelineSignal(queryClient, deltaSignal(7));
    expect(cachedTimeline(queryClient)).toMatchObject({
      maxSeq: 7,
      rows: [firstRow],
    });
  });

  it("applies a delta at or past its base without fetching", () => {
    for (const cachedSeq of [7, 8]) {
      const { queryClient } = seedTimeline(cachedSeq);
      applyThreadTimelineSignal(queryClient, deltaSignal(7));
      expect(cachedTimeline(queryClient)).toMatchObject({
        maxSeq: 9,
        rows: [firstRow, secondRow],
        delta: undefined,
      });
    }
    expect(sdk.threads.timeline).not.toHaveBeenCalled();
  });

  it("refetches when a push was missed and ignores stale or foreign windows", async () => {
    const { queryClient, wrapper } = seedTimeline(5);
    renderHook(() => useThreadTimeline("thread-1", { staleTime: Infinity }), {
      wrapper,
    });
    applyThreadTimelineSignal(queryClient, {
      ...deltaSignal(7),
      target: {
        ...target,
        segmentLimit: COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
      },
    });
    applyThreadTimelineSignal(queryClient, deltaSignal(3, 5));
    expect(cachedTimeline(queryClient)?.maxSeq).toBe(5);
    expect(sdk.threads.timeline).not.toHaveBeenCalled();

    applyThreadTimelineSignal(queryClient, deltaSignal(7));
    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledWith(
        expect.objectContaining({ afterSequence: "5" }),
      );
    });
  });

  it("keeps a pushed window that lands while an older fetch is in flight", async () => {
    const { queryClient, wrapper } = seedTimeline(7);
    let resolveFetch: (value: ThreadTimelineResponse) => void = () => {};
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
    applyThreadTimelineSignal(queryClient, deltaSignal(7));
    resolveFetch(
      makeThreadTimelineResponse({
        rows: [],
        maxSeq: 8,
        delta: { upsertRows: [] },
      }),
    );
    await refetch;
    await waitFor(() => {
      expect(result.current.data).toMatchObject({
        maxSeq: 9,
        rows: [firstRow, secondRow],
      });
    });
  });
});
