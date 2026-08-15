// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import {
  threadDetailBootstrapQueryKey,
  threadHostFilePreviewQueryKey,
  threadQueuedMessagesQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "./query-keys";
import {
  didThreadDetailBootstrapRefreshAfterMount,
  useArchivedThreads,
  useThread,
  useThreadDetailBootstrap,
  useThreadHostFilePreview,
  useThreadQueuedMessages,
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
      get: vi.fn(),
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

const THREAD_WITH_INCLUDES = {
  id: "thread-1",
  projectId: "project-1",
  environmentId: null,
  providerId: "codex",
  title: "Thread",
  titleFallback: "Thread",
  sectionId: null,
  status: "idle",
  parentThreadId: null,
  sourceThreadId: null,
  originKind: null,
  originPluginId: null,
  visibility: "visible",
  archivedAt: null,
  pinnedAt: null,
  deletedAt: null,
  lastReadAt: null,
  latestAttentionAt: 1,
  createdAt: 1,
  updatedAt: 1,
  runtime: {
    displayStatus: "idle",
    hostReconnectGraceExpiresAt: null,
  },
  activeBackgroundAgentCount: 0,
  canSpawnChild: true,
  environment: null,
  host: null,
} satisfies ThreadWithIncludesResponse;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(sdk.threads.get).mockResolvedValue(THREAD_WITH_INCLUDES);
  vi.mocked(sdk.threads.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.queuedMessages.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.timeline).mockResolvedValue({
    rows: [],
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 100,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
    maxSeq: 0,
  } satisfies ThreadTimelineResponse);
  vi.mocked(api.getThreadHostFilePreview).mockResolvedValue({
    kind: "text",
    path: "/tmp/log.txt",
    url: "/api/v1/threads/thread-1/host-files/content?path=%2Ftmp%2Flog.txt",
    mimeType: "text/plain",
    content: "preview",
  });
});

describe("useThreadDetailBootstrap", () => {
  it("starts the timeline request before the thread bootstrap settles", async () => {
    let resolveThread:
      | ((thread: ThreadWithIncludesResponse) => void)
      | undefined;
    const threadPromise = new Promise<ThreadWithIncludesResponse>((resolve) => {
      resolveThread = resolve;
    });
    vi.mocked(sdk.threads.get).mockReturnValue(threadPromise);
    const { wrapper } = createQueryClientTestHarness();

    const result = renderHook(
      () =>
        useThreadDetailBootstrap("thread-1", {
          timelinePrefetch: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.threads.get).toHaveBeenCalledTimes(1);
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    });
    expect(result.result.current.isPending).toBe(true);

    resolveThread?.(THREAD_WITH_INCLUDES);
    await waitFor(() => {
      expect(result.result.current.isSuccess).toBe(true);
    });
  });

  it("uses the cached timeline sequence and merges a prefetched delta", async () => {
    const previousTimeline = {
      rows: [
        {
          id: "row-1",
          kind: "system",
          threadId: "thread-1",
          turnId: null,
          sourceSeqStart: 7,
          sourceSeqEnd: 7,
          startedAt: 1,
          createdAt: 1,
          systemKind: "debug",
          title: "Existing row",
          detail: null,
          status: null,
        },
      ],
      activePromptMode: null,
      activeThinking: null,
      activeWorkflows: [],
      activeBackgroundCommands: [],
      pendingTodos: null,
      goal: null,
      modelFallback: null,
      timelinePage: {
        kind: "latest",
        segmentLimit: 100,
        returnedSegmentCount: 1,
        hasOlderRows: false,
        olderCursor: null,
      },
      maxSeq: 7,
    } satisfies ThreadTimelineResponse;
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce({
      ...previousTimeline,
      rows: [],
      maxSeq: 8,
      delta: { upsertRows: [] },
    });
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      previousTimeline,
      { updatedAt: 1 },
    );

    renderHook(
      () =>
        useThreadDetailBootstrap("thread-1", {
          timelinePrefetch: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledWith({
        afterSequence: "7",
        signal: expect.any(AbortSignal),
        threadId: "thread-1",
      });
    });
    await waitFor(() => {
      expect(
        queryClient.getQueryData<ThreadTimelineResponse>(
          threadTimelineQueryKey("thread-1"),
        ),
      ).toEqual({
        ...previousTimeline,
        maxSeq: 8,
      });
    });
  });

  it("only suppresses a thread refetch for a bootstrap fetched after mount", () => {
    expect(
      didThreadDetailBootstrapRefreshAfterMount({
        dataUpdatedAt: 0,
        isFetchedAfterMount: false,
        isSuccess: true,
      }),
    ).toBe(false);
    expect(
      didThreadDetailBootstrapRefreshAfterMount({
        dataUpdatedAt: 0,
        isFetchedAfterMount: true,
        isSuccess: true,
      }),
    ).toBe(true);
  });

  it("skips the duplicate thread read for a freshly cached bootstrap", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const updatedAt = Date.now();
    queryClient.setQueryData(
      threadDetailBootstrapQueryKey("thread-1"),
      THREAD_WITH_INCLUDES,
      { updatedAt },
    );
    queryClient.setQueryData(threadQueryKey("thread-1"), THREAD_WITH_INCLUDES, {
      updatedAt,
    });

    const result = renderHook(
      () => {
        const bootstrap = useThreadDetailBootstrap("thread-1");
        return useThread("thread-1", {
          enabled: bootstrap.isSuccess,
          refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(bootstrap)
            ? false
            : "always",
        });
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(result.result.current.isSuccess).toBe(true);
    });
    expect(sdk.threads.get).not.toHaveBeenCalled();
  });

  it("refreshes the thread read for an old cached bootstrap", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadDetailBootstrapQueryKey("thread-1"),
      THREAD_WITH_INCLUDES,
      { updatedAt: 1 },
    );
    queryClient.setQueryData(threadQueryKey("thread-1"), THREAD_WITH_INCLUDES, {
      updatedAt: 1,
    });

    renderHook(
      () => {
        const bootstrap = useThreadDetailBootstrap("thread-1");
        return useThread("thread-1", {
          enabled: bootstrap.isSuccess,
          refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(bootstrap)
            ? false
            : "always",
        });
      },
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.threads.get).toHaveBeenCalledTimes(1);
    });
    expect(sdk.threads.get).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      threadId: "thread-1",
    });
  });
});

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
