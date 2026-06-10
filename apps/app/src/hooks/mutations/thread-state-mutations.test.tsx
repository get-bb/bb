// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import * as api from "@/lib/api";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import {
  useArchiveThread,
  useArchiveThreadAndChildren,
  useDeleteThread,
  useMarkThreadRead,
  useMarkThreadUnread,
  usePinThread,
  useReorderPinnedThread,
  useUnpinThread,
} from "./thread-state-mutations";

vi.mock("@/lib/api", () => ({
  archiveThread: vi.fn(),
  archiveThreadAndChildren: vi.fn(),
  deleteThread: vi.fn(),
  markThreadRead: vi.fn(),
  markThreadUnread: vi.fn(),
  pinThread: vi.fn(),
  reorderPinnedThread: vi.fn(),
  unpinThread: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface SeedThreadCachesArgs {
  queryClient: QueryClient;
  threads: ThreadListEntry[];
}

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "project-1",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Thread title",
    titleFallback: "Thread title",
    updatedAt: 10,
    ...overrides,
  };
}

function makeThreadListEntry(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const thread = makeThread(overrides);
  return {
    ...thread,
    environmentBranchName: null,
    environmentHostId: null,
    environmentName: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    pinSortKey: null,
    ...overrides,
  };
}

function makeSidebarNavigationResponse(
  threads: ThreadListEntry[],
): SidebarBootstrapResponse {
  return {
    projects: [
      {
        createdAt: 1,
        defaultExecutionOptions: null,
        id: "project-1",
        kind: "standard",
        name: "Project One",
        sources: [],
        threads,
        updatedAt: 1,
      },
    ],
    personalProject: {
      createdAt: 1,
      defaultExecutionOptions: null,
      id: "personal-project",
      kind: "personal",
      name: "Personal",
      sources: [],
      threads: [],
      updatedAt: 1,
    },
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (!resolvePromise || !rejectPromise) {
    throw new Error("Deferred promise callbacks were not initialized.");
  }
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function seedThreadCaches({
  queryClient,
  threads,
}: SeedThreadCachesArgs): void {
  queryClient.setQueryData<ThreadListEntry[]>(
    threadListQueryKey({
      archived: false,
      projectId: "project-1",
    }),
    threads,
  );
  queryClient.setQueryData<SidebarBootstrapResponse>(
    sidebarNavigationQueryKey(),
    makeSidebarNavigationResponse(threads),
  );
}

function getCachedSidebarThreadIds(queryClient: QueryClient): string[] {
  return (
    queryClient
      .getQueryData<SidebarBootstrapResponse>(sidebarNavigationQueryKey())
      ?.projects.at(0)
      ?.threads.map((thread) => thread.id) ?? []
  );
}

function getCachedSidebarThread(
  queryClient: QueryClient,
  threadId: string,
): ThreadListEntry | undefined {
  return queryClient
    .getQueryData<SidebarBootstrapResponse>(sidebarNavigationQueryKey())
    ?.projects.at(0)
    ?.threads.find((thread) => thread.id === threadId);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("thread state mutations", () => {
  it("pins sidebar navigation threads optimistically", async () => {
    const thread = makeThread();
    const listEntry = makeThreadListEntry();
    const pinDeferred = createDeferred<ThreadWithRuntime>();
    vi.mocked(api.pinThread).mockReturnValue(pinDeferred.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    seedThreadCaches({ queryClient, threads: [listEntry] });
    queryClient.setQueryData(threadQueryKey(thread.id), thread);

    const { result } = renderHook(() => usePinThread(), { wrapper });

    act(() => {
      result.current.mutate({ id: thread.id });
    });

    await waitFor(() => {
      expect(
        getCachedSidebarThread(queryClient, thread.id)?.pinnedAt,
      ).toBeTypeOf("number");
    });
    expect(getCachedSidebarThread(queryClient, thread.id)?.pinSortKey).toBe(
      null,
    );

    await act(async () => {
      pinDeferred.resolve({ ...thread, pinnedAt: 123 });
      await pinDeferred.promise;
    });
  });

  it("unpins sidebar navigation threads optimistically", async () => {
    const thread = makeThread({ pinnedAt: 123 });
    const listEntry = makeThreadListEntry({ pinnedAt: 123, pinSortKey: "a" });
    const unpinDeferred = createDeferred<ThreadWithRuntime>();
    vi.mocked(api.unpinThread).mockReturnValue(unpinDeferred.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    seedThreadCaches({ queryClient, threads: [listEntry] });
    queryClient.setQueryData(threadQueryKey(thread.id), thread);

    const { result } = renderHook(() => useUnpinThread(), { wrapper });

    act(() => {
      result.current.mutate({ id: thread.id });
    });

    await waitFor(() => {
      expect(getCachedSidebarThread(queryClient, thread.id)).toMatchObject({
        pinnedAt: null,
        pinSortKey: null,
      });
    });

    await act(async () => {
      unpinDeferred.resolve({ ...thread, pinnedAt: null });
      await unpinDeferred.promise;
    });
  });

  it("reorders sidebar navigation pinned roots optimistically without settle invalidation", async () => {
    const firstThread = makeThreadListEntry({
      id: "thread-1",
      pinnedAt: 100,
      pinSortKey: "a",
    });
    const secondThread = makeThreadListEntry({
      id: "thread-2",
      pinnedAt: 90,
      pinSortKey: "b",
    });
    const thirdThread = makeThreadListEntry({
      id: "thread-3",
      pinnedAt: 80,
      pinSortKey: "c",
    });
    const reorderDeferred = createDeferred<ThreadListEntry[]>();
    vi.mocked(api.reorderPinnedThread).mockReturnValue(reorderDeferred.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    seedThreadCaches({
      queryClient,
      threads: [firstThread, secondThread, thirdThread],
    });

    const { result } = renderHook(() => useReorderPinnedThread(), { wrapper });

    act(() => {
      result.current.mutate({
        id: thirdThread.id,
        previousThreadId: null,
        nextThreadId: firstThread.id,
      });
    });

    await waitFor(() => {
      expect(
        getCachedSidebarThread(queryClient, thirdThread.id)?.pinSortKey,
      ).toBe("a");
    });
    expect(
      getCachedSidebarThread(queryClient, firstThread.id)?.pinSortKey,
    ).toBe("b");
    expect(
      getCachedSidebarThread(queryClient, secondThread.id)?.pinSortKey,
    ).toBe("c");

    await act(async () => {
      reorderDeferred.resolve([
        { ...thirdThread, pinSortKey: "a" },
        { ...firstThread, pinSortKey: "b" },
        { ...secondThread, pinSortKey: "c" },
      ]);
      await reorderDeferred.promise;
    });
    expect(
      queryClient.getQueryState(sidebarNavigationQueryKey())?.isInvalidated,
    ).toBe(false);
  });

  it("archives a single thread out of sidebar navigation optimistically", async () => {
    const archivedThread = makeThreadListEntry({ id: "thread-1" });
    const otherThread = makeThreadListEntry({ id: "thread-2" });
    const archiveDeferred = createDeferred<void>();
    vi.mocked(api.archiveThread).mockReturnValue(archiveDeferred.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    seedThreadCaches({ queryClient, threads: [archivedThread, otherThread] });
    queryClient.setQueryData(threadQueryKey(archivedThread.id), archivedThread);

    const { result } = renderHook(() => useArchiveThread(), { wrapper });

    act(() => {
      result.current.mutate({ id: archivedThread.id });
    });

    await waitFor(() => {
      expect(getCachedSidebarThreadIds(queryClient)).toEqual([otherThread.id]);
    });

    await act(async () => {
      archiveDeferred.resolve(undefined);
      await archiveDeferred.promise;
    });
  });

  it("deletes a thread out of sidebar navigation optimistically", async () => {
    const deletedThread = makeThread({ id: "thread-1" });
    const deletedThreadEntry = makeThreadListEntry({ id: deletedThread.id });
    const otherThread = makeThreadListEntry({ id: "thread-2" });
    const deleteDeferred = createDeferred<void>();
    vi.mocked(api.deleteThread).mockReturnValue(deleteDeferred.promise);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    seedThreadCaches({
      queryClient,
      threads: [deletedThreadEntry, otherThread],
    });
    queryClient.setQueryData(threadQueryKey(deletedThread.id), deletedThread);

    const { result } = renderHook(() => useDeleteThread(), { wrapper });

    act(() => {
      result.current.mutate({
        id: deletedThread.id,
        childThreadsConfirmed: false,
      });
    });

    await waitFor(() => {
      expect(getCachedSidebarThreadIds(queryClient)).toEqual([otherThread.id]);
    });

    await act(async () => {
      deleteDeferred.resolve(undefined);
      await deleteDeferred.promise;
    });
  });

  it("archives cached parent groups and invalidates thread lists", async () => {
    const parentThread = makeThread({
      id: "parent-1",
    });
    const childThread = makeThread({
      id: "child-1",
      parentThreadId: parentThread.id,
    });
    const otherThread = makeThread({
      id: "thread-2",
    });
    vi.mocked(api.archiveThreadAndChildren).mockResolvedValue({
      ok: true,
      archivedThreadIds: [childThread.id, parentThread.id],
    });

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(parentThread.id), parentThread);
    queryClient.setQueryData(threadQueryKey(childThread.id), childThread);
    const cachedThreads = [
      makeThreadListEntry({
        id: parentThread.id,
      }),
      makeThreadListEntry({
        id: childThread.id,
        parentThreadId: parentThread.id,
      }),
      makeThreadListEntry({
        id: otherThread.id,
      }),
    ];
    queryClient.setQueryData<ThreadListEntry[]>(listKey, cachedThreads);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse(cachedThreads),
    );

    const { result } = renderHook(() => useArchiveThreadAndChildren(), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({ id: parentThread.id });
    });

    expect(api.archiveThreadAndChildren).toHaveBeenCalledWith(parentThread.id);
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)).toEqual([
      expect.objectContaining({ id: otherThread.id }),
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.map((thread) => thread.id),
    ).toEqual([otherThread.id]);
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(parentThread.id),
      )?.archivedAt,
    ).toBeTypeOf("number");
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(childThread.id),
      )?.archivedAt,
    ).toBeTypeOf("number");
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("restores cached parent groups when archive all fails", async () => {
    const parentThread = makeThread({
      id: "parent-1",
    });
    const childThread = makeThread({
      id: "child-1",
      parentThreadId: parentThread.id,
    });
    const parentListEntry = makeThreadListEntry({
      id: parentThread.id,
    });
    const childListEntry = makeThreadListEntry({
      id: childThread.id,
      parentThreadId: parentThread.id,
    });
    vi.mocked(api.archiveThreadAndChildren).mockRejectedValue(
      new Error("archive failed"),
    );

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadQueryKey(parentThread.id), parentThread);
    queryClient.setQueryData(threadQueryKey(childThread.id), childThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [
      parentListEntry,
      childListEntry,
    ]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([parentListEntry, childListEntry]),
    );

    const { result } = renderHook(() => useArchiveThreadAndChildren(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: parentThread.id }),
      ).rejects.toThrow("archive failed");
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(parentThread.id),
      ),
    ).toEqual(parentThread);
    expect(
      queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(childThread.id),
      ),
    ).toEqual(childThread);
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)).toEqual([
      parentListEntry,
      childListEntry,
    ]);
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)?.threads,
    ).toEqual([parentListEntry, childListEntry]);
  });

  it("marks a thread read without invalidating active thread lists", async () => {
    const unreadThread = makeThread({
      lastReadAt: null,
      latestAttentionAt: 10,
    });
    const readThread = makeThread({ lastReadAt: 10, latestAttentionAt: 10 });
    vi.mocked(api.markThreadRead).mockResolvedValue(readThread);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    const unreadListEntry = makeThreadListEntry({
      lastReadAt: null,
      latestAttentionAt: 10,
    });
    queryClient.setQueryData(threadQueryKey(unreadThread.id), unreadThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [unreadListEntry]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([unreadListEntry]),
    );

    const { result } = renderHook(() => useMarkThreadRead(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(unreadThread.id);
    });

    expect(queryClient.getQueryData(threadQueryKey(unreadThread.id))).toEqual(
      readThread,
    );
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
    ).toMatchObject({
      id: unreadThread.id,
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0),
    ).toMatchObject({
      id: unreadThread.id,
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      false,
    );
  });

  it("marks a thread unread without invalidating active thread lists", async () => {
    const readThread = makeThread({ lastReadAt: 10, latestAttentionAt: 10 });
    const unreadThread = makeThread({ lastReadAt: 0, latestAttentionAt: 10 });
    vi.mocked(api.markThreadUnread).mockResolvedValue(unreadThread);

    const { queryClient, wrapper } = createQueryClientTestHarness();
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    const readListEntry = makeThreadListEntry({
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    queryClient.setQueryData(threadQueryKey(readThread.id), readThread);
    queryClient.setQueryData<ThreadListEntry[]>(listKey, [readListEntry]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationKey,
      makeSidebarNavigationResponse([readListEntry]),
    );

    const { result } = renderHook(() => useMarkThreadUnread(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(readThread.id);
    });

    expect(queryClient.getQueryData(threadQueryKey(readThread.id))).toEqual(
      unreadThread,
    );
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
    ).toMatchObject({
      id: readThread.id,
      lastReadAt: 0,
      latestAttentionAt: 10,
    });
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0),
    ).toMatchObject({
      id: readThread.id,
      lastReadAt: 0,
      latestAttentionAt: 10,
    });
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      false,
    );
  });
});
