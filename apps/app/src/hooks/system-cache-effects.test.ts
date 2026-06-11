import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  sidebarNavigationQueryKey,
  systemExecutionOptionsQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
  workflowRunAgentEventsQueryKey,
  workflowRunEventsQueryKey,
  workflowRunQueryKey,
  workflowRunsQueryKey,
  workflowsQueryKey,
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

  it("invalidates workflow caches after reconnect", () => {
    // Workflow runs are realtime-fed: a run reaching terminal while the
    // socket was down emits nothing afterward, so reconnect invalidation is
    // the only recovery path for an already-mounted run page or Workflows
    // tab — without it the run renders frozen at `running` indefinitely.
    const queryClient = createCacheEffectQueryClient();
    const runDetailKey = workflowRunQueryKey("wfr_1");
    const runsListKey = workflowRunsQueryKey("project-1");
    const runEventsKey = workflowRunEventsQueryKey("wfr_1");
    const agentEventsKey = workflowRunAgentEventsQueryKey({
      agentIndex: 1,
      runId: "wfr_1",
    });
    const workflowsKey = workflowsQueryKey("project-1");
    queryClient.setQueryData(runDetailKey, {});
    queryClient.setQueryData(runsListKey, []);
    queryClient.setQueryData(runEventsKey, []);
    queryClient.setQueryData(agentEventsKey, []);
    queryClient.setQueryData(workflowsKey, []);

    invalidateRealtimeQueriesAfterServerReconnect({ queryClient });

    expect(queryClient.getQueryState(runDetailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(runsListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(runEventsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(agentEventsKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(workflowsKey)?.isInvalidated).toBe(true);
  });
});
