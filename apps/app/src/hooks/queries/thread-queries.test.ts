import {
  InfiniteQueryObserver,
  QueryObserver,
  type QueryClient,
  type QueryKey,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingInteraction, ThreadListEntry } from "@bb/domain";
import type {
  SidebarBootstrapResponse,
  ThreadListResponse,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import * as api from "@/lib/api";
import { sdk } from "@/lib/sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ARCHIVED_THREADS_PAGE_SIZE } from "./archived-threads-page-size";
import {
  sidebarNavigationQueryKey,
  threadDetailBootstrapQueryKey,
  threadHostFilePreviewQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueuedMessagesQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "./query-keys";
import { paletteRecentArchivedThreadsQueryOptions } from "./palette-thread-queries";
import {
  sidebarNavigationThreadSelectionQueryOptions,
  toSidebarNavigationThreadSelection,
} from "./sidebar-navigation-query";
import {
  archivedThreadsQueryOptions,
  childThreadsFallbackQueryOptions,
  COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT,
  didThreadDetailBootstrapRefreshAfterMount,
  resolveSidebarDerivedThreadList,
  selectChildThreads,
  selectThreadMentionCandidates,
  shouldFetchSidebarThreadListFallback,
  threadDetailBootstrapQueryOptions,
  threadHostFilePreviewQueryOptions,
  threadMentionCandidatesFallbackQueryOptions,
  threadPendingInteractionsQueryOptions,
  threadQueryOptions,
  threadQueuedMessagesQueryOptions,
  threadStorageLocationQueryOptions,
  threadTimelineQueryOptions,
} from "./thread-queries";
import {
  COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS,
  THREAD_OPEN_CACHE_GC_MS,
  THREAD_OPEN_CACHE_MAX_THREADS,
  touchThreadOpenCache,
} from "../cache-owners/thread-open-cache-owner";
import { removeThreadScopedQueries } from "../cache-owners/mutation-cache-effects";
import { listSidebarNavigationThreads } from "../cache-owners/query-cache";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";

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
      search: vi.fn(),
      queuedMessages: { list: vi.fn() },
      interactions: { list: vi.fn() },
      storageLocation: vi.fn(),
      timeline: vi.fn(),
    },
  },
}));

const THREAD_WITH_INCLUDES = {
  ...makeThreadResponse({
    id: "thread-1",
    projectId: "project-1",
    environmentId: null,
    title: "Thread",
    titleFallback: "Thread",
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }),
  environment: null,
  host: null,
} satisfies ThreadWithIncludesResponse;

function makeSidebarNavigation(
  projectThreads: ThreadListEntry[],
  personalThreads: ThreadListEntry[] = [],
): SidebarBootstrapResponse {
  return makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({
        id: "project-1",
        name: "Project",
        createdAt: 1,
        updatedAt: 1,
        threads: projectThreads,
      }),
    ],
    personalProject: makeProjectWithThreadsResponse({
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
      createdAt: 1,
      updatedAt: 1,
      threads: personalThreads,
    }),
  });
}

const unsubscribes: Array<() => void> = [];

function observe<TQueryFnData, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: QueryObserverOptions<
    TQueryFnData,
    Error,
    TData,
    TQueryFnData,
    TQueryKey
  >,
): QueryObserver<TQueryFnData, Error, TData, TQueryFnData, TQueryKey> {
  const observer = new QueryObserver(queryClient, options);
  unsubscribes.push(observer.subscribe(() => {}));
  return observer;
}

function stopObserving(): void {
  for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
}

function stubMatchMedia(matching: readonly string[]) {
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({ matches: matching.includes(query) }),
  });
}

function observeThreadTimeline(queryClient: QueryClient, threadId: string) {
  touchThreadOpenCache(queryClient, threadId);
  return observe(
    queryClient,
    threadTimelineQueryOptions(queryClient, threadId),
  );
}

function observeSidebarDerivedThreadList(
  queryClient: QueryClient,
  selectThreads: (threads: ThreadListEntry[]) => ThreadListResponse,
  fallbackOptions: (
    shouldFetch: boolean,
  ) => QueryObserverOptions<
    ThreadListResponse,
    Error,
    ThreadListResponse,
    ThreadListResponse,
    QueryKey
  >,
) {
  const enabled = true;
  const selection = observe(
    queryClient,
    sidebarNavigationThreadSelectionQueryOptions(
      (navigation: SidebarBootstrapResponse) =>
        selectThreads(listSidebarNavigationThreads(navigation)),
    ),
  );
  let fallback: QueryObserver<ThreadListResponse> | undefined;
  return () => {
    const sidebar = toSidebarNavigationThreadSelection(
      selection.getCurrentResult(),
    );
    const options = fallbackOptions(
      shouldFetchSidebarThreadListFallback({ enabled, sidebar }),
    );
    if (fallback === undefined) {
      fallback = observe(queryClient, options);
    } else {
      fallback.setOptions(options);
    }
    return resolveSidebarDerivedThreadList({
      enabled,
      sidebar,
      fallback: fallback.getCurrentResult(),
    });
  };
}

function observeChildThreads(queryClient: QueryClient, parentThreadId: string) {
  return observeSidebarDerivedThreadList(
    queryClient,
    (threads) => selectChildThreads(threads, parentThreadId),
    (shouldFetch) =>
      childThreadsFallbackQueryOptions({ parentThreadId, shouldFetch }),
  );
}

function observeThreadMentionCandidates(queryClient: QueryClient) {
  return observeSidebarDerivedThreadList(
    queryClient,
    selectThreadMentionCandidates,
    (shouldFetch) =>
      threadMentionCandidatesFallbackQueryOptions({ queryClient, shouldFetch }),
  );
}

function observeBootstrapGatedThread(queryClient: QueryClient) {
  const bootstrap = observe(
    queryClient,
    threadDetailBootstrapQueryOptions(queryClient, "thread-1"),
  ).getCurrentResult();
  return observe(
    queryClient,
    threadQueryOptions(queryClient, "thread-1", {
      enabled: bootstrap.isSuccess,
      refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(bootstrap)
        ? false
        : "always",
    }),
  );
}

afterEach(() => {
  stopObserving();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(sdk.threads.get).mockResolvedValue(THREAD_WITH_INCLUDES);
  vi.mocked(sdk.threads.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.queuedMessages.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.interactions.list).mockResolvedValue([]);
  vi.mocked(sdk.threads.storageLocation).mockResolvedValue({
    hostId: "host-1",
    storageRootPath: "/tmp/thread-storage/thread-1",
  });
  vi.mocked(sdk.threads.timeline).mockResolvedValue(
    makeThreadTimelineResponse({
      timelinePage: {
        kind: "latest",
        segmentLimit: 100,
        returnedSegmentCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    }),
  );
  vi.mocked(api.getThreadHostFilePreview).mockResolvedValue({
    kind: "text",
    path: "/tmp/log.txt",
    url: "/api/v1/threads/thread-1/host-files/tmp/log.txt",
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
    const { queryClient } = createQueryClientTestHarness();

    const observer = observe(
      queryClient,
      threadDetailBootstrapQueryOptions(queryClient, "thread-1", {
        timelinePrefetch: true,
      }),
    );

    await vi.waitFor(() => {
      expect(sdk.threads.get).toHaveBeenCalledTimes(1);
      expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    });
    expect(observer.getCurrentResult().isPending).toBe(true);

    resolveThread?.(THREAD_WITH_INCLUDES);
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isSuccess).toBe(true);
    });
  });

  it("uses the cached timeline sequence and merges a prefetched delta", async () => {
    const previousTimeline = makeThreadTimelineResponse({
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
      timelinePage: {
        kind: "latest",
        segmentLimit: 100,
        returnedSegmentCount: 1,
        hasOlderRows: false,
        olderCursor: null,
      },
      maxSeq: 7,
    });
    vi.mocked(sdk.threads.timeline).mockResolvedValueOnce({
      ...previousTimeline,
      rows: [],
      maxSeq: 8,
      delta: { upsertRows: [] },
    });
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadTimelineQueryKey("thread-1"),
      previousTimeline,
      { updatedAt: 1 },
    );

    observe(
      queryClient,
      threadDetailBootstrapQueryOptions(queryClient, "thread-1", {
        timelinePrefetch: true,
      }),
    );

    await vi.waitFor(() => {
      expect(sdk.threads.timeline).toHaveBeenCalledWith({
        deferContent: "true",
        afterSequence: "7",
        signal: expect.any(AbortSignal),
        threadId: "thread-1",
      });
    });
    await vi.waitFor(() => {
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
    const { queryClient } = createQueryClientTestHarness();
    const updatedAt = Date.now();
    queryClient.setQueryData(
      threadDetailBootstrapQueryKey("thread-1"),
      THREAD_WITH_INCLUDES,
      { updatedAt },
    );
    queryClient.setQueryData(threadQueryKey("thread-1"), THREAD_WITH_INCLUDES, {
      updatedAt,
    });

    const thread = observeBootstrapGatedThread(queryClient);

    await vi.waitFor(() => {
      expect(thread.getCurrentResult().isSuccess).toBe(true);
    });
    expect(sdk.threads.get).not.toHaveBeenCalled();
  });

  it("refreshes the thread read for an old cached bootstrap", async () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadDetailBootstrapQueryKey("thread-1"),
      THREAD_WITH_INCLUDES,
      { updatedAt: 1 },
    );
    queryClient.setQueryData(threadQueryKey("thread-1"), THREAD_WITH_INCLUDES, {
      updatedAt: 1,
    });

    observeBootstrapGatedThread(queryClient);

    await vi.waitFor(() => {
      expect(sdk.threads.get).toHaveBeenCalledTimes(1);
    });
    expect(sdk.threads.get).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      threadId: "thread-1",
    });
  });
});

describe("useArchivedThreads", () => {
  it("fetches pages only while selected and continues from the loaded offset", async () => {
    const { queryClient } = createQueryClientTestHarness();
    vi.mocked(sdk.threads.list)
      .mockResolvedValueOnce(
        Array.from({ length: ARCHIVED_THREADS_PAGE_SIZE }, (_, index) =>
          makeThreadListEntry({
            id: `archived-${index}`,
            archivedAt: 1,
          }),
        ),
      )
      .mockResolvedValueOnce([]);
    const observer = new InfiniteQueryObserver(
      queryClient,
      archivedThreadsQueryOptions({}, { enabled: false }),
    );
    unsubscribes.push(observer.subscribe(() => {}));
    expect(sdk.threads.list).not.toHaveBeenCalled();
    observer.setOptions(archivedThreadsQueryOptions({}, { enabled: true }));
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().hasNextPage).toBe(true),
    );
    await observer.fetchNextPage();
    expect(vi.mocked(sdk.threads.list).mock.calls[1]?.[0]?.offset).toBe(
      ARCHIVED_THREADS_PAGE_SIZE,
    );
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().hasNextPage).toBe(false),
    );
    observer.setOptions(archivedThreadsQueryOptions({}, { enabled: false }));
    await queryClient.invalidateQueries();
    expect(sdk.threads.list).toHaveBeenCalledTimes(2);
  });

  it("loads archived threads across all projects when no scope is selected", async () => {
    const { queryClient } = createQueryClientTestHarness();

    unsubscribes.push(
      new InfiniteQueryObserver(
        queryClient,
        archivedThreadsQueryOptions({}),
      ).subscribe(() => {}),
    );

    await vi.waitFor(() => {
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
    const { queryClient } = createQueryClientTestHarness();

    unsubscribes.push(
      new InfiniteQueryObserver(
        queryClient,
        archivedThreadsQueryOptions({ kind: "child" }),
      ).subscribe(() => {}),
    );

    await vi.waitFor(() => {
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
    const { queryClient } = createQueryClientTestHarness();

    unsubscribes.push(
      new InfiniteQueryObserver(
        queryClient,
        archivedThreadsQueryOptions({ projectId: "proj_1" }),
      ).subscribe(() => {}),
    );

    await vi.waitFor(() => {
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
    const { queryClient } = createQueryClientTestHarness();

    observe(queryClient, threadQueuedMessagesQueryOptions("thread-1"));

    await vi.waitFor(() => {
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

describe("useThreadPendingInteractions", () => {
  it("reuses the first owner's fresh baseline when a second owner mounts", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const first = observe(
      queryClient,
      threadPendingInteractionsQueryOptions("thread-1"),
    );
    await vi.waitFor(() => {
      expect(first.getCurrentResult().isSuccess).toBe(true);
    });
    queryClient.setQueryData(
      threadPendingInteractionsQueryKey("thread-1"),
      [],
      { updatedAt: Date.now() - 1_000 },
    );

    observe(queryClient, threadPendingInteractionsQueryOptions("thread-1"));
    await Promise.resolve();

    expect(sdk.threads.interactions.list).toHaveBeenCalledTimes(1);
  });

  it("refreshes the baseline after every zero-owner interval", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const first = observe(
      queryClient,
      threadPendingInteractionsQueryOptions("thread-1"),
    );
    await vi.waitFor(() => {
      expect(first.getCurrentResult().isSuccess).toBe(true);
    });
    first.destroy();
    const pendingInteraction: PendingInteraction = {
      id: "pint-plan",
      threadId: "thread-1",
      turnId: "turn-1",
      providerId: "claude-code",
      providerThreadId: "provider-thread-1",
      providerRequestId: "request-1",
      status: "pending",
      statusReason: null,
      createdAt: 1,
      resolvedAt: null,
      resolution: null,
      payload: {
        kind: "approval",
        reason: null,
        availableDecisions: ["allow_once", "deny"],
        subject: {
          kind: "plan",
          itemId: "plan-1",
          plan: "Refresh the baseline",
          planFilePath: null,
        },
      },
    };
    vi.mocked(sdk.threads.interactions.list).mockResolvedValue([
      pendingInteraction,
    ]);

    const second = observe(
      queryClient,
      threadPendingInteractionsQueryOptions("thread-1"),
    );

    await vi.waitFor(() => {
      expect(second.getCurrentResult().data).toEqual([pendingInteraction]);
    });
    expect(sdk.threads.interactions.list).toHaveBeenCalledTimes(2);
  });

  it("refetches the interaction baseline when a stale owner remounts", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const first = observe(
      queryClient,
      threadPendingInteractionsQueryOptions("thread-1"),
    );
    await vi.waitFor(() => {
      expect(first.getCurrentResult().isSuccess).toBe(true);
    });
    first.destroy();
    queryClient.setQueryData(
      threadPendingInteractionsQueryKey("thread-1"),
      [],
      { updatedAt: Date.now() - 2_500 },
    );

    observe(queryClient, threadPendingInteractionsQueryOptions("thread-1"));

    await vi.waitFor(() => {
      expect(sdk.threads.interactions.list).toHaveBeenCalledTimes(2);
    });
  });
});

describe("useThreadHostFilePreview", () => {
  it("refetches stale host file previews on focus and reconnect", async () => {
    const { queryClient } = createQueryClientTestHarness();

    observe(
      queryClient,
      threadHostFilePreviewQueryOptions("thread-1", "env-1", "/tmp/log.txt"),
    );

    await vi.waitFor(() => {
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

describe("useChildThreads", () => {
  it("derives children from the sidebar cache across projects without a list request", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const projectChild = makeThreadListEntry({
      id: "child-1",
      projectId: "project-1",
      parentThreadId: "parent-1",
    });
    const personalChild = makeThreadListEntry({
      id: "child-2",
      projectId: "proj_personal",
      parentThreadId: "parent-1",
    });
    const hiddenChild = makeThreadListEntry({
      id: "child-hidden",
      parentThreadId: "parent-1",
      visibility: "hidden",
    });
    const otherChild = makeThreadListEntry({
      id: "child-other",
      parentThreadId: "parent-2",
    });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation(
        [projectChild, hiddenChild, otherChild],
        [personalChild],
      ),
    );

    const readChildThreads = observeChildThreads(queryClient, "parent-1");

    expect(readChildThreads().data?.map((thread) => thread.id)).toEqual([
      "child-1",
      "child-2",
    ]);
    expect(readChildThreads().isLoading).toBe(false);
    expect(sdk.threads.list).not.toHaveBeenCalled();

    const newChild = makeThreadListEntry({
      id: "child-3",
      parentThreadId: "parent-1",
    });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([projectChild, newChild], [personalChild]),
    );
    await vi.waitFor(() => {
      expect(readChildThreads().data?.map((thread) => thread.id)).toEqual([
        "child-1",
        "child-3",
        "child-2",
      ]);
    });
    expect(sdk.threads.list).not.toHaveBeenCalled();
  });

  it("keeps the derived list stable when unrelated sidebar rows change", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const child = makeThreadListEntry({
      id: "child-1",
      parentThreadId: "parent-1",
    });
    const unrelated = makeThreadListEntry({ id: "other", title: "Before" });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([child, unrelated]),
    );
    const readChildThreads = observeChildThreads(queryClient, "parent-1");
    const initialData = readChildThreads().data;
    expect(initialData?.map((thread) => thread.id)).toEqual(["child-1"]);

    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([child, { ...unrelated, title: "After" }]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readChildThreads().data).toBe(initialData);
  });

  it("waits for an in-flight sidebar bootstrap instead of racing it with a list request", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const child = makeThreadListEntry({
      id: "child-1",
      parentThreadId: "parent-1",
    });
    let resolveBootstrap: (value: SidebarBootstrapResponse) => void = () => {};
    const bootstrapFetch = queryClient.prefetchQuery({
      queryKey: sidebarNavigationQueryKey(),
      queryFn: () =>
        new Promise<SidebarBootstrapResponse>((resolve) => {
          resolveBootstrap = resolve;
        }),
    });

    const readChildThreads = observeChildThreads(queryClient, "parent-1");

    expect(readChildThreads().data).toBeUndefined();
    expect(readChildThreads().isLoading).toBe(true);
    expect(sdk.threads.list).not.toHaveBeenCalled();

    resolveBootstrap(makeSidebarNavigation([child]));
    await bootstrapFetch;
    await vi.waitFor(() => {
      expect(readChildThreads().data).toEqual([child]);
    });
    expect(readChildThreads().isLoading).toBe(false);
    expect(sdk.threads.list).not.toHaveBeenCalled();
  });

  it("falls back to the parent-keyed list request without a sidebar cache", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const child = makeThreadListEntry({
      id: "child-1",
      parentThreadId: "parent-1",
    });
    vi.mocked(sdk.threads.list).mockResolvedValue([child]);

    const readChildThreads = observeChildThreads(queryClient, "parent-1");

    await vi.waitFor(() => {
      expect(readChildThreads().data).toEqual([child]);
    });
    expect(sdk.threads.list).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sdk.threads.list).mock.calls[0]?.[0]).toEqual({
      archived: false,
      parentThreadId: "parent-1",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("useThreadMentionCandidates", () => {
  it("serves candidates from the sidebar cache without a list request", () => {
    const { queryClient } = createQueryClientTestHarness();
    const visible = makeThreadListEntry({ id: "thread-visible" });
    const hidden = makeThreadListEntry({
      id: "thread-hidden",
      visibility: "hidden",
    });
    const personal = makeThreadListEntry({
      id: "thread-personal",
      projectId: "proj_personal",
    });
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([visible, hidden], [personal]),
    );

    const result = observeThreadMentionCandidates(queryClient)();

    expect(result.data?.map((thread) => thread.id)).toEqual([
      "thread-visible",
      "thread-personal",
    ]);
    expect(result.isLoading).toBe(false);
    expect(sdk.threads.list).not.toHaveBeenCalled();
  });

  it("falls back to the capped list request without a sidebar cache", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const thread = makeThreadListEntry({ id: "thread-1" });
    vi.mocked(sdk.threads.list).mockResolvedValue([thread]);

    const readCandidates = observeThreadMentionCandidates(queryClient);

    await vi.waitFor(() => {
      expect(readCandidates().data).toEqual([thread]);
    });
    expect(vi.mocked(sdk.threads.list).mock.calls[0]?.[0]).toEqual({
      archived: false,
      limit: 200,
      signal: expect.any(AbortSignal),
    });
  });
});

describe("useThreadStorageLocation", () => {
  it("requests only the storage location for the thread", async () => {
    const observer = observe(
      createQueryClientTestHarness().queryClient,
      threadStorageLocationQueryOptions("thread-1"),
    );

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toEqual({
        hostId: "host-1",
        storageRootPath: "/tmp/thread-storage/thread-1",
      });
    });
    expect(sdk.threads.storageLocation).toHaveBeenCalledWith({
      threadId: "thread-1",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("useThreadTimeline segment limit", () => {
  it("asks for the compact first window on compact viewports and keeps it for deltas", async () => {
    stubMatchMedia([COMPACT_VIEWPORT_QUERY]);
    const { queryClient } = createQueryClientTestHarness();

    const observer = observeThreadTimeline(queryClient, "thread-1");
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isSuccess).toBe(true);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[0]?.[0]).toEqual({
      deferContent: "true",
      threadId: "thread-1",
      segmentLimit: String(COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT),
      signal: expect.any(AbortSignal),
    });

    await queryClient.refetchQueries({
      queryKey: threadTimelineQueryKey("thread-1"),
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[1]?.[0]).toEqual({
      deferContent: "true",
      threadId: "thread-1",
      segmentLimit: String(COMPACT_THREAD_TIMELINE_SEGMENT_LIMIT),
      afterSequence: "0",
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps the server default window on wide viewports", async () => {
    stubMatchMedia([]);
    const { queryClient } = createQueryClientTestHarness();

    const observer = observeThreadTimeline(queryClient, "thread-1");
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().isSuccess).toBe(true);
    });
    expect(vi.mocked(sdk.threads.timeline).mock.calls[0]?.[0]).toEqual({
      deferContent: "true",
      threadId: "thread-1",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("thread open cache retention", () => {
  function seedThreadOpenCache(queryClient: QueryClient, threadId: string) {
    queryClient.setQueryData(threadDetailBootstrapQueryKey(threadId), {
      ...THREAD_WITH_INCLUDES,
      id: threadId,
    });
  }

  async function openTimelines(
    threadIds: readonly string[],
    queryClient: QueryClient,
  ) {
    let observer: QueryObserver<ThreadTimelineResponse> | undefined;
    for (const threadId of threadIds) {
      if (observer === undefined) {
        observer = observeThreadTimeline(queryClient, threadId);
      } else {
        touchThreadOpenCache(queryClient, threadId);
        observer.setOptions(threadTimelineQueryOptions(queryClient, threadId));
      }
      const current = observer;
      await vi.waitFor(() => {
        expect(current.getCurrentResult().isFetchedAfterMount).toBe(true);
        expect(current.getCurrentResult().isFetching).toBe(false);
      });
    }
    observer?.destroy();
  }

  function hasTimeline(queryClient: QueryClient, threadId: string): boolean {
    return (
      queryClient.getQueryData(threadTimelineQueryKey(threadId)) !== undefined
    );
  }

  function hasBootstrap(queryClient: QueryClient, threadId: string): boolean {
    return (
      queryClient.getQueryData(threadDetailBootstrapQueryKey(threadId)) !==
      undefined
    );
  }

  it("keeps timeline and bootstrap queries for an hour", async () => {
    const { queryClient } = createQueryClientTestHarness({
      queries: { gcTime: 0 },
    });

    const bootstrap = observe(
      queryClient,
      threadDetailBootstrapQueryOptions(queryClient, "thread-1"),
    );
    const timeline = observeThreadTimeline(queryClient, "thread-1");
    await vi.waitFor(() => {
      expect(bootstrap.getCurrentResult().isSuccess).toBe(true);
      expect(timeline.getCurrentResult().isSuccess).toBe(true);
    });

    const queryCache = queryClient.getQueryCache();
    expect(
      queryCache.find({ queryKey: threadTimelineQueryKey("thread-1") })?.gcTime,
    ).toBe(THREAD_OPEN_CACHE_GC_MS);
    expect(
      queryCache.find({ queryKey: threadDetailBootstrapQueryKey("thread-1") })
        ?.gcTime,
    ).toBe(THREAD_OPEN_CACHE_GC_MS);
  });

  it("reopens a retained timeline with a delta from its cached sequence", async () => {
    stubMatchMedia([]);
    const existingRow = {
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
    } satisfies ThreadTimelineResponse["rows"][number];
    const appendedRow = {
      ...existingRow,
      id: "row-2",
      sourceSeqStart: 9,
      sourceSeqEnd: 9,
      title: "Appended row",
    } satisfies ThreadTimelineResponse["rows"][number];
    const firstTimeline = makeThreadTimelineResponse({
      rows: [existingRow],
      timelinePage: {
        kind: "latest",
        segmentLimit: 100,
        returnedSegmentCount: 1,
        hasOlderRows: false,
        olderCursor: null,
      },
      maxSeq: 7,
    });
    vi.mocked(sdk.threads.timeline)
      .mockResolvedValueOnce(firstTimeline)
      .mockResolvedValueOnce({
        ...firstTimeline,
        rows: [],
        maxSeq: 9,
        delta: {
          upsertRows: [appendedRow],
          rowOrder: ["row-1", "row-2"],
        },
      });
    const { queryClient } = createQueryClientTestHarness({
      queries: { gcTime: 0, staleTime: 0 },
    });

    const first = observeThreadTimeline(queryClient, "thread-1");
    await vi.waitFor(() => {
      expect(first.getCurrentResult().isSuccess).toBe(true);
    });
    first.destroy();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(hasTimeline(queryClient, "thread-1")).toBe(true);

    const reopened = observeThreadTimeline(queryClient, "thread-1");
    expect(reopened.getCurrentResult().data?.rows).toEqual([existingRow]);
    await vi.waitFor(() => {
      expect(reopened.getCurrentResult().data?.maxSeq).toBe(9);
    });

    expect(vi.mocked(sdk.threads.timeline).mock.calls[1]?.[0]).toEqual({
      deferContent: "true",
      afterSequence: "7",
      signal: expect.any(AbortSignal),
      threadId: "thread-1",
    });
    expect(reopened.getCurrentResult().data?.rows).toEqual([
      existingRow,
      appendedRow,
    ]);
  });

  it("evicts the least recently opened inactive thread past the cap", async () => {
    stubMatchMedia([]);
    const { queryClient } = createQueryClientTestHarness();
    const threadIds = Array.from(
      { length: THREAD_OPEN_CACHE_MAX_THREADS + 1 },
      (_, index) => `thread-${index}`,
    );
    for (const threadId of threadIds) {
      seedThreadOpenCache(queryClient, threadId);
    }

    await openTimelines(threadIds, queryClient);

    expect(hasTimeline(queryClient, "thread-0")).toBe(false);
    expect(hasBootstrap(queryClient, "thread-0")).toBe(false);
    for (const threadId of threadIds.slice(1)) {
      expect(hasTimeline(queryClient, threadId)).toBe(true);
      expect(hasBootstrap(queryClient, threadId)).toBe(true);
    }
  });

  it("frees a deleted thread's slot instead of evicting a retained thread", async () => {
    stubMatchMedia([]);
    const { queryClient } = createQueryClientTestHarness();
    const threadIds = Array.from(
      { length: THREAD_OPEN_CACHE_MAX_THREADS + 1 },
      (_, index) => `thread-${index}`,
    );
    for (const threadId of threadIds) {
      seedThreadOpenCache(queryClient, threadId);
    }
    const deletedThreadId = threadIds[THREAD_OPEN_CACHE_MAX_THREADS - 1];
    if (deletedThreadId === undefined) {
      throw new Error("Expected a thread to delete");
    }

    await openTimelines(threadIds.slice(0, -1), queryClient);
    removeThreadScopedQueries({ queryClient, threadId: deletedThreadId });
    await openTimelines(threadIds.slice(-1), queryClient);

    expect(hasTimeline(queryClient, deletedThreadId)).toBe(false);
    expect(hasBootstrap(queryClient, deletedThreadId)).toBe(false);
    for (const threadId of threadIds) {
      if (threadId === deletedThreadId) {
        continue;
      }
      expect(hasTimeline(queryClient, threadId)).toBe(true);
      expect(hasBootstrap(queryClient, threadId)).toBe(true);
    }
  });

  it("keeps a thread that is still open in another pane", async () => {
    stubMatchMedia([]);
    const { queryClient } = createQueryClientTestHarness();
    const threadIds = Array.from(
      { length: THREAD_OPEN_CACHE_MAX_THREADS + 1 },
      (_, index) => `thread-${index}`,
    );
    const pinned = observeThreadTimeline(queryClient, "thread-0");
    await vi.waitFor(() => {
      expect(pinned.getCurrentResult().isSuccess).toBe(true);
    });

    await openTimelines(threadIds.slice(1), queryClient);

    expect(hasTimeline(queryClient, "thread-0")).toBe(true);
    expect(hasTimeline(queryClient, "thread-1")).toBe(false);
  });

  it("uses the smaller cap on coarse pointers", async () => {
    stubMatchMedia([POINTER_COARSE_QUERY]);
    const { queryClient } = createQueryClientTestHarness();
    const threadIds = Array.from(
      { length: COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS + 1 },
      (_, index) => `thread-${index}`,
    );

    await openTimelines(threadIds, queryClient);

    expect(hasTimeline(queryClient, "thread-0")).toBe(false);
    expect(hasTimeline(queryClient, "thread-1")).toBe(true);
    expect(
      hasTimeline(
        queryClient,
        `thread-${COARSE_POINTER_THREAD_OPEN_CACHE_MAX_THREADS}`,
      ),
    ).toBe(true);
  });
});

describe("palette lifecycle queries", () => {
  it("loads bounded archived recents only while selected before typing", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const archived = makeThreadListEntry({ id: "archived", archivedAt: 1 });
    vi.mocked(sdk.threads.list).mockResolvedValue([archived]);
    const options = ({
      recent,
      selected,
    }: {
      recent: boolean;
      selected: boolean;
    }) =>
      paletteRecentArchivedThreadsQueryOptions({ enabled: recent && selected });
    const observer = observe(
      queryClient,
      options({ recent: true, selected: false }),
    );
    expect(sdk.threads.list).not.toHaveBeenCalled();
    observer.setOptions(options({ recent: false, selected: true }));
    expect(sdk.threads.list).not.toHaveBeenCalled();
    observer.setOptions(options({ recent: true, selected: true }));
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().data).toEqual([archived]),
    );
    expect(sdk.threads.list).toHaveBeenCalledExactlyOnceWith({
      archived: true,
      limit: 20,
      signal: expect.any(AbortSignal),
    });
  });
});
