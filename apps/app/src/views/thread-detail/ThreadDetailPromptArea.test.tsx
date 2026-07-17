// @vitest-environment jsdom

import type {
  ResolvedThreadExecutionOptions,
  ThreadQueuedMessage,
  ThreadTimelineModelFallback,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY } from "@/lib/thread-handoff-request";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

const mocks = vi.hoisted(() => ({
  createQueuedMessageMutateAsync: vi.fn(),
  defaultExecutionOptions: null as ResolvedThreadExecutionOptions | null,
  deleteQueuedMessageMutateAsync: vi.fn(),
  navigate: vi.fn(),
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
  setQueuedMessageGroupBoundaryMutateAsync: vi.fn(),
  stopThreadMutate: vi.fn(),
  unarchiveThreadMutate: vi.fn(),
  uploadPromptAttachmentMutateAsync: vi.fn(),
  updateQueuedMessageMutateAsync: vi.fn(),
  useThreadDefaultExecutionOptions: vi.fn(),
  useThreadCreationOptions: vi.fn(),
  useThreadPromptHistory: vi.fn(),
  useThreadQueuedMessages: vi.fn(),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({
    composer,
    execution,
    stack,
  }: {
    composer: {
      message: string;
      onChangeMessage: (message: string, mentions: []) => void;
      onSubmit: () => void;
      submitMode: { kind: string; reason?: string };
    } | null;
    execution: {
      footerAction?: {
        label: string;
        onClick: () => void;
      };
      model: {
        active?: { model: string } | null;
      };
    };
    stack: ReactNode;
  }) => (
    <div data-testid="follow-up-prompt-box">
      <div data-testid="submit-mode">
        {composer?.submitMode.kind}:{composer?.submitMode.reason ?? ""}
      </div>
      <div data-testid="selected-model">{execution.model.active?.model}</div>
      {composer ? (
        <>
          <input
            aria-label="Composer message"
            value={composer.message}
            onChange={(event) =>
              composer.onChangeMessage(event.currentTarget.value, [])
            }
          />
          <button type="button" onClick={composer.onSubmit}>
            Submit composer
          </button>
        </>
      ) : null}
      {execution.footerAction ? (
        <button type="button" onClick={execution.footerAction.onClick}>
          {execution.footerAction.label}
        </button>
      ) : null}
      {stack}
    </div>
  ),
}));

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => <div />,
}));

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: ({
    queuedMessages,
    onEdit,
  }: {
    queuedMessages: readonly ThreadQueuedMessage[];
    onEdit: (request: {
      queuedMessageId: string;
      queuedMessageIndex: number;
    }) => void;
  }) => (
    <div>
      <div data-testid="queued-message-count">{queuedMessages.length}</div>
      {queuedMessages[0] ? (
        <button
          type="button"
          onClick={() =>
            onEdit({
              queuedMessageId: queuedMessages[0]!.id,
              queuedMessageIndex: 0,
            })
          }
        >
          Edit first queued message
        </button>
      ) : null}
    </div>
  ),
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

vi.mock(
  "@/components/thread/pending-interactions/ThreadPendingInteractionBanner",
  () => ({
    ThreadPendingInteractionBanner: () => null,
  }),
);

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
  useThreadCreationOptions: (options: unknown) => {
    mocks.useThreadCreationOptions(options);
    return {
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
    };
  },
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
  useSetThreadQueuedMessageGroupBoundary: () => ({
    isPending: false,
    mutateAsync: mocks.setQueuedMessageGroupBoundaryMutateAsync,
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
  useUpdateThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.updateQueuedMessageMutateAsync,
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
      data: mocks.defaultExecutionOptions,
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
    groupWithNext: false,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    archivedAt: null,
    environmentId: null,
    id: "thr_1",
    projectId: "proj_1",
    providerId: "codex",
    runtime: { displayStatus: "idle" },
    status: "idle",
    ...overrides,
  } as ThreadWithRuntime;
}

interface RenderPromptAreaOptions {
  modelFallback?: ThreadTimelineModelFallback | null;
  pendingInteractionsInitialLoading?: boolean;
  thread?: ThreadWithRuntime;
}

function renderPromptArea({
  modelFallback = null,
  pendingInteractionsInitialLoading = false,
  thread = makeThread(),
}: RenderPromptAreaOptions = {}) {
  return render(
    <ThreadDetailPromptArea
      activeBackgroundCommands={[]}
      activePromptMode={null}
      activeWorkflow={null}
      canUseGitUi={false}
      childThreadsSection={null}
      composerFocusRequestNonce={0}
      contextBannerMergeBase={null}
      environmentGoneStatus={null}
      goal={null}
      modelFallback={modelFallback}
      isEnvironmentActionPending={false}
      onChangedFileClick={vi.fn()}
      openThreadDiffPanel={vi.fn()}
      parentThreadSection={null}
      pendingInteractions={[]}
      pendingInteractionsInitialLoading={pendingInteractionsInitialLoading}
      pendingTodos={null}
      projectId="proj_1"
      pullRequest={null}
      pullRequestMergeMethod="squash"
      resolveMentionLink={() => null}
      sendMessage={{
        isPending: false,
        mutateAsync: vi.fn(),
      }}
      thread={thread}
      workspaceChangedFilesSection={null}
      workspaceStatusPending={false}
    />,
  );
}

beforeEach(() => {
  mocks.defaultExecutionOptions = null;
  mocks.promptDraft.text = "";
  mocks.queuedMessages = [];
  mocks.updateQueuedMessageMutateAsync.mockResolvedValue(undefined);
  mocks.useThreadCreationOptions.mockClear();
  mocks.useThreadDefaultExecutionOptions.mockClear();
  mocks.useThreadPromptHistory.mockClear();
  mocks.useThreadQueuedMessages.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea", () => {
  it("uses the real thread cache keys immediately", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();

    expect(mocks.useThreadDefaultExecutionOptions).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadPromptHistory).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadQueuedMessages).toHaveBeenCalledWith(
      "thr_1",
      expect.objectContaining({ enabled: true }),
    );
    expect(mocks.useThreadCreationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        environmentId: undefined,
        scope: "component-local",
      }),
    );
    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
  });

  it("updates an inline-edited queue item without touching the bottom draft", async () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "readonly",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Keep this bottom draft";
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit first queued message" }),
    );

    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Already queued");
    fireEvent.change(
      screen.getByRole("textbox", { name: "Composer message" }),
      { target: { value: "Edited queued message" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));

    await waitFor(() => {
      expect(mocks.updateQueuedMessageMutateAsync).toHaveBeenCalledWith({
        id: "thr_1",
        input: [{ type: "text", text: "Edited queued message", mentions: [] }],
        queuedMessageId: "qmsg_1",
      });
    });
    expect(mocks.deleteQueuedMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();
    expect(mocks.promptDraft.text).toBe("Keep this bottom draft");
    await waitFor(() => {
      expect(
        (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLTextAreaElement
        ).value,
      ).toBe("Keep this bottom draft");
    });
  });

  it("blocks submit while pending interactions are initially unknown", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "readonly",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };

    renderPromptArea({
      pendingInteractionsInitialLoading: true,
      thread: makeThread({ environmentId: "env_1" }),
    });

    expect(screen.getByTestId("submit-mode").textContent).toBe(
      "blocked:loading-pending-interactions",
    );
  });

  it("selects the provider fallback model for the next turn", () => {
    mocks.defaultExecutionOptions = {
      model: "claude-fable-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };

    renderPromptArea({
      modelFallback: {
        sourceSeq: 42,
        detectedAt: 123,
        originalModel: "claude-fable-5",
        fallbackModel: "claude-opus-4-8",
        reason: "refusal",
        message: "Switched to Opus.",
      },
    });

    expect(mocks.useThreadCreationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ initialModel: "claude-opus-4-8" }),
    );
    expect(screen.getByTestId("selected-model").textContent).toBe(
      "claude-opus-4-8",
    );
    expect(screen.getByText("Model fallback")).toBeTruthy();
  });

  it("opens root compose with a handoff seed for the current thread", () => {
    renderPromptArea({
      thread: makeThread({
        environmentId: "env_1",
        id: "thr_source",
        projectId: "proj_source",
        title: "Source thread",
        titleFallback: null,
      }),
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Handoff to new thread" }),
    );

    expect(mocks.navigate).toHaveBeenCalledWith("/projects/proj_source", {
      state: {
        focusPrompt: true,
        reuseEnvironmentId: "env_1",
        [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: {
          environmentId: "env_1",
          projectId: "proj_source",
          sourceThreadId: "thr_source",
          sourceThreadTitle: "Source thread",
        },
      },
    });
  });
});
