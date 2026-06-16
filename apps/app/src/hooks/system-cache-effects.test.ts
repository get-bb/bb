import { describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import {
  environmentDiffFilesQueryKey,
  environmentDiffPatchQueryKey,
  sidebarNavigationQueryKey,
  systemExecutionOptionsQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
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

describe("system cache effects", () => {
  it("invalidates canonical composer caches after reconnect", () => {
    const queryClient = createCacheEffectQueryClient();
    const queuedMessagesKey = threadQueuedMessagesQueryKey("thread-1");
    const promptHistoryKey = threadPromptHistoryQueryKey("thread-1");
    const pendingInteractionsKey =
      threadPendingInteractionsQueryKey("thread-1");
    const defaultExecutionOptionsKey =
      threadDefaultExecutionOptionsQueryKey("thread-1");
    const executionOptionsKey = scopedSystemExecutionOptionsKey({
      environmentId: "env-1",
    });
    const sidebarNavigationKey = sidebarNavigationQueryKey();
    queryClient.setQueryData(queuedMessagesKey, []);
    queryClient.setQueryData(promptHistoryKey, []);
    queryClient.setQueryData(pendingInteractionsKey, []);
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

    expect(queryClient.getQueryState(queuedMessagesKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(promptHistoryKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(pendingInteractionsKey)?.isInvalidated,
    ).toBe(true);
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
