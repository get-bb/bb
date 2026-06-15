import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  sidebarNavigationQueryKey,
  systemExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
} from "./queries/query-keys";
import { threadDefaultExecutionOptionsQueryKey } from "./queries/thread-default-execution-options-query";
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
});
