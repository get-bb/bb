import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import {
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
  WORKFLOW_RUN_CHANGE_KINDS,
} from "@bb/domain";
import { createAppQueryClient } from "@/lib/query-client";
import {
  archivedThreadsListQueryKey,
  appMarkdownPreviewQueryKey,
  appQueryKey,
  appsQueryKey,
  environmentGitDiffQueryKey,
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
  threadTerminalsQueryKey,
  threadStorageFilePreviewQueryKey,
  threadTimelineQueryKey,
  workflowRunAgentEventsQueryKey,
  workflowRunEventsQueryKey,
  workflowRunQueryKey,
  workflowRunsQueryKey,
} from "./queries/query-keys";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import {
  REALTIME_ENVIRONMENT_CHANGE_REGISTRY,
  REALTIME_HOST_CHANGE_REGISTRY,
  REALTIME_PROJECT_CHANGE_REGISTRY,
  REALTIME_SYSTEM_CHANGE_REGISTRY,
  REALTIME_THREAD_CHANGE_REGISTRY,
  REALTIME_WORKFLOW_RUN_CHANGE_REGISTRY,
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

  it("maps every realtime workflow-run change to at least one dirty handler", () => {
    for (const changeKind of WORKFLOW_RUN_CHANGE_KINDS) {
      expect(
        REALTIME_WORKFLOW_RUN_CHANGE_REGISTRY[changeKind].dirty.length,
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
      kind: "all",
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
      kind: "all",
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
    const unsubscribeChildThreadList =
      childThreadListObserver.subscribe(() => {});
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

  it("refetches active git diff queries for work-status changes", async () => {
    vi.useFakeTimers();
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const gitDiffKey = environmentGitDiffQueryKey("env-1", "all", "main");
    const workStatusKey = environmentWorkStatusQueryKey("env-1", "main");
    queryClient.setQueryData(gitDiffKey, {
      diff: "diff --git a/file.ts b/file.ts\n",
      files: "M\tfile.ts\n",
      mergeBaseRef: "base-ref",
      shortstat: "1 file changed",
      truncated: false,
    });
    queryClient.setQueryData(workStatusKey, null);
    const gitDiffQueryFn = vi.fn(async () => ({
      diff: "",
      files: "",
      mergeBaseRef: "base-ref",
      shortstat: "",
      truncated: false,
    }));
    const workStatusQueryFn = vi.fn(async () => null);
    const gitDiffObserver = new QueryObserver(queryClient, {
      queryKey: gitDiffKey,
      queryFn: gitDiffQueryFn,
      staleTime: Infinity,
    });
    const workStatusObserver = new QueryObserver(queryClient, {
      queryKey: workStatusKey,
      queryFn: workStatusQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeGitDiff = gitDiffObserver.subscribe(() => {});
    const unsubscribeWorkStatus = workStatusObserver.subscribe(() => {});
    gitDiffQueryFn.mockClear();
    workStatusQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "environment",
      id: "env-1",
      changes: ["work-status-changed"],
    });
    await vi.advanceTimersByTimeAsync(250);

    expect(gitDiffQueryFn).toHaveBeenCalledTimes(1);
    expect(workStatusQueryFn).toHaveBeenCalledTimes(1);

    unsubscribeGitDiff();
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
    queryClient.setQueryData(threadKey, { id: "thr_1" });
    queryClient.setQueryData(promptHistoryKey, []);
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
      null,
      true,
      true,
    );
    const secondProjectPathsKey = projectPathsQueryKey(
      "project-2",
      "",
      20,
      null,
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

  it("refetches active app list queries for app list changes without reconnect", async () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const appsKey = appsQueryKey();
    queryClient.setQueryData(appsKey, []);
    const appsQueryFn = vi.fn(async () => []);
    const appsObserver = new QueryObserver(queryClient, {
      queryKey: appsKey,
      queryFn: appsQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeApps = appsObserver.subscribe(() => {});
    appsQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "system",
      changes: ["apps-changed"],
    });

    await vi.waitFor(() => expect(appsQueryFn).toHaveBeenCalledTimes(1));

    unsubscribeApps();
    effects.dispose();
  });

  it("ignores app entity apps-changed — the SPA's app-list invalidation rides system:apps-changed", async () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const appsKey = appsQueryKey();
    queryClient.setQueryData(appsKey, []);
    const appsQueryFn = vi.fn(async () => []);
    const appsObserver = new QueryObserver(queryClient, {
      queryKey: appsKey,
      queryFn: appsQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeApps = appsObserver.subscribe(() => {});
    appsQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "app",
      changes: ["apps-changed"],
    });

    await Promise.resolve();
    expect(appsQueryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(appsKey)?.isInvalidated).not.toBe(true);

    unsubscribeApps();
    effects.dispose();
  });

  it("refetches only the changed app's detail and markdown preview queries for app content changes", async () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const appDetailKey = appQueryKey("my-app");
    const markdownPreviewKey = appMarkdownPreviewQueryKey("my-app", "index.md");
    const otherAppDetailKey = appQueryKey("other-app");
    const appsKey = appsQueryKey();
    queryClient.setQueryData(appDetailKey, {});
    queryClient.setQueryData(markdownPreviewKey, {});
    queryClient.setQueryData(otherAppDetailKey, {});
    queryClient.setQueryData(appsKey, []);
    const appDetailQueryFn = vi.fn(async () => ({}));
    const markdownPreviewQueryFn = vi.fn(async () => ({}));
    const otherAppDetailQueryFn = vi.fn(async () => ({}));
    const appsQueryFn = vi.fn(async () => []);
    const appDetailObserver = new QueryObserver(queryClient, {
      queryKey: appDetailKey,
      queryFn: appDetailQueryFn,
      staleTime: Infinity,
    });
    const markdownPreviewObserver = new QueryObserver(queryClient, {
      queryKey: markdownPreviewKey,
      queryFn: markdownPreviewQueryFn,
      staleTime: Infinity,
    });
    const otherAppDetailObserver = new QueryObserver(queryClient, {
      queryKey: otherAppDetailKey,
      queryFn: otherAppDetailQueryFn,
      staleTime: Infinity,
    });
    const appsObserver = new QueryObserver(queryClient, {
      queryKey: appsKey,
      queryFn: appsQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeAppDetail = appDetailObserver.subscribe(() => {});
    const unsubscribeMarkdownPreview = markdownPreviewObserver.subscribe(
      () => {},
    );
    const unsubscribeOtherAppDetail = otherAppDetailObserver.subscribe(
      () => {},
    );
    const unsubscribeApps = appsObserver.subscribe(() => {});
    appDetailQueryFn.mockClear();
    markdownPreviewQueryFn.mockClear();
    otherAppDetailQueryFn.mockClear();
    appsQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "app",
      id: "my-app",
      changes: ["content-changed"],
    });

    await vi.waitFor(() => expect(appDetailQueryFn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(markdownPreviewQueryFn).toHaveBeenCalledTimes(1),
    );
    expect(otherAppDetailQueryFn).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryState(otherAppDetailKey)?.isInvalidated,
    ).not.toBe(true);
    expect(appsQueryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(appsKey)?.isInvalidated).not.toBe(true);

    unsubscribeAppDetail();
    unsubscribeMarkdownPreview();
    unsubscribeOtherAppDetail();
    unsubscribeApps();
    effects.dispose();
  });

  it("falls back to refetching all mounted app detail queries for an app content change without id", async () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const appDetailKey = appQueryKey("my-app");
    const otherAppDetailKey = appQueryKey("other-app");
    queryClient.setQueryData(appDetailKey, {});
    queryClient.setQueryData(otherAppDetailKey, {});
    const appDetailQueryFn = vi.fn(async () => ({}));
    const otherAppDetailQueryFn = vi.fn(async () => ({}));
    const appDetailObserver = new QueryObserver(queryClient, {
      queryKey: appDetailKey,
      queryFn: appDetailQueryFn,
      staleTime: Infinity,
    });
    const otherAppDetailObserver = new QueryObserver(queryClient, {
      queryKey: otherAppDetailKey,
      queryFn: otherAppDetailQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeAppDetail = appDetailObserver.subscribe(() => {});
    const unsubscribeOtherAppDetail = otherAppDetailObserver.subscribe(
      () => {},
    );
    appDetailQueryFn.mockClear();
    otherAppDetailQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "app",
      changes: ["content-changed"],
    });

    await vi.waitFor(() => expect(appDetailQueryFn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(otherAppDetailQueryFn).toHaveBeenCalledTimes(1),
    );

    unsubscribeAppDetail();
    unsubscribeOtherAppDetail();
    effects.dispose();
  });

  it("refetches mounted app detail queries for system apps-changed — the HTML hot-reload chain depends on the detail refetch", async () => {
    const { effects, queryClient } = createRealtimeEffectsTestContext();
    const appDetailKey = appQueryKey("my-app");
    queryClient.setQueryData(appDetailKey, {});
    const appDetailQueryFn = vi.fn(async () => ({}));
    const appDetailObserver = new QueryObserver(queryClient, {
      queryKey: appDetailKey,
      queryFn: appDetailQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeAppDetail = appDetailObserver.subscribe(() => {});
    appDetailQueryFn.mockClear();

    effects.handleChanged({
      type: "changed",
      entity: "system",
      changes: ["apps-changed"],
    });

    await vi.waitFor(() => expect(appDetailQueryFn).toHaveBeenCalledTimes(1));

    unsubscribeAppDetail();
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

  describe("workflow-run changes", () => {
    interface WorkflowRunCacheFixture {
      changedRunAgentOneEventsKey: ReturnType<
        typeof workflowRunAgentEventsQueryKey
      >;
      changedRunAgentTwoEventsKey: ReturnType<
        typeof workflowRunAgentEventsQueryKey
      >;
      changedRunDetailKey: ReturnType<typeof workflowRunQueryKey>;
      changedRunEventsKey: ReturnType<typeof workflowRunEventsQueryKey>;
      otherRunAgentEventsKey: ReturnType<typeof workflowRunAgentEventsQueryKey>;
      otherRunDetailKey: ReturnType<typeof workflowRunQueryKey>;
      runsListKey: ReturnType<typeof workflowRunsQueryKey>;
    }

    function seedWorkflowRunCaches(
      queryClient: ReturnType<
        typeof createRealtimeEffectsTestContext
      >["queryClient"],
    ): WorkflowRunCacheFixture {
      const fixture: WorkflowRunCacheFixture = {
        changedRunDetailKey: workflowRunQueryKey("wfr_changed"),
        changedRunEventsKey: workflowRunEventsQueryKey("wfr_changed"),
        // Agent display indexes are 1-based; the per-run prefix invalidation
        // must cover every mounted drill-in index.
        changedRunAgentOneEventsKey: workflowRunAgentEventsQueryKey({
          agentIndex: 1,
          runId: "wfr_changed",
        }),
        changedRunAgentTwoEventsKey: workflowRunAgentEventsQueryKey({
          agentIndex: 2,
          runId: "wfr_changed",
        }),
        otherRunDetailKey: workflowRunQueryKey("wfr_other"),
        otherRunAgentEventsKey: workflowRunAgentEventsQueryKey({
          agentIndex: 1,
          runId: "wfr_other",
        }),
        runsListKey: workflowRunsQueryKey("project-1"),
      };
      queryClient.setQueryData(fixture.changedRunDetailKey, {});
      queryClient.setQueryData(fixture.changedRunEventsKey, { events: [] });
      queryClient.setQueryData(fixture.changedRunAgentOneEventsKey, []);
      queryClient.setQueryData(fixture.changedRunAgentTwoEventsKey, []);
      queryClient.setQueryData(fixture.otherRunDetailKey, {});
      queryClient.setQueryData(fixture.otherRunAgentEventsKey, []);
      queryClient.setQueryData(fixture.runsListKey, []);
      return fixture;
    }

    it("debounces run-updated into the changed run's detail and the run lists only", () => {
      vi.useFakeTimers();
      const { effects, queryClient } = createRealtimeEffectsTestContext();
      const caches = seedWorkflowRunCaches(queryClient);

      effects.handleChanged({
        type: "changed",
        entity: "workflow-run",
        id: "wfr_changed",
        changes: ["run-updated"],
      });

      // Nothing flushes synchronously: per-batch hub notifications ride the
      // shared debounce window.
      expect(
        queryClient.getQueryState(caches.changedRunDetailKey)?.isInvalidated,
      ).not.toBe(true);

      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(caches.changedRunDetailKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.runsListKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.otherRunDetailKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunEventsKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunAgentOneEventsKey)
          ?.isInvalidated,
      ).not.toBe(true);

      effects.dispose();
    });

    it("scopes events-appended to the run's detail, event stream, and agent-events prefix", () => {
      vi.useFakeTimers();
      const { effects, queryClient } = createRealtimeEffectsTestContext();
      const caches = seedWorkflowRunCaches(queryClient);

      effects.handleChanged({
        type: "changed",
        entity: "workflow-run",
        id: "wfr_changed",
        changes: ["events-appended"],
      });
      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(caches.changedRunDetailKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunEventsKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunAgentOneEventsKey)
          ?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunAgentTwoEventsKey)
          ?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.otherRunDetailKey)?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(caches.otherRunAgentEventsKey)
          ?.isInvalidated,
      ).not.toBe(true);
      expect(
        queryClient.getQueryState(caches.runsListKey)?.isInvalidated,
      ).not.toBe(true);

      effects.dispose();
    });

    it("coalesces an events-appended burst into a single drill-in refetch", async () => {
      vi.useFakeTimers();
      const { effects, queryClient } = createRealtimeEffectsTestContext();
      const caches = seedWorkflowRunCaches(queryClient);
      const agentEventsQueryFn = vi.fn(async () => []);
      const agentEventsObserver = new QueryObserver(queryClient, {
        queryKey: caches.changedRunAgentOneEventsKey,
        queryFn: agentEventsQueryFn,
        staleTime: Infinity,
      });
      const unsubscribeAgentEvents = agentEventsObserver.subscribe(() => {});
      agentEventsQueryFn.mockClear();

      // A wide fan-out delivers one hub message per ingested daemon batch;
      // the mounted drill-in must refetch once per debounce window, not once
      // per message.
      for (let batch = 0; batch < 5; batch += 1) {
        effects.handleChanged({
          type: "changed",
          entity: "workflow-run",
          id: "wfr_changed",
          changes: ["events-appended"],
        });
      }
      await vi.advanceTimersByTimeAsync(50);

      expect(agentEventsQueryFn).toHaveBeenCalledTimes(1);

      unsubscribeAgentEvents();
      effects.dispose();
    });

    it("invalidates seeded workflow-run caches on server reconnect", () => {
      // Realtime messages emitted while the socket was down are lost, and a
      // run that reached terminal during the gap emits nothing afterward —
      // reconnect invalidation is the only recovery path for mounted
      // workflow-run queries.
      const { effects, queryClient } = createRealtimeEffectsTestContext();
      const caches = seedWorkflowRunCaches(queryClient);

      effects.handleConnected({ reconnected: true });

      expect(
        queryClient.getQueryState(caches.changedRunDetailKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.runsListKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunEventsKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunAgentOneEventsKey)
          ?.isInvalidated,
      ).toBe(true);

      effects.dispose();
    });

    it("falls back to invalidating all cached workflow-run queries when the change has no id", () => {
      vi.useFakeTimers();
      const { effects, queryClient } = createRealtimeEffectsTestContext();
      const caches = seedWorkflowRunCaches(queryClient);

      effects.handleChanged({
        type: "changed",
        entity: "workflow-run",
        changes: ["run-updated", "events-appended"],
      });
      vi.advanceTimersByTime(50);

      expect(
        queryClient.getQueryState(caches.changedRunDetailKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.otherRunDetailKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.changedRunEventsKey)?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.otherRunAgentEventsKey)
          ?.isInvalidated,
      ).toBe(true);
      expect(
        queryClient.getQueryState(caches.runsListKey)?.isInvalidated,
      ).toBe(true);

      effects.dispose();
    });
  });
});
