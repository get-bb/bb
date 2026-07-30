// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import * as api from "@/lib/api";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import {
  threadHostFilePreviewQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "./query-keys";
import {
  useArchivedThreads,
  useThreadHostFilePreview,
  useThreadQueuedMessages,
  useThreadTimeline,
} from "./thread-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getThreadHostFilePreview: vi.fn(),
  };
});

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      list: vi.fn(),
      queuedMessages: { list: vi.fn() },
      timeline: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useThreadDetailRealtimeSubscription: vi.fn(),
  useThreadListRealtimeSubscription: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(sdk.threads.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.queuedMessages.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.timeline).mockResolvedValue(makeTimelineResponse());
  vi.mocked(api.getThreadHostFilePreview).mockResolvedValue({
    kind: "text",
    path: "/tmp/log.txt",
    url: "/api/v1/threads/thread-1/host-files/content?path=%2Ftmp%2Flog.txt",
    mimeType: "text/plain",
    content: "preview",
  });
});

function makeTimelineResponse(maxSeq = 0): ThreadTimelineResponse {
  return {
    activeBackgroundCommands: [],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    goal: null,
    maxSeq,
    modelFallback: null,
    pendingTodos: null,
    rows: [],
    timelinePage: {
      hasOlderRows: false,
      kind: "latest",
      olderCursor: null,
      returnedSegmentCount: 0,
      segmentLimit: 8,
    },
  };
}

describe("useArchivedThreads", () => {
  it("loads archived threads across all projects when no scope is selected", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({}), { wrapper });

    await waitFor(() => {
      expect(sdk.threads.list).toHaveBeenCalled();
    });
    expect(vi.mocked(sdk.threads.list).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      signal: expect.any(AbortSignal),
    });
  });

  it("maps the archived kind filter to the parent-thread query", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ kind: "child" }), { wrapper });

    await waitFor(() => {
      expect(sdk.threads.list).toHaveBeenCalled();
    });
    expect(vi.mocked(sdk.threads.list).mock.calls[0]?.[0]).toEqual({
      archived: true,
      hasParent: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps project scope for project archived lists", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useArchivedThreads({ projectId: "proj_1" }), {
      wrapper,
    });

    await waitFor(() => {
      expect(sdk.threads.list).toHaveBeenCalled();
    });
    expect(vi.mocked(sdk.threads.list).mock.calls[0]?.[0]).toEqual({
      archived: true,
      limit: ARCHIVED_THREADS_PAGE_SIZE,
      offset: 0,
      projectId: "proj_1",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("useThreadQueuedMessages", () => {
  it("refetches stale queue data on window focus", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(() => useThreadQueuedMessages("thread-1"), { wrapper });

    await waitFor(() => {
      expect(sdk.threads.queuedMessages.list).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadQueuedMessagesQueryKey("thread-1"),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});

describe("useThreadTimeline", () => {
  it("bounds the initial app timeline window", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useThreadTimeline("thread-1"), { wrapper });

    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[0]?.[0]).toEqual({
      segmentLimit: "8",
      signal: expect.any(AbortSignal),
      threadId: "thread-1",
    });
  });

  it("keeps the app window bound when a stale delta needs a full fetch", async () => {
    const previous = makeTimelineResponse(5);
    const staleDelta = {
      ...makeTimelineResponse(6),
      delta: { rowOrder: ["missing-row"], upsertRows: [] },
    };
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(staleDelta)
      .mockResolvedValueOnce(makeTimelineResponse(6));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(threadTimelineQueryKey("thread-1"), previous, {
      updatedAt: 1,
    });

    renderHook(() => useThreadTimeline("thread-1"), { wrapper });

    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls).toEqual([
      [
        {
          afterSequence: "5",
          segmentLimit: "8",
          signal: expect.any(AbortSignal),
          threadId: "thread-1",
        },
      ],
      [
        {
          segmentLimit: "8",
          signal: expect.any(AbortSignal),
          threadId: "thread-1",
        },
      ],
    ]);
  });
});

describe("useThreadHostFilePreview", () => {
  it("refetches stale host file previews on focus and reconnect", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useThreadHostFilePreview("thread-1", "env-1", "/tmp/log.txt"),
      { wrapper },
    );

    await waitFor(() => {
      expect(api.getThreadHostFilePreview).toHaveBeenCalledTimes(1);
    });

    const query = queryClient.getQueryCache().find({
      queryKey: threadHostFilePreviewQueryKey(
        "thread-1",
        "env-1",
        "/tmp/log.txt",
      ),
    });

    expect(query?.options).toEqual(
      expect.objectContaining({
        refetchOnReconnect: true,
        refetchOnWindowFocus: true,
      }),
    );
  });
});
