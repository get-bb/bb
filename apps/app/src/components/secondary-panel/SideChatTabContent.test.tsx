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
  noopMutate: vi.fn(),
  noopMutateAsync: vi.fn(),
  promptMentionArgs: [] as unknown[],
  promptMentionSetQuery: vi.fn(),
  sendThreadMessageMutateAsync: vi.fn(),
  threadTimelineRows: [] as unknown[],
  timelineRowsProps: [] as Array<{
    onSendToMainMessage?: unknown;
  }>,
  threadRuntimeDisplayStatus: "idle",
  uploadPromptAttachmentMutateAsync: vi.fn(),
}));

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({
    attachments,
    composer,
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
        value={composer.message}
        onChange={(event) => composer.onChangeMessage(event.target.value, [])}
      />
      <button type="button" onClick={composer.onSubmit}>
        Send
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
    onSendToMainMessage?: unknown;
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
  ThreadTimelineRows: (props: { onSendToMainMessage?: unknown }) => {
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

vi.mock("@/hooks/useThreadCreationOptions", () => ({
  useThreadCreationOptions: () => ({
    activeModel: null,
    hasMultipleProviders: false,
    isLoadingModels: false,
    modelLoadError: null,
    modelOptions: [],
    permissionModeOptions: [],
    providerOptions: [],
    reasoningLevel: "medium",
    reasoningOptions: [],
    selectedModel: "gpt-5",
    selectedProviderComposerActions: [{ kind: "skills", trigger: "/" }],
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    supportsPermissionModeSelection: true,
    supportsServiceTier: false,
  }),
}));

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
  useThreadDefaultExecutionOptions: () => ({
    data: {
      model: "gpt-5",
      reasoningLevel: "medium",
      serviceTier: undefined,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThread: () => ({ mutateAsync: mocks.createThreadMutateAsync }),
  useCreateThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
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
  mocks.promptMentionArgs.length = 0;
  mocks.threadTimelineRows.length = 0;
  mocks.timelineRowsProps.length = 0;
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
    onSetThreadId,
    sourceMessageText = "Earlier answer",
    threadId,
  }: {
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
        isActive={true}
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

  it("uses the shared follow-up prompt height path when there are no queued messages", () => {
    renderDraftSideChat();

    expect(screen.getByTestId("side-chat-stack-state").textContent).toBe(
      "provided",
    );
  });

  it("renders the side-chat reply anchor as markdown", () => {
    renderSideChat({
      threadId: null,
      sourceMessageText: [
        "# Anchor",
        "",
        "Status: **done** with `pnpm test`.",
        "",
        "- one",
      ].join("\n"),
    });

    expect(screen.getByRole("heading", { name: "Anchor" })).toBeTruthy();
    expect(screen.getByText("done").tagName).toBe("STRONG");
    expect(screen.getByText("pnpm test").tagName).toBe("CODE");
    expect(screen.getByText("one").closest("li")).not.toBeNull();
  });

  it("renders a whole-message markdown fence as a full code block in the side-chat reply anchor", () => {
    const { view } = renderSideChat({
      threadId: null,
      sourceMessageText: [
        "```markdown",
        "## Status Update",
        "",
        "The requested work is **ready**.",
        "",
        "- Completed the pass",
        "```",
      ].join("\n"),
    });

    const languageLabel = screen.getByText("markdown");
    const code = view.container.querySelector("pre code");

    expect(screen.queryByRole("heading", { name: "Status Update" })).toBeNull();
    expect(languageLabel).toBeTruthy();
    expect(languageLabel.closest(".max-h-20")).toBeNull();
    expect(code?.textContent).toContain("## Status Update");
    expect(code?.textContent).toContain("The requested work is **ready**.");
    expect(code?.textContent).toContain("- Completed the pass");
  });

  it("creates the side-chat child thread with the first submitted message", async () => {
    mocks.createThreadMutateAsync.mockResolvedValueOnce({ id: "thr_side" });
    const { onSetThreadId } = renderDraftSideChat();

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
        sourceSeqEnd: 9,
        sourceThreadId: "thr_parent",
      }),
    );
    expect(onSetThreadId).toHaveBeenCalledWith({
      tabId: "side-chat:one",
      threadId: "thr_side",
    });
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

  it("wires side-chat mention and command typeahead to the normal hooks", async () => {
    renderSideChat({ threadId: "thr_side" });

    expect(mocks.promptMentionArgs[mocks.promptMentionArgs.length - 1]).toEqual(
      {
        projectId: "proj_parent",
        options: {
          currentThreadId: "thr_side",
          environmentId: null,
        },
      },
    );
    expect(
      mocks.commandSuggestionArgs[mocks.commandSuggestionArgs.length - 1],
    ).toEqual({
      projectId: "proj_parent",
      providerId: "codex",
      skillsTrigger: "/",
      promptActions: [
        { kind: "skills", text: "/" },
        {
          kind: "loop",
          command: { trigger: "/", name: "loop", trailingText: " " },
          text: "/loop ",
        },
      ],
      environmentId: null,
      query: null,
    });
    expect(screen.getByTestId("command-trigger").textContent).toBe("/");

    fireEvent.click(screen.getByRole("button", { name: "Mention query" }));
    expect(mocks.promptMentionSetQuery).toHaveBeenCalledWith("readme");

    fireEvent.click(screen.getByRole("button", { name: "Command query" }));
    await waitFor(() =>
      expect(mocks.commandSuggestionArgs).toContainEqual({
        projectId: "proj_parent",
        providerId: "codex",
        skillsTrigger: "/",
        promptActions: [
          { kind: "skills", text: "/" },
          {
            kind: "loop",
            command: { trigger: "/", name: "loop", trailingText: " " },
            text: "/loop ",
          },
        ],
        environmentId: null,
        query: "review",
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

  it("hides send-to-main actions while the side chat is running", () => {
    mocks.threadRuntimeDisplayStatus = "active";
    mocks.threadTimelineRows.push({
      kind: "conversation",
      role: "assistant",
      text: "Side-chat answer",
    });
    renderSideChat({ threadId: "thr_side" });

    expect(
      mocks.timelineRowsProps[mocks.timelineRowsProps.length - 1]
        ?.onSendToMainMessage,
    ).toBeUndefined();
  });

  it("shows send-to-main actions when the side chat is idle", () => {
    mocks.threadTimelineRows.push({
      kind: "conversation",
      role: "assistant",
      text: "Side-chat answer",
    });
    renderSideChat({ threadId: "thr_side" });

    expect(
      mocks.timelineRowsProps[mocks.timelineRowsProps.length - 1]
        ?.onSendToMainMessage,
    ).toEqual(expect.any(Function));
  });
});
