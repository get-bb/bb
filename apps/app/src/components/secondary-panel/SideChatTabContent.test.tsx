// @vitest-environment jsdom

import type { Thread } from "@bb/domain";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FollowUpComposerProps } from "@/components/promptbox/FollowUpPromptBox";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { SideChatTabContent } from "./SideChatTabContent";

const mocks = vi.hoisted(() => ({
  commandSuggestionArgs: [] as unknown[],
  createThreadMutateAsync: vi.fn(),
  defaultExecutionOptionsThreadIds: [] as string[],
  noopMutate: vi.fn(),
  noopMutateAsync: vi.fn(),
  promptMentionArgs: [] as unknown[],
  promptMentionSetQuery: vi.fn(),
  sendThreadMessageMutateAsync: vi.fn(),
  threadCreationReasoningLevel: "medium",
  threadCreationSelectedModel: "gpt-5",
  threadCreationServiceTier: undefined as "default" | "fast" | undefined,
  threadTimelineRows: [] as unknown[],
  timelineRowsProps: [] as Array<{
    onSendToMainMessage?: (target: { messageText: string }) => void;
  }>,
  threadRuntimeDisplayStatus: "idle",
  uploadPromptAttachmentMutateAsync: vi.fn(),
}));

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({
    attachments,
    composer,
    execution,
    focusEndKey,
    permissionReadOnly,
    readOnly,
    stack,
    typeahead,
  }: {
    attachments: {
      onAttachFiles?: (files: File[]) => void | Promise<void>;
    };
    composer: Pick<
      FollowUpComposerProps,
      | "canModifierSubmit"
      | "message"
      | "onChangeMessage"
      | "onModifierSubmit"
      | "onSubmit"
    >;
    execution: {
      model: {
        onChange: (value: string) => void;
        selected: string;
      };
      reasoning: {
        onChange: (value: "high") => void;
      };
      serviceTier?: {
        onChange: (value: "fast") => void;
      };
    };
    focusEndKey?: string | number;
    permissionReadOnly?: boolean;
    readOnly?: boolean;
    typeahead: {
      command: {
        onQueryChange: (query: string | null) => void;
        trigger: string | null;
      };
      mention: {
        onQueryChange: (query: string | null) => void;
      };
    };
    stack: ReactNode | null;
  }) => (
    <div>
      <input
        data-testid="side-chat-composer"
        data-focus-end-key={focusEndKey}
        value={composer.message}
        onChange={(event) => composer.onChangeMessage(event.target.value, [])}
      />
      <button type="button" onClick={composer.onSubmit}>
        Send
      </button>
      <button type="button" onClick={() => execution.model.onChange("o4-mini")}>
        Use o4-mini
      </button>
      <button
        type="button"
        onClick={() => execution.reasoning.onChange("high")}
      >
        Use high reasoning
      </button>
      <button
        type="button"
        onClick={() => execution.serviceTier?.onChange("fast")}
      >
        Use fast mode
      </button>
      <button
        type="button"
        onClick={() =>
          void attachments.onAttachFiles?.([
            new File(["hello"], "note.md", { type: "text/markdown" }),
          ])
        }
      >
        Attach
      </button>
      <button
        type="button"
        onClick={() => typeahead.mention.onQueryChange("readme")}
      >
        Mention query
      </button>
      <button
        type="button"
        onClick={() => typeahead.command.onQueryChange("review")}
      >
        Command query
      </button>
      <span data-testid="command-trigger">{typeahead.command.trigger}</span>
      <span data-testid="side-chat-stack-state">
        {stack === null ? "null" : "provided"}
      </span>
      <span data-testid="side-chat-selected-model">
        {execution.model.selected}
      </span>
      <span data-testid="side-chat-read-only">
        {readOnly ? "true" : "false"}
      </span>
      <span data-testid="side-chat-permission-read-only">
        {permissionReadOnly ? "true" : "false"}
      </span>
      <button
        type="button"
        disabled={!composer.canModifierSubmit}
        onClick={composer.onModifierSubmit}
      >
        Steer
      </button>
    </div>
  ),
}));

vi.mock("@/components/promptbox/ThreadEnvironmentSummary", () => ({
  ThreadEnvironmentSummary: () => <div />,
}));

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: () => <div />,
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body", () => ({
  BottomAnchoredScrollBody: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

vi.mock("@/components/thread/timeline", () => ({
  isRunningThreadRuntimeDisplayStatus: (status: string) => status === "active",
  ThreadTimelinePanelContent: (props: {
    isTurnSubmitting?: boolean;
    leadingContent?: ReactNode;
    onSendToMainMessage?: (target: { messageText: string }) => void;
    provisioningLabel?: string;
    timeline: { timelineRows: Array<{ text?: string }> };
  }) => {
    if (props.timeline.timelineRows.length > 0) {
      mocks.timelineRowsProps.push({
        onSendToMainMessage: props.onSendToMainMessage,
      });
    }
    return (
      <div>
        {props.leadingContent}
        {props.timeline.timelineRows.map((row, index) => (
          <div key={index} data-testid="side-chat-timeline-row">
            {row.text}
          </div>
        ))}
        {mocks.threadRuntimeDisplayStatus === "provisioning" ? (
          <div>{props.provisioningLabel ?? "Provisioning thread..."}</div>
        ) : props.isTurnSubmitting ? (
          <div>Working</div>
        ) : null}
      </div>
    );
  },
  ThreadTimelineSurface: (props: {
    leadingContent?: ReactNode;
    ongoingIndicatorLabel?: string;
    showOngoingIndicator: boolean;
    timelineRows: Array<{ text?: string }>;
  }) => (
    <div>
      {props.leadingContent}
      {props.timelineRows.map((row, index) => (
        <div key={index} data-testid="side-chat-timeline-row">
          {row.text}
        </div>
      ))}
      {props.showOngoingIndicator ? (
        <div>{props.ongoingIndicatorLabel ?? "Working"}</div>
      ) : null}
    </div>
  ),
  ThreadTimelineRows: (props: {
    onSendToMainMessage?: (target: { messageText: string }) => void;
  }) => {
    mocks.timelineRowsProps.push(props);
    return <div data-testid="side-chat-timeline-rows" />;
  },
  TimelineStatusIndicator: ({ label }: { label: string }) => <div>{label}</div>,
  TimelineWorkingIndicator: ({ label }: { label?: string }) => (
    <div>{label ?? "Working"}</div>
  ),
  useThreadTimelineController: () => ({
    activePromptMode: null,
    activeThinking: null,
    activeWorkflow: null,
    activeBackgroundCommands: [],
    contextWindowUsage: undefined,
    goal: null,
    hasOlderTimelineRows: false,
    isLoadingOlderTimelineRows: false,
    loadOlderTimelineRows: vi.fn(),
    pendingTodos: null,
    timelineError: null,
    timelineLoading: false,
    timelineRows: mocks.threadTimelineRows,
  }),
}));

vi.mock("@/components/ui/height-transition.js", () => ({
  HeightTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@bb/shared-ui/icon", () => ({
  Icon: () => <span />,
}));

vi.mock("@/components/ui/overflow-fade", () => ({
  OverflowFade: () => null,
}));

vi.mock("@bb/shared-ui/skeleton", () => ({
  Skeleton: () => <div />,
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

vi.mock("@/hooks/useTheme", () => ({
  usePreferredTheme: () => "light",
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ isLocalDaemonHost: () => true }),
}));

vi.mock("@/hooks/useThreadCreationOptions", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useThreadCreationOptions: () => {
      const [selectedModel, setSelectedModel] = React.useState(
        mocks.threadCreationSelectedModel,
      );
      const [reasoningLevel, setReasoningLevel] = React.useState(
        mocks.threadCreationReasoningLevel,
      );
      const [serviceTier, setServiceTier] = React.useState(
        mocks.threadCreationServiceTier,
      );
      return {
        activeModel: { model: selectedModel },
        hasMultipleProviders: false,
        isLoadingModels: false,
        modelLoadError: null,
        modelLoadFailed: false,
        modelOptions: [
          { value: "gpt-5", label: "GPT-5" },
          { value: "o4-mini", label: "o4-mini" },
        ],
        permissionModeOptions: [],
        providerOptions: [],
        reasoningLevel,
        reasoningOptions: [
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
        selectedModel,
        selectedProviderComposerActions: [{ kind: "skills", trigger: "/" }],
        selectedProviderDisplayName: "Codex",
        selectedProviderId: "codex",
        serviceTier,
        serviceTierSupportByProvider: {},
        setReasoningLevel,
        setSelectedModel,
        setServiceTier,
        supportsPermissionModeSelection: true,
        supportsServiceTier: true,
      };
    },
  };
});

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: (projectId: string | undefined, options: unknown) => {
    mocks.promptMentionArgs.push({ options, projectId });
    return {
      suggestions: [],
      isLoading: false,
      isError: false,
      setQuery: mocks.promptMentionSetQuery,
    };
  },
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: (args: { skillsTrigger?: "/" | null }) => {
    mocks.commandSuggestionArgs.push(args);
    return {
      trigger: args.skillsTrigger ?? null,
      suggestions: [],
      isLoading: false,
      isError: false,
      hasMore: false,
      isLoadingMore: false,
      loadMore: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({
    data: {
      environmentId: null,
      runtime: {
        displayStatus: mocks.threadRuntimeDisplayStatus,
      },
      status: mocks.threadRuntimeDisplayStatus === "active" ? "active" : "idle",
    },
    error: null,
    status: "success",
  }),
  useThreadQueuedMessages: () => ({ data: [] }),
  useThreadTimeline: () => ({
    data: { activeThinking: null, rows: mocks.threadTimelineRows },
    isError: false,
    isPending: false,
  }),
}));

vi.mock("@/hooks/queries/thread-default-execution-options-query", () => ({
  useThreadDefaultExecutionOptions: (threadId: string) => {
    mocks.defaultExecutionOptionsThreadIds.push(threadId);
    return {
      data: {
        model: "gpt-5",
        reasoningLevel: "medium",
        serviceTier: undefined,
      },
      isLoading: false,
    };
  },
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThread: () => ({ mutateAsync: mocks.createThreadMutateAsync }),
  useCreateThreadQueuedMessage: () => ({
    isPending: false,
    mutate: mocks.noopMutate,
    mutateAsync: mocks.noopMutateAsync,
  }),
  useDeleteThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
  useReorderThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
  useSetThreadQueuedMessageGroupBoundary: () => ({
    mutateAsync: mocks.noopMutateAsync,
  }),
  useSendThreadMessage: () => ({
    isPending: false,
    mutate: mocks.noopMutate,
    mutateAsync: mocks.sendThreadMessageMutateAsync,
  }),
  useSendThreadQueuedMessage: () => ({
    isPending: false,
    mutateAsync: mocks.noopMutateAsync,
  }),
  useStopThread: () => ({
    isPending: false,
    mutate: mocks.noopMutate,
    variables: null,
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMarkThreadRead: () => ({ mutate: mocks.noopMutate }),
}));

vi.mock("@/hooks/useThreadReadTracking", () => ({
  useThreadReadTracking: () => undefined,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    isPending: false,
    mutateAsync: mocks.uploadPromptAttachmentMutateAsync,
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mocks.commandSuggestionArgs.length = 0;
  mocks.defaultExecutionOptionsThreadIds.length = 0;
  mocks.promptMentionArgs.length = 0;
  mocks.threadTimelineRows.length = 0;
  mocks.timelineRowsProps.length = 0;
  mocks.threadCreationReasoningLevel = "medium";
  mocks.threadCreationSelectedModel = "gpt-5";
  mocks.threadCreationServiceTier = undefined;
  mocks.threadRuntimeDisplayStatus = "idle";
  vi.clearAllMocks();
});

describe("SideChatTabContent", () => {
  function renderDraftSideChat() {
    return renderSideChat({ threadId: null });
  }

  function renderSideChat({
    sourceMessageText,
    threadId,
  }: {
    sourceMessageText?: string;
    threadId: string | null;
  }) {
    const onSetThreadId = vi.fn();
    const view = render(
      buildSideChatElement({ onSetThreadId, sourceMessageText, threadId }),
    );

    return { onSetThreadId, view };
  }

  function buildSideChatElement({
    isActive = true,
    onSetThreadId,
    sourceMessageText = "Earlier answer",
    threadId,
  }: {
    isActive?: boolean;
    onSetThreadId: (args: { tabId: string; threadId: string }) => void;
    sourceMessageText?: string;
    threadId: string | null;
  }) {
    const tab: SideChatFixedPanelTab = {
      id: "side-chat:one",
      kind: "side-chat",
      sourceMessageText,
      sourceSeqEnd: 9,
      threadId,
      title: "Side chat",
    };
    const sourceThread = {
      environmentId: null,
      id: "thr_parent",
      projectId: "proj_parent",
      providerId: "codex",
    } as Thread;

    return (
      <SideChatTabContent
        isActive={isActive}
        tab={tab}
        sourceThread={sourceThread}
        sourceEnvironment={null}
        sourceTimelineRows={[]}
        resolveMentionLink={() => null}
        onSetThreadId={onSetThreadId}
      />
    );
  }

  it("does not create a side-chat child thread just by opening the tab", () => {
    renderDraftSideChat();

    expect(mocks.createThreadMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText("Provisioning side chat...")).toBeNull();
  });

  it("does not autofocus when a side-chat tab becomes active", () => {
    const onSetThreadId = vi.fn();
    const { rerender } = render(
      buildSideChatElement({
        isActive: false,
        onSetThreadId,
        threadId: null,
      }),
    );

    expect(screen.getByTestId("side-chat-composer").dataset.focusEndKey).toBe(
      "0",
    );

    rerender(
      buildSideChatElement({
        isActive: true,
        onSetThreadId,
        threadId: null,
      }),
    );

    expect(screen.getByTestId("side-chat-composer").dataset.focusEndKey).toBe(
      "0",
    );
  });

  it("keeps permission locked while model controls remain editable", () => {
    renderDraftSideChat();

    expect(screen.getByTestId("side-chat-read-only").textContent).toBe("false");
    expect(
      screen.getByTestId("side-chat-permission-read-only").textContent,
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Use o4-mini" }));

    expect(screen.getByTestId("side-chat-selected-model").textContent).toBe(
      "o4-mini",
    );
  });

  it("creates the side-chat child thread with the first submitted message", async () => {
    mocks.createThreadMutateAsync.mockResolvedValueOnce({ id: "thr_side" });
    const { onSetThreadId } = renderDraftSideChat();

    fireEvent.click(screen.getByRole("button", { name: "Use o4-mini" }));
    fireEvent.click(screen.getByRole("button", { name: "Use high reasoning" }));
    fireEvent.click(screen.getByRole("button", { name: "Use fast mode" }));
    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Compare the tradeoffs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          expect.objectContaining({
            text: expect.stringContaining("Earlier answer"),
            type: "text",
            visibility: "agent-only",
          }),
          { type: "text", text: "Compare the tradeoffs", mentions: [] },
        ],
        originKind: "side-chat",
        model: "o4-mini",
        permissionMode: "readonly",
        reasoningLevel: "high",
        serviceTier: "fast",
        sourceSeqEnd: 9,
        sourceThreadId: "thr_parent",
      }),
    );
    expect(onSetThreadId).toHaveBeenCalledWith({
      tabId: "side-chat:one",
      threadId: "thr_side",
    });
  });

  it("uses the selected model options when sending an existing side-chat message", async () => {
    mocks.sendThreadMessageMutateAsync.mockResolvedValueOnce(undefined);
    renderSideChat({ threadId: "thr_side" });

    fireEvent.click(screen.getByRole("button", { name: "Use o4-mini" }));
    fireEvent.click(screen.getByRole("button", { name: "Use high reasoning" }));
    fireEvent.click(screen.getByRole("button", { name: "Use fast mode" }));
    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Continue with another model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thr_side",
        model: "o4-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "readonly",
      }),
    );
  });

  it("keeps the first submitted message visible while the side chat starts", async () => {
    mocks.createThreadMutateAsync.mockResolvedValueOnce({ id: "thr_side" });
    const onSetThreadId = vi.fn();
    const { rerender } = render(
      buildSideChatElement({ onSetThreadId, threadId: null }),
    );

    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Compare the tradeoffs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Compare the tradeoffs")).toBeTruthy();
    expect(screen.getByText("Starting side chat...")).toBeTruthy();

    await waitFor(() =>
      expect(onSetThreadId).toHaveBeenCalledWith({
        tabId: "side-chat:one",
        threadId: "thr_side",
      }),
    );

    mocks.threadRuntimeDisplayStatus = "provisioning";
    rerender(buildSideChatElement({ onSetThreadId, threadId: "thr_side" }));

    expect(screen.getByText("Compare the tradeoffs")).toBeTruthy();
    expect(screen.getByText("Provisioning side chat...")).toBeTruthy();
  });

  it("submits side-chat attachments with the normal prompt input", async () => {
    mocks.createThreadMutateAsync.mockResolvedValueOnce({ id: "thr_side" });
    mocks.uploadPromptAttachmentMutateAsync.mockResolvedValueOnce({
      type: "localFile",
      path: "thread-storage/uploads/note.md",
      name: "note.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
    });
    renderDraftSideChat();

    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    await waitFor(() =>
      expect(mocks.uploadPromptAttachmentMutateAsync).toHaveBeenCalledWith({
        projectId: "proj_parent",
        file: expect.objectContaining({ name: "note.md" }),
      }),
    );

    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Use this context" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          expect.objectContaining({
            text: expect.stringContaining("Earlier answer"),
            type: "text",
            visibility: "agent-only",
          }),
          { type: "text", text: "Use this context", mentions: [] },
          {
            type: "localFile",
            path: "thread-storage/uploads/note.md",
            name: "note.md",
            mimeType: "text/markdown",
            sizeBytes: 5,
          },
        ],
      }),
    );
  });

  it("allows active side chats to send modifier-submit steering messages", async () => {
    mocks.threadRuntimeDisplayStatus = "active";
    mocks.sendThreadMessageMutateAsync.mockResolvedValueOnce(undefined);
    renderSideChat({ threadId: "thr_side" });

    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Keep going with this side chat." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() =>
      expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledWith({
      id: "thr_side",
      input: [
        {
          type: "text",
          text: "Keep going with this side chat.",
          mentions: [],
        },
      ],
      mode: "steer-if-active",
    });
    expect(mocks.createThreadMutateAsync).not.toHaveBeenCalled();
  });

  it("does not repeat the hidden reply reference before timeline hydration catches up", async () => {
    mocks.createThreadMutateAsync.mockResolvedValueOnce({ id: "thr_side" });
    mocks.sendThreadMessageMutateAsync.mockResolvedValueOnce(undefined);
    const onSetThreadId = vi.fn();
    const { rerender } = render(
      buildSideChatElement({ onSetThreadId, threadId: null }),
    );

    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "First question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledTimes(1),
    );

    rerender(buildSideChatElement({ onSetThreadId, threadId: "thr_side" }));
    fireEvent.change(screen.getByTestId("side-chat-composer"), {
      target: { value: "Follow-up before hydration" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thr_side",
        input: [
          {
            type: "text",
            text: "Follow-up before hydration",
            mentions: [],
          },
        ],
      }),
    );
  });

  it("offers send-to-main actions only while the side chat is idle", () => {
    mocks.threadRuntimeDisplayStatus = "active";
    mocks.threadTimelineRows.push({
      kind: "conversation",
      role: "assistant",
      text: "Side-chat answer",
    });
    const { onSetThreadId, view } = renderSideChat({ threadId: "thr_side" });

    expect(
      mocks.timelineRowsProps[mocks.timelineRowsProps.length - 1]
        ?.onSendToMainMessage,
    ).toBeUndefined();

    mocks.threadRuntimeDisplayStatus = "idle";
    view.rerender(
      buildSideChatElement({ onSetThreadId, threadId: "thr_side" }),
    );
    expect(
      mocks.timelineRowsProps[mocks.timelineRowsProps.length - 1]
        ?.onSendToMainMessage,
    ).toEqual(expect.any(Function));
  });

  it("queues a side-chat handoff on the main thread", () => {
    mocks.threadTimelineRows.push({
      kind: "conversation",
      role: "assistant",
      text: "Side-chat answer",
    });
    renderSideChat({ threadId: "thr_side" });
    const handoff = mocks.timelineRowsProps[
      mocks.timelineRowsProps.length - 1
    ]?.onSendToMainMessage;
    expect(handoff).toEqual(expect.any(Function));
    if (!handoff) {
      throw new Error("Expected the side-chat handoff action");
    }

    mocks.noopMutate.mockClear();
    handoff({
      messageText: "Queue this result",
    });

    expect(mocks.noopMutate).toHaveBeenCalledWith({
      id: "thr_parent",
      input: [
        {
          type: "text",
          text: "Queue this result",
          mentions: [],
        },
      ],
      senderThreadId: "thr_side",
    });
    expect(mocks.sendThreadMessageMutateAsync).not.toHaveBeenCalled();
  });
});
