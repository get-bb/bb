// @vitest-environment jsdom

import type { ThreadQueuedMessage, ThreadWithRuntime } from "@bb/domain";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

const mocks = vi.hoisted(() => ({
  createQueuedMessageMutateAsync: vi.fn(),
  deleteQueuedMessageMutateAsync: vi.fn(),
  promptDraft: {
    addAttachment: vi.fn(),
    attachments: [],
    clearIfCurrentMatches: vi.fn(),
    mentions: [],
    removeAttachment: vi.fn(),
    restoreIfEmpty: vi.fn(),
    setDraft: vi.fn(),
    setTextAndMentions: vi.fn(),
    text: "",
  },
  queuedMessages: [] as ThreadQueuedMessage[],
  reorderQueuedMessageMutateAsync: vi.fn(),
  sendQueuedMessageMutateAsync: vi.fn(),
  stopThreadMutate: vi.fn(),
  unarchiveThreadMutate: vi.fn(),
  uploadPromptAttachmentMutateAsync: vi.fn(),
  useThreadDefaultExecutionOptions: vi.fn(),
  useThreadPromptHistory: vi.fn(),
  useThreadQueuedMessages: vi.fn(),
}));

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({ stack }: { stack: ReactNode }) => (
    <div data-testid="follow-up-prompt-box">{stack}</div>
  ),
}));

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => <div />,
}));

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: ({
    queuedMessages,
  }: {
    queuedMessages: readonly ThreadQueuedMessage[];
  }) => <div data-testid="queued-message-count">{queuedMessages.length}</div>,
}));

vi.mock("@/components/promptbox/banner/ThreadBackgroundCommandsCard", () => ({
  ThreadBackgroundCommandsCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadGoalCard", () => ({
  ThreadGoalCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadPromptContextBanner", () => ({
  ThreadPromptContextBanner: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadPromptModeCard", () => ({
  ThreadPromptModeCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadTodoCard", () => ({
  ThreadTodoCard: () => null,
}));

vi.mock("@/components/promptbox/banner/ThreadWorkflowCard", () => ({
  ThreadWorkflowCard: () => null,
}));

vi.mock("@/components/thread/pending-interactions/ThreadPendingInteractionBanner", () => ({
  ThreadPendingInteractionBanner: () => null,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    hasMore: false,
    isError: false,
    isLoading: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
    suggestions: [],
    trigger: null,
  }),
}));

vi.mock("@/hooks/useEscapeToHide", () => ({
  useEscapeToHide: () => undefined,
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: () => mocks.promptDraft,
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    isError: false,
    isLoading: false,
    setQuery: vi.fn(),
    suggestions: [],
  }),
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: null,
    executionInputSources: {},
    hasMultipleProviders: false,
    isLoadingModels: false,
    modelLoadError: null,
    modelLoadFailed: false,
    modelOptions: [],
    moreModelOptions: [],
    permissionMode: "readonly",
    permissionModeOptions: [],
    providerOptions: [],
    reasoningLevel: "medium",
    reasoningOptions: [],
    selectedModel: "gpt-5",
    selectedProviderComposerActions: [],
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    setPermissionMode: vi.fn(),
    setReasoningLevel: vi.fn(),
    setSelectedModel: vi.fn(),
    setServiceTier: vi.fn(),
    supportsPermissionModeSelection: true,
    supportsServiceTier: false,
  }),
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    isPending: false,
    mutateAsync: mocks.uploadPromptAttachmentMutateAsync,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.createQueuedMessageMutateAsync,
  }),
  useDeleteThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.deleteQueuedMessageMutateAsync,
  }),
  useReorderThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.reorderQueuedMessageMutateAsync,
  }),
  useSendThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.sendQueuedMessageMutateAsync,
  }),
  useStopThread: () => ({
    isPending: false,
    mutate: mocks.stopThreadMutate,
    variables: null,
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useUnarchiveThread: () => ({
    isPending: false,
    mutate: mocks.unarchiveThreadMutate,
    variables: null,
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useProjectDisplayName: () => null,
}));

vi.mock("@/hooks/queries/thread-default-execution-options-query", () => ({
  useThreadDefaultExecutionOptions: (threadId: string, options: unknown) => {
    mocks.useThreadDefaultExecutionOptions(threadId, options);
    return {
      data: undefined,
      isError: false,
    };
  },
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  getLatestPendingInteraction: () => null,
  useThreadPromptHistory: (threadId: string, options: unknown) => {
    mocks.useThreadPromptHistory(threadId, options);
    return { data: [] };
  },
  useThreadQueuedMessages: (threadId: string, options: unknown) => {
    mocks.useThreadQueuedMessages(threadId, options);
    return { data: mocks.queuedMessages };
  },
}));

function makeQueuedMessage(): ThreadQueuedMessage {
  return {
    id: "qmsg_1",
    content: [{ type: "text", text: "Already queued", mentions: [] }],
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "readonly",
    serviceTier: "default",
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeThread(): ThreadWithRuntime {
  return {
    archivedAt: null,
    environmentId: null,
    id: "thr_1",
    projectId: "proj_1",
    providerId: "codex",
    runtime: { displayStatus: "idle" },
    status: "idle",
  } as ThreadWithRuntime;
}

function renderPromptArea({
  composerQueriesEnabled,
}: {
  composerQueriesEnabled: boolean;
}) {
  return render(
    <ThreadDetailPromptArea
      activeBackgroundCommands={[]}
      activePromptMode={null}
      activeWorkflow={null}
      canUseGitUi={false}
      childThreadsSection={null}
      composerFocusRequestNonce={0}
      composerQueriesEnabled={composerQueriesEnabled}
      contextBannerMergeBase={null}
      environmentGoneStatus={null}
      goal={null}
      isEnvironmentActionPending={false}
      onChangedFileClick={vi.fn()}
      openThreadDiffPanel={vi.fn()}
      parentThreadSection={null}
      pendingInteractions={[]}
      pendingTodos={null}
      projectId="proj_1"
      pullRequest={null}
      pullRequestMergeMethod="squash"
      resolveMentionLink={() => null}
      sendMessage={{
        isPending: false,
        mutateAsync: vi.fn(),
      }}
      thread={makeThread()}
      workspaceChangedFilesSection={null}
      workspaceStatusPending={false}
    />,
  );
}

beforeEach(() => {
  mocks.queuedMessages = [];
  mocks.useThreadDefaultExecutionOptions.mockClear();
  mocks.useThreadPromptHistory.mockClear();
  mocks.useThreadQueuedMessages.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea", () => {
  it("uses the real thread cache keys before composer bootstrap is ready", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea({ composerQueriesEnabled: false });

    expect(mocks.useThreadDefaultExecutionOptions).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: false }),
    );
    expect(mocks.useThreadPromptHistory).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadQueuedMessages).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
  });
});
