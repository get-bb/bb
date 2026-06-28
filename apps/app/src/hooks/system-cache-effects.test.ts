import { describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import {
  environmentDiffFilesQueryKey,
  environmentDiffPatchQueryKey,
  sidebarNavigationQueryKey,
  systemExecutionOptionsQueryKey,
  threadConversationOutlineQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadSearchQueryKey,
  threadTimelineQueryKey,
} from "./queries/query-keys";
import { invalidateRealtimeQueriesAfterServerReconnect } from "./cache-owners/system-cache-effects";

function createCacheEffectQueryClient() {
  return createAppQueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        retry: false,
      },
    },
    showMutationErrorToasts: false,
  });
}

interface ScopedSystemExecutionOptionsKeyArgs {
  environmentId: string;
}

function scopedSystemExecutionOptionsKey({
  environmentId,
}: ScopedSystemExecutionOptionsKeyArgs) {
  return systemExecutionOptionsQueryKey({
    environmentId,
    providerId: "codex",
  });
}

const EMPTY_EXECUTION_OPTIONS = {
  providers: [],
  models: [],
  selectedOnlyModels: [],
  modelLoadError: null,
};

interface ObservedQuery {
  queryFn: ReturnType<typeof vi.fn<() => Promise<string>>>;
  unsubscribe: () => void;
}

function observeIdleQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
): ObservedQuery {
  const queryFn = vi.fn<() => Promise<string>>().mockResolvedValue("loaded");
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  return {
    queryFn,
    unsubscribe: observer.subscribe(() => {}),
  };
}

async function waitForQueryCalls(
  queries: readonly ObservedQuery[],
  expectedCallCount: number,
): Promise<void> {
  await vi.waitFor(() => {
    for (const query of queries) {
      expect(query.queryFn).toHaveBeenCalledTimes(expectedCallCount);
    }
  });
}

describe("system cache effects", () => {
  it("invalidates canonical active thread caches after reconnect", () => {
    const queryClient = createCacheEffectQueryClient();
    const threadKey = threadQueryKey("thread-1");
    const threadBootstrapKey = threadDetailBootstrapQueryKey("thread-1");
    const timelineKey = threadTimelineQueryKey("thread-1");
    const conversationOutlineKey =
      threadConversationOutlineQueryKey("thread-1");
    const queuedMessagesKey = threadQueuedMessagesQueryKey("thread-1");
    const promptHistoryKey = threadPromptHistoryQueryKey("thread-1");
    const pendingInteractionsKey =
      threadPendingInteractionsQueryKey("thread-1");
    const threadSearchKey = threadSearchQueryKey({
      limitPerGroup: 20,
      query: "needle",
    });
    const defaultExecutionOptionsKey =
      threadDefaultExecutionOptionsQueryKey("thread-1");
    const executionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(threadKey, { id: "thread-1" });
    queryClient.setQueryData(threadBootstrapKey, { id: "thread-1" });
    queryClient.setQueryData(timelineKey, { rows: [] });
    queryClient.setQueryData(conversationOutlineKey, { items: [] });
    queryClient.setQueryData(queuedMessagesKey, []);
    queryClient.setQueryData(promptHistoryKey, []);
    queryClient.setQueryData(pendingInteractionsKey, []);
    queryClient.setQueryData(threadSearchKey, {
      active: { results: [], total: 0 },
      archived: { results: [], total: 0 },
    });
    queryClient.setQueryData(
      defaultExecutionOptionsKey,
      EMPTY_EXECUTION_OPTIONS,
    );
    queryClient.setQueryData(executionOptionsKey, EMPTY_EXECUTION_OPTIONS);
    queryClient.setQueryData(sidebarNavigationKey, {
      projects: [],
      personalProject: { threads: [] },
    });

    invalidateRealtimeQueriesAfterServerReconnect({ queryClient });

    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(threadBootstrapKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(timelineKey)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(conversationOutlineKey)?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(queuedMessagesKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(promptHistoryKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(pendingInteractionsKey)?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(threadSearchKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(defaultExecutionOptionsKey)?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(executionOptionsKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(sidebarNavigationKey)?.isInvalidated).toBe(
      true,
    );
  });

  it("refetches active thread bundle queries together after reconnect", async () => {
    const queryClient = createCacheEffectQueryClient();
    queryClient.mount();
    const activeThreadQueries = [
      observeIdleQuery(queryClient, threadQueryKey("thread-1")),
      observeIdleQuery(queryClient, threadDetailBootstrapQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadDefaultExecutionOptionsQueryKey("thread-1"),
      ),
      observeIdleQuery(queryClient, threadQueuedMessagesQueryKey("thread-1")),
      observeIdleQuery(queryClient, threadPromptHistoryQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadPendingInteractionsQueryKey("thread-1"),
      ),
      observeIdleQuery(queryClient, threadTimelineQueryKey("thread-1")),
      observeIdleQuery(
        queryClient,
        threadConversationOutlineQueryKey("thread-1"),
      ),
    ];

    await waitForQueryCalls(activeThreadQueries, 1);

    invalidateRealtimeQueriesAfterServerReconnect({ queryClient });

    await waitForQueryCalls(activeThreadQueries, 2);

    for (const query of activeThreadQueries) {
      query.unsubscribe();
    }
    queryClient.unmount();
    queryClient.clear();
  });

  it("refetches an active diff TOC query but evicts the observer-less patch cache after reconnect", async () => {
    const queryClient = createCacheEffectQueryClient();
    const diffFilesKey = environmentDiffFilesQueryKey("env-1", "all", "main");
    const diffPatchKey = environmentDiffPatchQueryKey(
      "env-1",
      "all",
      "main",
      "file.ts",
    );
    queryClient.setQueryData(diffFilesKey, {
      outcome: "available",
      files: [],
      shortstat: "1 file changed",
      mergeBaseRef: "base-ref",
    });
    // Seeded like production: no observer, no queryFn — the patch cache is
    // imperative, so invalidation can never refresh it.
    queryClient.setQueryData(diffPatchKey, {
      path: "file.ts",
      patch: "diff --git a/file.ts b/file.ts\n",
      truncated: false,
    });
    const diffFilesQueryFn = vi.fn(async () => ({
      outcome: "available" as const,
      files: [],
      shortstat: "",
      mergeBaseRef: "base-ref",
    }));
    const diffFilesObserver = new QueryObserver(queryClient, {
      queryKey: diffFilesKey,
      queryFn: diffFilesQueryFn,
      staleTime: Infinity,
    });
    const unsubscribeDiffFiles = diffFilesObserver.subscribe(() => {});
    diffFilesQueryFn.mockClear();

    invalidateRealtimeQueriesAfterServerReconnect({ queryClient });

    // The TOC has an observer, so reconnect invalidation refetches it.
    await vi.waitFor(() =>
      expect(diffFilesQueryFn).toHaveBeenCalledTimes(1),
    );
    // The observer-less patch entry is evicted so a stale patch can't survive
    // the reconnect.
    expect(queryClient.getQueryData(diffPatchKey)).toBeUndefined();

    unsubscribeDiffFiles();
  });
});
