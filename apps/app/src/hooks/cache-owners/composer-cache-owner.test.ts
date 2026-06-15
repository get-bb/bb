import type {
  SystemExecutionOptionsResponse,
  ThreadComposerBootstrapResponse,
} from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import {
  systemExecutionOptionsQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueuedMessagesQueryKey,
} from "../queries/query-keys";
import { hydrateThreadComposerBootstrap } from "./composer-cache-owner";

const EXISTING_EXECUTION_OPTIONS: SystemExecutionOptionsResponse = {
  providers: [
    {
      id: "codex",
      displayName: "Codex",
      available: true,
      capabilities: {
        supportsArchive: true,
        supportsRename: true,
        supportsServiceTier: true,
        supportsUserQuestion: true,
        supportedPermissionModes: ["full", "workspace-write", "readonly"],
      },
    },
  ],
  models: [
    {
      id: "gpt-5.5",
      model: "gpt-5.5",
      displayName: "GPT-5.5",
      description: "Frontier model",
      supportedReasoningEfforts: [
        {
          reasoningEffort: "medium",
          description: "Balanced",
        },
      ],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  selectedOnlyModels: [],
  modelLoadError: null,
};

const NULL_EXECUTION_BOOTSTRAP: ThreadComposerBootstrapResponse = {
  defaultExecutionOptions: null,
  queuedMessages: [],
  executionOptions: null,
  pendingInteractions: [],
  promptHistory: [],
};

describe("composer cache owner", () => {
  it("does not clobber new-thread system execution options for an environmentless archived bootstrap", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const executionOptionsKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      providerId: "codex",
    });
    queryClient.setQueryData(executionOptionsKey, EXISTING_EXECUTION_OPTIONS);

    hydrateThreadComposerBootstrap({
      bootstrap: NULL_EXECUTION_BOOTSTRAP,
      environmentId: null,
      providerId: "codex",
      queryClient,
      threadId: "thread-1",
    });

    expect(queryClient.getQueryData(executionOptionsKey)).toEqual(
      EXISTING_EXECUTION_OPTIONS,
    );
    expect(
      queryClient.getQueryData(
        threadDefaultExecutionOptionsQueryKey("thread-1"),
      ),
    ).toBeNull();
    expect(
      queryClient.getQueryData(threadQueuedMessagesQueryKey("thread-1")),
    ).toEqual([]);
    expect(
      queryClient.getQueryData(threadPromptHistoryQueryKey("thread-1")),
    ).toEqual([]);
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("thread-1")),
    ).toEqual([]);
  });

  it("does not create a shared system execution options key when an environmentless bootstrap skipped resolution", () => {
    const queryClient = createAppQueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
      showMutationErrorToasts: false,
    });
    const executionOptionsKey = systemExecutionOptionsQueryKey({
      environmentId: null,
      providerId: "codex",
    });

    hydrateThreadComposerBootstrap({
      bootstrap: NULL_EXECUTION_BOOTSTRAP,
      environmentId: null,
      providerId: "codex",
      queryClient,
      threadId: "archived-thread-1",
    });

    expect(queryClient.getQueryState(executionOptionsKey)).toBeUndefined();
    expect(
      queryClient.getQueryData(
        threadDefaultExecutionOptionsQueryKey("archived-thread-1"),
      ),
    ).toBeNull();
  });
});
