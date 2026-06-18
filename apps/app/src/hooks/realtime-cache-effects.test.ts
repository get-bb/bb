import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import {
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
} from "@bb/domain";
import { createAppQueryClient } from "@/lib/query-client";
import {
  archivedThreadsListQueryKey,
  environmentDiffFilesQueryKey,
  environmentDiffPatchQueryKey,
  environmentWorkStatusQueryKey,
  localPathExistenceQueryKey,
  projectPathsQueryKey,
  projectPromptHistoryQueryKey,
  projectSourceBranchesQueryKey,
  projectsQueryKey,
  sidebarNavigationQueryKey,
  threadQueuedMessagesQueryKey,
  threadListQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadSearchQueryKey,
  threadTerminalsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadTimelineQueryKey,
  threadTimelineTurnSummaryDetailsQueryKey,
} from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import {
  REALTIME_ENVIRONMENT_CHANGE_REGISTRY,
  REALTIME_HOST_CHANGE_REGISTRY,
  REALTIME_PROJECT_CHANGE_REGISTRY,
  REALTIME_SYSTEM_CHANGE_REGISTRY,
  REALTIME_THREAD_CHANGE_REGISTRY,
} from "./cache-owners/realtime-cache-registry";

const PROJECT_PROMPT_HISTORY_THREAD_CHANGES = [
  "thread-created",
  "thread-deleted",
  "archived-changed",
] as const;
const NON_PROJECT_PROMPT_HISTORY_THREAD_CHANGES = [
  "parent-changed",
  "read-state-changed",
  "title-changed",
] as const;

interface CachedThreadListEntryFixture {
  hasPendingInteraction: boolean;
  id: string;
}

interface CachedSidebarNavigationProjectFixture {
  threads: CachedThreadListEntryFixture[];
}

interface CachedSidebarNavigationFixture {
  personalProject: CachedSidebarNavigationProjectFixture;
  projects: CachedSidebarNavigationProjectFixture[];
}

function createRealtimeEffectsTestContext() {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
  const effects = createRealtimeCacheEffects({ queryClient });
  const firstProjectHistoryKey = projectPromptHistoryQueryKey("project-1");
  const secondProjectHistoryKey = projectPromptHistoryQueryKey("project-2");
  const terminalKey = threadTerminalsQueryKey("thr_1");

  queryClient.setQueryData(firstProjectHistoryKey, []);
  queryClient.setQueryData(secondProjectHistoryKey, []);
  queryClient.setQueryData(terminalKey, { sessions: [] });

  return {
    effects,
    firstProjectHistoryKey,
    queryClient,
    secondProjectHistoryKey,
    terminalKey,
  };
}

describe("createRealtimeCacheEffects", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps every realtime thread change to at least one dirty handler", () => {
    for (const changeKind of THREAD_CHANGE_KINDS) {
      expect(
        REALTIME_THREAD_CHANGE_REGISTRY[changeKind].dirty.length,
      ).toBeGreaterThan(0);
    }
  });

  it("maps every realtime environment change to at least one dirty handler", () => {
    for (const changeKind of ENVIRONMENT_CHANGE_KINDS) {
      expect(
        REALTIME_ENVIRONMENT_CHANGE_REGISTRY[changeKind].dirty.length,
      ).toBeGreaterThan(0);
    }
  });

  it("maps every realtime project change to at least one dirty handler", () => {
    for (const changeKind of PROJECT_CHANGE_KINDS) {
      expect(
        REALTIME_PROJECT_CHANGE_REGISTRY[changeKind].dirty.length,
      ).toBeGreaterThan(0);
    }
  });

  it("maps every realtime host change to at least one dirty handler", () => {
    for (const changeKind of HOST_CHANGE_KINDS) {
      expect(
        REALTIME_HOST_CHANGE_REGISTRY[changeKind].dirty.length,
      ).toBeGreaterThan(0);
    }
  });

  it("maps every realtime system change to at least one dirty handler", () => {
    for (const changeKind of SYSTEM_CHANGE_KINDS) {
      expect(
        REALTIME_SYSTEM_CHANGE_REGISTRY[changeKind].dirty.length,
      ).toBeGreaterThan(0);
    }
  });

  it.each(PROJECT_PROMPT_HISTORY_THREAD_CHANGES)(
    "invalidates all cached project prompt histories for %s thread events",
    (change) => {
      vi.useFakeTimers();
      const {
        effects,
        firstProjectHistoryKey,
        queryClient,
        secondProjectHistoryKey,
      } = createRealtimeEffectsTestContext();

      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: [change],
      });

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);

      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).toBe(true);

      effects.dispose();
    },
  );

  it("uses thread project metadata to invalidate only the affected project prompt history", () => {
    vi.useFakeTimers();
    const {
      effects,
      firstProjectHistoryKey,
      queryClient,
      secondProjectHistoryKey,
    } = createRealtimeEffectsTestContext();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["thread-created"],
    });

    vi.advanceTimersByTime(50);

    expect(
      queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
    ).not.toBe(true);

    effects.dispose();
  });

  it("uses thread project metadata to invalidate affected project and global thread lists", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const firstProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const firstProjectArchivedThreadListKey = archivedThreadsListQueryKey({
      projectId: "project-1",
    });
    const secondProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-2",
    });
    const globalActiveThreadListKey = threadListQueryKey({
      archived: false,
    });
    const globalRootThreadListKey = threadListQueryKey({
      archived: false,
    });
    queryClient.setQueryData(firstProjectThreadListKey, []);
    queryClient.setQueryData(firstProjectArchivedThreadListKey, []);
    queryClient.setQueryData(secondProjectThreadListKey, []);
    queryClient.setQueryData(globalActiveThreadListKey, []);
    queryClient.setQueryData(globalRootThreadListKey, []);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["title-changed"],
    });

    vi.advanceTimersByTime(50);

    expect(
      queryClient.getQueryState(firstProjectThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(firstProjectArchivedThreadListKey)
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(globalActiveThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(globalRootThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectThreadListKey)?.isInvalidated,
    ).not.toBe(true);

    effects.dispose();
  });

  it("invalidates sidebar navigation for thread list changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData<CachedSidebarNavigationFixture>(
      sidebarNavigationKey,
      {
        projects: [{ threads: [] }],
        personalProject: { threads: [] },
      },
    );

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["title-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates cached thread search results when indexed thread content changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "needle",
    });
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["item/completed"], projectId: "project-1" },
      changes: ["events-appended"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates cached thread search results when environment metadata changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "branch-label",
    });
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });

    effects.handleChanged({
      type: "changed",
      entity: "environment",
      id: "env_1",
      changes: ["metadata-changed"],
    });
    vi.advanceTimersByTime(250);

    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );

    effects.dispose();
  });

  it("refetches active root thread lists without refetching child lists for order changes", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const activeProjectThreadListKey = threadListQueryKey({
      projectId: "project-1",
      archived: false,
    });
    const rootThreadListKey = threadListQueryKey({
      projectId: "project-1",
      hasParent: false,
      archived: false,
    });
    const childThreadListKey = threadListQueryKey({
      projectId: "project-1",
      parentThreadId: "thr_1",
      archived: false,
    });
    const globalActiveThreadListKey = threadListQueryKey({
      archived: false,
    });
    const globalRootThreadListKey = threadListQueryKey({
      archived: false,
      hasParent: false,
    });
    const archivedThreadListKey = archivedThreadsListQueryKey({
      projectId: "project-1",
    });
    queryClient.setQueryData(activeProjectThreadListKey, []);
    queryClient.setQueryData(rootThreadListKey, []);
    queryClient.setQueryData(childThreadListKey, []);
    queryClient.setQueryData(globalActiveThreadListKey, []);
    queryClient.setQueryData(globalRootThreadListKey, []);
    queryClient.setQueryData(archivedThreadListKey, []);
    const activeProjectThreadListQueryFn = vi.fn(async () => []);
    const rootThreadListQueryFn = vi.fn(async () => []);
    const childThreadListQueryFn = vi.fn(async () => []);
    const globalActiveThreadListQueryFn = vi.fn(async () => []);
    const globalRootThreadListQueryFn = vi.fn(async () => []);
    const activeProjectThreadListObserver = new QueryObserver(queryClient, {
      queryKey: activeProjectThreadListKey,
      queryFn: activeProjectThreadListQueryFn,
      staleTime: Infinity,
    });
    const rootThreadListObserver = new QueryObserver(queryClient, {
      queryKey: rootThreadListKey,
      queryFn: rootThreadListQueryFn,
      staleTime: Infinity,
    });
    const childThreadListObserver = new QueryObserver(queryClient, {
      queryKey: childThreadListKey,
      queryFn: childThreadListQueryFn,
      staleTime: Infinity,
    });
    const globalActiveThreadListObserver = new QueryObserver(queryClient, {
      queryKey: globalActiveThreadListKey,
      queryFn: globalActiveThreadListQueryFn,
      staleTime: Infinity,
    });
    const globalRootThreadListObserver = new QueryObserver(queryClient, {
      queryKey: globalRootThreadListKey,
      queryFn: globalRootThreadListQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeActiveProjectThreadList =
      activeProjectThreadListObserver.subscribe(() => {});
    const unsubscribeRootThreadList = rootThreadListObserver.subscribe(
      () => {},
    );
    const unsubscribeChildThreadList = childThreadListObserver.subscribe(
      () => {},
    );
    const unsubscribeGlobalActiveThreadList =
      globalActiveThreadListObserver.subscribe(() => {});
    const unsubscribeGlobalRootThreadList =
      globalRootThreadListObserver.subscribe(() => {});
    activeProjectThreadListQueryFn.mockClear();
    rootThreadListQueryFn.mockClear();
    childThreadListQueryFn.mockClear();
    globalActiveThreadListQueryFn.mockClear();
    globalRootThreadListQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["order-changed"],
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(activeProjectThreadListQueryFn).toHaveBeenCalledTimes(1);
    expect(rootThreadListQueryFn).toHaveBeenCalledTimes(1);
    expect(globalActiveThreadListQueryFn).toHaveBeenCalledTimes(1);
    expect(globalRootThreadListQueryFn).toHaveBeenCalledTimes(1);
    expect(childThreadListQueryFn).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(archivedThreadListKey)?.isInvalidated,
    ).not.toBe(true);

    unsubscribeActiveProjectThreadList();
    unsubscribeRootThreadList();
    unsubscribeChildThreadList();
    unsubscribeGlobalActiveThreadList();
    unsubscribeGlobalRootThreadList();
    effects.dispose();
  });

  it("falls back to invalidating all cached thread lists when a thread list event has no project metadata", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const firstProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const secondProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-2",
    });
    queryClient.setQueryData(firstProjectThreadListKey, []);
    queryClient.setQueryData(secondProjectThreadListKey, []);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["title-changed"],
    });

    vi.advanceTimersByTime(50);

    expect(
      queryClient.getQueryState(firstProjectThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectThreadListKey)?.isInvalidated,
    ).toBe(true);

    effects.dispose();
  });

  it.each(NON_PROJECT_PROMPT_HISTORY_THREAD_CHANGES)(
    "does not invalidate cached project prompt histories for %s thread events",
    (change) => {
      vi.useFakeTimers();
      const {
        effects,
        firstProjectHistoryKey,
        queryClient,
        secondProjectHistoryKey,
      } = createRealtimeEffectsTestContext();

      effects.handleChanged({
        type: "changed",
        entity: "thread",
        id: "thr_1",
        changes: [change],
      });

      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
      ).not.toBe(true);

      effects.dispose();
    },
  );

  it("does not refetch active thread queries for read-state changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(threadListKey, []);
    queryClient.setQueryData<CachedSidebarNavigationFixture>(
      sidebarNavigationKey,
      {
        projects: [{ threads: [] }],
        personalProject: { threads: [] },
      },
    );
    const threadQueryFn = vi.fn(async () => null);
    const threadListQueryFn = vi.fn(async () => []);
    const sidebarNavigationQueryFn = vi.fn(async () => ({
      projects: [],
      personalProject: { threads: [] },
    }));
    const threadObserver = new QueryObserver(queryClient, {
      queryKey: threadKey,
      queryFn: threadQueryFn,
      staleTime: Infinity,
    });
    const threadListObserver = new QueryObserver(queryClient, {
      queryKey: threadListKey,
      queryFn: threadListQueryFn,
      staleTime: Infinity,
    });
    const sidebarNavigationObserver = new QueryObserver(queryClient, {
      queryKey: sidebarNavigationKey,
      queryFn: sidebarNavigationQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeThread = threadObserver.subscribe(() => {});
    const unsubscribeThreadList = threadListObserver.subscribe(() => {});
    const unsubscribeSidebarNavigation = sidebarNavigationObserver.subscribe(
      () => {},
    );
    threadQueryFn.mockClear();
    threadListQueryFn.mockClear();
    sidebarNavigationQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["read-state-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(threadQueryFn).not.toHaveBeenCalled();
    expect(threadListQueryFn).not.toHaveBeenCalled();
    expect(sidebarNavigationQueryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(threadListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );

    unsubscribeThread();
    unsubscribeThreadList();
    unsubscribeSidebarNavigation();
    effects.dispose();
  });

  it("refetches the active diff TOC and work-status queries but evicts the observer-less patch cache for work-status changes", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const diffFilesKey = environmentDiffFilesQueryKey("env-1", "all", "main");
    const diffPatchKey = environmentDiffPatchQueryKey(
      "env-1",
      "all",
      "main",
      "file.ts",
    );
    const workStatusKey = environmentWorkStatusQueryKey("env-1", "main");
    queryClient.setQueryData(diffFilesKey, {
      outcome: "available",
      files: [],
      shortstat: "1 file changed",
      mergeBaseRef: "base-ref",
    });
    // The per-file patch cache is imperative and observer-less in production —
    // it is written with setQueryData and read with getQueryData, with no
    // useQuery/queryFn. Seed it the same way (no observer) so the assertion
    // catches a real bug: invalidateQueries would only mark it stale and leave
    // getQueryData returning the stale patch, while removeQueries evicts it.
    queryClient.setQueryData(diffPatchKey, {
      path: "file.ts",
      patch: "diff --git a/file.ts b/file.ts\n",
      truncated: false,
    });
    queryClient.setQueryData(workStatusKey, null);
    const diffFilesQueryFn = vi.fn(async () => ({
      outcome: "available" as const,
      files: [],
      shortstat: "",
      mergeBaseRef: "base-ref",
    }));
    const workStatusQueryFn = vi.fn(async () => null);
    const diffFilesObserver = new QueryObserver(queryClient, {
      queryKey: diffFilesKey,
      queryFn: diffFilesQueryFn,
      staleTime: Infinity,
    });
    const workStatusObserver = new QueryObserver(queryClient, {
      queryKey: workStatusKey,
      queryFn: workStatusQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeDiffFiles = diffFilesObserver.subscribe(() => {});
    const unsubscribeWorkStatus = workStatusObserver.subscribe(() => {});
    diffFilesQueryFn.mockClear();
    workStatusQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "environment",
      id: "env-1",
      changes: ["work-status-changed"],
    });
    await vi.advanceTimersByTimeAsync(250);

    // The observer-backed TOC and work-status queries refetch.
    expect(diffFilesQueryFn).toHaveBeenCalledTimes(1);
    expect(workStatusQueryFn).toHaveBeenCalledTimes(1);
    // The observer-less patch entry is evicted, not left stale — so the panel's
    // readDiffPatchEntry returns undefined and re-fetches a fresh patch.
    expect(queryClient.getQueryData(diffPatchKey)).toBeUndefined();

    unsubscribeDiffFiles();
    unsubscribeWorkStatus();
    effects.dispose();
  });

  it("refetches active thread storage preview queries for thread storage changes", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const storagePreviewKey = threadStorageFilePreviewQueryKey(
      "thr_1",
      "notes.md",
    );
    const initialStoragePreview = {
      kind: "text",
      content: "old",
      mimeType: "text/plain",
      path: "notes.md",
      url: "/old",
    };
    const nextStoragePreview = {
      kind: "text",
      content: "new",
      mimeType: "text/plain",
      path: "notes.md",
      url: "/new",
    };
    queryClient.setQueryData(threadKey, {
      id: "thr_1",
      environmentId: "env-1",
    });
    queryClient.setQueryData(storagePreviewKey, initialStoragePreview);
    const storagePreviewQueryFn = vi.fn(async () => nextStoragePreview);
    const storagePreviewObserver = new QueryObserver(queryClient, {
      queryKey: storagePreviewKey,
      queryFn: storagePreviewQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeStoragePreview = storagePreviewObserver.subscribe(
      () => {},
    );
    storagePreviewQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "environment",
      id: "env-1",
      changes: ["thread-storage-changed"],
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(storagePreviewQueryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(storagePreviewKey)).toEqual(
      nextStoragePreview,
    );

    unsubscribeStoragePreview();
    effects.dispose();
  });

  it("refetches active thread storage preview queries when a thread environment changes", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const storagePreviewKey = threadStorageFilePreviewQueryKey(
      "thr_1",
      "notes.md",
    );
    const initialStoragePreview = {
      kind: "text",
      content: "old",
      mimeType: "text/plain",
      path: "notes.md",
      url: "/old",
    };
    const nextStoragePreview = {
      kind: "text",
      content: "new",
      mimeType: "text/plain",
      path: "notes.md",
      url: "/new",
    };
    queryClient.setQueryData(storagePreviewKey, initialStoragePreview);
    const storagePreviewQueryFn = vi.fn(async () => nextStoragePreview);
    const storagePreviewObserver = new QueryObserver(queryClient, {
      queryKey: storagePreviewKey,
      queryFn: storagePreviewQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeStoragePreview = storagePreviewObserver.subscribe(
      () => {},
    );
    storagePreviewQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["environment-changed"],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(storagePreviewQueryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(storagePreviewKey)).toEqual(
      nextStoragePreview,
    );

    unsubscribeStoragePreview();
    effects.dispose();
  });

  it("does not invalidate timeline queries for status-only thread changes", () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const timelineKey = threadTimelineQueryKey("thr_1");
    queryClient.setQueryData(timelineKey, {
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["status-changed"],
    });

    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).not.toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates timeline but not thread detail or prompt history for non-turn-request events", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const timelineKey = threadTimelineQueryKey("thr_1");
    const promptHistoryKey = threadPromptHistoryQueryKey("thr_1");
    // A completed turn's expanded detail panel is immutable; events-appended
    // must not refetch it (W2).
    const turnDetailsKey = threadTimelineTurnSummaryDetailsQueryKey({
      threadId: "thr_1",
      turnId: "turn_1",
      sourceSeqStart: 1,
      sourceSeqEnd: 5,
    });
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(promptHistoryKey, []);
    queryClient.setQueryData(turnDetailsKey, { rows: [] });
    queryClient.setQueryData(timelineKey, {
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["system/error"], projectId: "project-1" },
      changes: ["events-appended"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).not.toBe(true);
    expect(queryClient.getQueryState(promptHistoryKey)?.isInvalidated).not.toBe(
      true,
    );
    expect(queryClient.getQueryState(turnDetailsKey)?.isInvalidated).not.toBe(
      true,
    );

    effects.dispose();
  });

  it("does not cancel active timeline refetches for repeated event invalidations", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const timelineKey = threadTimelineQueryKey("thr_1");
    const signals: AbortSignal[] = [];
    const resolveFetches: Array<(value: unknown) => void> = [];
    const timelineQueryFn = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise((resolve) => {
        resolveFetches.push(resolve);
      });
    });
    const timelineObserver = new QueryObserver(queryClient, {
      queryKey: timelineKey,
      queryFn: timelineQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeTimeline = timelineObserver.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(timelineQueryFn).toHaveBeenCalledTimes(1);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["system/error"], projectId: "project-1" },
      changes: ["events-appended"],
    });
    await vi.advanceTimersByTimeAsync(50);
    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["item/completed"], projectId: "project-1" },
      changes: ["events-appended"],
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(signals[0]?.aborted).toBe(false);
    expect(timelineQueryFn).toHaveBeenCalledTimes(1);

    resolveFetches[0]?.({
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(timelineQueryFn).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(false);
    resolveFetches[1]?.({
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });

    unsubscribeTimeline();
    effects.dispose();
  });

  it("invalidates thread prompt history when a batched appended event includes a turn request", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const promptHistoryKey = threadPromptHistoryQueryKey("thr_1");
    queryClient.setQueryData(promptHistoryKey, []);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["client/turn/requested"] },
      changes: ["events-appended"],
    });
    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { eventTypes: ["system/error"] },
      changes: ["events-appended"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(promptHistoryKey)?.isInvalidated).toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates queued messages and prompt history but not thread detail for queue changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const queuedMessagesKey = threadQueuedMessagesQueryKey("thr_1");
    const promptHistoryKey = threadPromptHistoryQueryKey("thr_1");
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(queuedMessagesKey, []);
    queryClient.setQueryData(promptHistoryKey, []);

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["queue-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(queuedMessagesKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(promptHistoryKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).not.toBe(true);

    effects.dispose();
  });

  it("uses thread project metadata to mark only affected project thread lists stale for read-state changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const firstProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const secondProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-2",
    });
    queryClient.setQueryData(firstProjectThreadListKey, []);
    queryClient.setQueryData(secondProjectThreadListKey, []);
    const firstProjectThreadListQueryFn = vi.fn(async () => []);
    const secondProjectThreadListQueryFn = vi.fn(async () => []);
    const firstProjectThreadListObserver = new QueryObserver(queryClient, {
      queryKey: firstProjectThreadListKey,
      queryFn: firstProjectThreadListQueryFn,
      staleTime: Infinity,
    });
    const secondProjectThreadListObserver = new QueryObserver(queryClient, {
      queryKey: secondProjectThreadListKey,
      queryFn: secondProjectThreadListQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeFirstProjectThreadList =
      firstProjectThreadListObserver.subscribe(() => {});
    const unsubscribeSecondProjectThreadList =
      secondProjectThreadListObserver.subscribe(() => {});
    firstProjectThreadListQueryFn.mockClear();
    secondProjectThreadListQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["read-state-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(firstProjectThreadListQueryFn).not.toHaveBeenCalled();
    expect(secondProjectThreadListQueryFn).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(firstProjectThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectThreadListKey)?.isInvalidated,
    ).not.toBe(true);

    unsubscribeFirstProjectThreadList();
    unsubscribeSecondProjectThreadList();
    effects.dispose();
  });

  it("patches cached thread list pending interaction state from notification metadata", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const timelineKey = threadTimelineQueryKey("thr_1");
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(timelineKey, {
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });
    queryClient.setQueryData<CachedThreadListEntryFixture[]>(threadListKey, [
      { hasPendingInteraction: false, id: "thr_1" },
    ]);
    queryClient.setQueryData<CachedSidebarNavigationFixture>(
      sidebarNavigationKey,
      {
        projects: [
          { threads: [{ hasPendingInteraction: false, id: "thr_1" }] },
        ],
        personalProject: { threads: [] },
      },
    );

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { hasPendingInteraction: true, projectId: "project-1" },
      changes: ["interactions-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(
      queryClient
        .getQueryData<CachedThreadListEntryFixture[]>(threadListKey)
        ?.at(0)?.hasPendingInteraction,
    ).toBe(true);
    expect(
      queryClient
        .getQueryData<CachedSidebarNavigationFixture>(sidebarNavigationKey)
        ?.projects.at(0)
        ?.threads.at(0)?.hasPendingInteraction,
    ).toBe(true);
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).not.toBe(true);
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).not.toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates thread list and detail but not timeline for parent changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const threadKey = threadQueryKey("thr_1");
    const timelineKey = threadTimelineQueryKey("thr_1");
    const firstProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const secondProjectThreadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-2",
    });
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(firstProjectThreadListKey, []);
    queryClient.setQueryData(secondProjectThreadListKey, []);
    queryClient.setQueryData(timelineKey, {
      rows: [],
      timelinePage: {
        kind: "latest",
        topLevelLimit: 100,
        returnedOlderTopLevelRowCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    });

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: { projectId: "project-1" },
      changes: ["parent-changed"],
    });
    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(firstProjectThreadListKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectThreadListKey)?.isInvalidated,
    ).not.toBe(true);
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).not.toBe(
      true,
    );

    effects.dispose();
  });

  it("invalidates cached project prompt history only for the changed project on project threads-changed events", () => {
    const {
      effects,
      firstProjectHistoryKey,
      queryClient,
      secondProjectHistoryKey,
    } = createRealtimeEffectsTestContext();

    effects.handleChanged({
      type: "changed",
      entity: "project",
      id: "project-1",
      changes: ["threads-changed"],
    });

    expect(
      queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
    ).not.toBe(true);

    effects.dispose();
  });

  it("falls back to invalidating all cached project prompt histories when a project threads-changed event has no id", () => {
    const {
      effects,
      firstProjectHistoryKey,
      queryClient,
      secondProjectHistoryKey,
    } = createRealtimeEffectsTestContext();

    effects.handleChanged({
      type: "changed",
      entity: "project",
      changes: ["threads-changed"],
    });

    expect(
      queryClient.getQueryState(firstProjectHistoryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectHistoryKey)?.isInvalidated,
    ).toBe(true);

    effects.dispose();
  });

  it("invalidates project source dependent queries for the changed project", () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const projectsKey = projectsQueryKey();
    const localPathKey = localPathExistenceQueryKey("host-1", [
      "/workspace/project",
    ]);
    const firstProjectPathsKey = projectPathsQueryKey(
      "project-1",
      "",
      20,
      true,
      true,
    );
    const secondProjectPathsKey = projectPathsQueryKey(
      "project-2",
      "",
      20,
      true,
      true,
    );
    const firstProjectSourceBranchesKey = projectSourceBranchesQueryKey(
      "project-1",
      "host-1",
    );
    const secondProjectSourceBranchesKey = projectSourceBranchesQueryKey(
      "project-2",
      "host-1",
    );
    queryClient.setQueryData(projectsKey, []);
    queryClient.setQueryData(localPathKey, []);
    queryClient.setQueryData(firstProjectPathsKey, []);
    queryClient.setQueryData(secondProjectPathsKey, []);
    queryClient.setQueryData(firstProjectSourceBranchesKey, []);
    queryClient.setQueryData(secondProjectSourceBranchesKey, []);

    effects.handleChanged({
      type: "changed",
      entity: "project",
      id: "project-1",
      changes: ["project-sources-changed"],
    });

    expect(queryClient.getQueryState(projectsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(localPathKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(firstProjectPathsKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(firstProjectSourceBranchesKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(secondProjectPathsKey)?.isInvalidated,
    ).not.toBe(true);
    expect(
      queryClient.getQueryState(secondProjectSourceBranchesKey)?.isInvalidated,
    ).not.toBe(true);

    effects.dispose();
  });

  it("invalidates cached thread terminals for terminal changes", () => {
    vi.useFakeTimers();
    const { effects, queryClient, terminalKey } =
      createRealtimeEffectsTestContext();

    effects.handleChanged({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["terminals-changed"],
    });

    expect(queryClient.getQueryState(terminalKey)?.isInvalidated).not.toBe(
      true,
    );

    vi.advanceTimersByTime(50);

    expect(queryClient.getQueryState(terminalKey)?.isInvalidated).toBe(true);

    effects.dispose();
  });
});
