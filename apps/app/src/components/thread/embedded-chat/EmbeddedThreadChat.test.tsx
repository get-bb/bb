// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Thread } from "@bb/domain";
import type { FollowUpComposerProps } from "@/components/promptbox/FollowUpPromptBox";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import type { UseThreadTimelineControllerResult } from "@/components/thread/timeline/useThreadTimelineController";
import type {
  ThreadTimelineAddToChatHandler,
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
} from "@/components/thread/timeline/types";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { usePluginComposerHostDraft } from "@/components/plugin/plugin-composer-host";
import {
  EmbeddedThreadChat,
  defaultDependencies,
  type EmbeddedThreadChatDependencies,
} from "./EmbeddedThreadChat";
import { useActiveComposerDraft } from "./useActiveComposerDraft";

const mocks = vi.hoisted(() => ({
  createQueuedMessageMutateAsync: vi.fn(),
  markThreadReadMutate: vi.fn(),
  onOpenLink: vi.fn(),
  onOpenLocalFileLink: vi.fn(),
  pendingInteractions:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<{
      id: string;
      createdAt: number;
      payload: { kind: string };
    }>,
  queuedMessages:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<{
      id: string;
    }>,
  readTrackingThreads:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<
      Thread | undefined
    >,
  sendThreadMessageMutateAsync: vi.fn(),
  threadRuntimeDisplayStatus:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ "idle" as string,
  timelineRows:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<{
      text: string;
    }>,
  injectedTimelineProps:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<
      UseThreadTimelineControllerResult | undefined
    >,
  timelinePanelProps:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<EmbeddedTimelinePanelProps>,
  timelineProjectIds:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as Array<
      string | undefined
    >,
  resolveMentionLink: vi.fn(),
}));

interface EmbeddedTimelinePanelProps {
  onMessageAddToChat?: ThreadTimelineAddToChatHandler;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onSelectionAddToChat?: ThreadTimelineAddToChatHandler;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  timeline?: UseThreadTimelineControllerResult;
  workspaceRootPath?: string;
}

const hostDraftMocks = vi.hoisted(() => ({
  latestHost:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ null as {
      getCurrent(): { text: string };
      subscribeDraft(listener: () => void): () => void;
    } | null,
  textAtNotify:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as string[],
  subscribed: false,
}));

const embeddedDependencies: EmbeddedThreadChatDependencies = Object.assign(
  {},
  defaultDependencies,
  {
    FollowUpPromptBox: ({
      composer,
      stack,
      pluginComposerHost,
    }: {
      composer: Pick<
        FollowUpComposerProps,
        "message" | "onChangeMessage" | "onSubmit"
      >;
      stack: ReactNode;
      pluginComposerHost?: PluginComposerHost | null;
    }) => (
      <div>
        {stack}
        <input
          data-testid="embedded-chat-composer"
          value={composer.message}
          onChange={(event) => composer.onChangeMessage(event.target.value, [])}
        />
        <button type="button" onClick={composer.onSubmit}>
          Send
        </button>
        <BottomHostDraftProbe host={pluginComposerHost ?? null} />
      </div>
    ),
    QueuedMessagesList: ({
      queuedMessages,
    }: {
      queuedMessages: readonly { id: string }[];
    }) => (
      <div data-testid="embedded-chat-queued-messages">
        <span data-testid="queued-count">{queuedMessages.length}</span>
      </div>
    ),
    BottomAnchoredScrollBody: ({
      children,
      footer,
      scrollAreaClassName,
    }: {
      children: ReactNode;
      footer: ReactNode;
      scrollAreaClassName: string;
    }) => (
      <div
        data-testid="embedded-chat-scroll-area"
        className={scrollAreaClassName}
      >
        {children}
        {footer}
      </div>
    ),
    OverflowFade: ({ tone }: { tone: string }) => (
      <div data-testid="embedded-chat-overflow-fade" data-tone={tone} />
    ),
    ThreadTimelinePanelContent: (props: EmbeddedTimelinePanelProps) => {
      mocks.timelinePanelProps.push(props);
      mocks.injectedTimelineProps.push(props.timeline);
      mocks.timelineProjectIds.push(props.projectId);
      return (
        <div>
          {mocks.timelineRows.map((row, index) => (
            <div key={index} data-testid="embedded-chat-timeline-row">
              {row.text}
            </div>
          ))}
        </div>
      );
    },
    ThreadTimelineSurface: () => <div data-testid="draft-mode-surface" />,
    ThreadPendingInteractionBanner: ({ threadId }: { threadId: string }) => (
      <div data-testid="pending-interaction-banner">{threadId}</div>
    ),
    useThreadCreationOptions: () => ({
      executionOptionsRouting: undefined,
      selectedProviderId: "provider-1",
      providerOptions: [],
      hasMultipleProviders: false,
      selectedProviderDisplayName: "Provider",
      selectedProviderComposerActions: [],
      selectedModel: "gpt-5",
      setSelectedModel: vi.fn(),
      serviceTier: undefined,
      setServiceTier: vi.fn(),
      reasoningLevel: "medium",
      setReasoningLevel: vi.fn(),
      permissionMode: "auto",
      setPermissionMode: vi.fn(),
      activeModel: { model: "gpt-5" },
      modelOptions: [],
      moreModelOptions: [],
      modelLoadFailed: false,
      modelLoadError: null,
      reasoningOptions: [],
      permissionModeOptions: [],
      supportsPermissionModeSelection: true,
      supportsServiceTier: false,
      serviceTierSupportByProvider: {},
      isLoadingModels: false,
    }),
    useThread: (threadId: string) => ({
      data:
        threadId.length > 0
          ? {
              id: threadId,
              status: "active",
              runtime: { displayStatus: mocks.threadRuntimeDisplayStatus },
              environmentId: null,
              latestAttentionAt: 1,
            }
          : undefined,
    }),
    useThreadPendingInteractions: () => ({ data: mocks.pendingInteractions }),
    useThreadQueuedMessages: () => ({ data: mocks.queuedMessages }),
    useThreadDefaultExecutionOptions: () => ({
      data: {
        model: "gpt-5",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: undefined,
      },
      isLoading: false,
    }),
    useSystemConfig: () => ({
      data: {
        generalSettings: {
          steerActiveThreadOnEnter: false,
        },
      },
    }),
    useCreateThreadQueuedMessage: () => ({
      mutateAsync: mocks.createQueuedMessageMutateAsync,
      mutate: vi.fn(),
      isPending: false,
    }),
    useSendThreadMessage: () => ({
      mutateAsync: mocks.sendThreadMessageMutateAsync,
      isPending: false,
    }),
    useStopThread: () => ({
      mutate: vi.fn(),
      isPending: false,
      variables: undefined,
    }),
    useMarkThreadRead: () => ({ mutate: mocks.markThreadReadMutate }),
    useThreadReadTracking: ({ thread }: { thread?: Thread }) => {
      mocks.readTrackingThreads.push(thread);
    },
    appToast: { error: vi.fn(), message: vi.fn() },
    useActiveComposerDraft,
    useComposerAttachmentUploads: () => ({
      bottomAttachmentError: null,
      setBottomAttachmentError: vi.fn(),
      handleAttachBottomFiles: vi.fn(),
      isAttachingBottomFiles: false,
      inlineAttachmentError: null,
      setInlineAttachmentError: vi.fn(),
      handleAttachInlineFiles: vi.fn(),
      isAttachingInlineFiles: false,
    }),
    useComposerTypeahead: () => ({
      typeaheadConfig: {
        command: {
          trigger: null,
          suggestions: [],
          isLoading: false,
          isError: false,
          hasMore: false,
          isLoadingMore: false,
          loadMore: vi.fn(),
        },
        mention: {
          triggers: [],
          suggestions: [],
          isLoading: false,
          isError: false,
        },
      },
      promptActions: [],
    }),
    useInlineQueuedMessageEditing: () => ({
      inlineEditingQueuedMessage: null,
      inlineEditingQueuedMessageRef: { current: null },
      commitInlineQueuedMessage: vi.fn(),
      dismissInlineQueuedMessageEditor: vi.fn(),
      beginEditQueuedMessage: vi.fn(),
    }),
    useQueuedMessageActions: () => ({
      deleteQueuedMessage: vi.fn(),
      reorderQueuedMessage: vi.fn(),
      sendQueuedMessage: vi.fn(),
      setQueuedMessageGroupBoundary: vi.fn(),
      updateQueuedMessage: vi.fn(),
    }),
  },
);

function BottomHostDraftProbe({ host }: { host: PluginComposerHost | null }) {
  useLayoutEffect(() => {
    hostDraftMocks.latestHost = host;
  }, [host]);
  useEffect(() => {
    if (hostDraftMocks.subscribed || !host) return;
    hostDraftMocks.subscribed = true;
    host.subscribeDraft(() => {
      hostDraftMocks.textAtNotify.push(
        hostDraftMocks.latestHost?.getCurrent().text ?? "",
      );
    });
  }, [host]);
  const draft = usePluginComposerHostDraft(host);
  return <div data-testid="embedded-host-draft">{draft?.text ?? ""}</div>;
}

function buildEmbeddedChat({
  threadId = "thr_child",
  surfaceTone = "background",
  pluginComposerBottomScope,
}: {
  threadId?: string;
  surfaceTone?: "background" | "sidebar";
  pluginComposerBottomScope?: PluginComposerHost["scope"];
} = {}) {
  const composer: Extract<
    Parameters<typeof EmbeddedThreadChat>[0],
    { variant: "compact" }
  >["composer"] = {
    draftScope: {
      kind: "thread",
      projectId: "proj-1",
      threadId,
    },
    executionDefaultsThreadId: threadId,
    executionResetKey: "thr_parent",
    permissionPolicy: "snapshot",
    environmentSummary: null,
  };
  if (pluginComposerBottomScope !== undefined) {
    composer.pluginComposerBottomScope = pluginComposerBottomScope;
  }
  return (
    <EmbeddedThreadChat
      variant="compact"
      surfaceTone={surfaceTone}
      threadId={threadId}
      projectId="proj-1"
      providerId="provider-1"
      promptContextEnvironmentId={null}
      onOpenLink={mocks.onOpenLink}
      onOpenLocalFileLink={mocks.onOpenLocalFileLink}
      resolveMentionLink={mocks.resolveMentionLink}
      workspaceRootPath="/workspace"
      composer={composer}
      /* SAFETY: The fixture replaces each production dependency with a focused test implementation. */
      dependencies={embeddedDependencies}
    />
  );
}

function renderEmbeddedChat(
  options: Parameters<typeof buildEmbeddedChat>[0] = {},
) {
  return render(buildEmbeddedChat(options));
}

describe("EmbeddedThreadChat", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.createQueuedMessageMutateAsync.mockReset().mockResolvedValue({});
    mocks.sendThreadMessageMutateAsync.mockReset().mockResolvedValue({});
    mocks.markThreadReadMutate.mockReset();
    mocks.onOpenLink.mockReset();
    mocks.onOpenLocalFileLink.mockReset();
    mocks.pendingInteractions = [];
    mocks.queuedMessages = [];
    mocks.readTrackingThreads = [];
    mocks.threadRuntimeDisplayStatus = "idle";
    mocks.timelineRows = [];
    mocks.injectedTimelineProps = [];
    mocks.timelinePanelProps = [];
    mocks.timelineProjectIds = [];
    mocks.resolveMentionLink.mockReset();
    hostDraftMocks.latestHost = null;
    hostDraftMocks.textAtNotify = [];
    hostDraftMocks.subscribed = false;
  });

  it("applies the requested surface tone to the timeline and footer", () => {
    renderEmbeddedChat({ surfaceTone: "sidebar" });

    expect(
      document.querySelector(
        '[data-thread-window][data-surface-tone="sidebar"]',
      ),
    ).not.toBeNull();
    expect(screen.getByTestId("embedded-chat-overflow-fade").dataset.tone).toBe(
      "sidebar",
    );
    expect(
      screen.getByTestId("embedded-chat-composer").closest(".bg-sidebar"),
    ).not.toBeNull();
  });
  afterEach(() => {
    cleanup();
  });

  it("forwards the project to the timeline so attachment images resolve to API URLs", () => {
    renderEmbeddedChat();
    expect(mocks.timelineProjectIds.at(-1)).toBe("proj-1");
  });

  it("forwards host navigation to the embedded timeline", () => {
    renderEmbeddedChat();

    expect(mocks.timelinePanelProps.at(-1)).toEqual(
      expect.objectContaining({
        onOpenLink: mocks.onOpenLink,
        onOpenLocalFileLink: mocks.onOpenLocalFileLink,
        resolveMentionLink: mocks.resolveMentionLink,
        workspaceRootPath: "/workspace",
      }),
    );
  });

  it("keeps add-to-chat callbacks stable while the composer draft changes", () => {
    renderEmbeddedChat();
    const initialTimelineProps = mocks.timelinePanelProps.at(-1);

    fireEvent.change(screen.getByTestId("embedded-chat-composer"), {
      target: { value: "Typing must not invalidate timeline rows" },
    });

    expect(mocks.timelinePanelProps.at(-1)).toEqual(
      expect.objectContaining({
        onMessageAddToChat: initialTimelineProps?.onMessageAddToChat,
        onSelectionAddToChat: initialTimelineProps?.onSelectionAddToChat,
      }),
    );
  });

  it("restores the draft and a stream that advanced while unmounted on remount", () => {
    mocks.threadRuntimeDisplayStatus = "active";
    mocks.timelineRows = [{ text: "First reply" }];
    const first = renderEmbeddedChat();
    fireEvent.change(screen.getByTestId("embedded-chat-composer"), {
      target: { value: "A reply in progress" },
    });
    expect(screen.getAllByTestId("embedded-chat-timeline-row")).toHaveLength(1);
    first.unmount();

    mocks.timelineRows = [{ text: "First reply" }, { text: "Streamed later" }];
    renderEmbeddedChat();
    expect(
      screen.getByTestId<HTMLInputElement>("embedded-chat-composer").value,
    ).toBe("A reply in progress");
    const rows = screen.getAllByTestId("embedded-chat-timeline-row");
    expect(rows).toHaveLength(2);
    expect(rows[1]?.textContent).toBe("Streamed later");
    expect(mocks.injectedTimelineProps.at(-1)).toBeUndefined();
  });

  it("queues the submitted draft itself while the thread runtime is active", async () => {
    mocks.threadRuntimeDisplayStatus = "active";
    renderEmbeddedChat();
    fireEvent.change(screen.getByTestId("embedded-chat-composer"), {
      target: { value: "Queue me" },
    });
    fireEvent.click(screen.getByText("Send"));
    await vi.waitFor(() => {
      expect(mocks.createQueuedMessageMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.createQueuedMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thr_child",
        input: [{ type: "text", text: "Queue me", mentions: [] }],
        model: "gpt-5",
        permissionMode: "auto",
      }),
    );
    expect(mocks.sendThreadMessageMutateAsync).not.toHaveBeenCalled();
    expect(
      screen.getByTestId<HTMLInputElement>("embedded-chat-composer").value,
    ).toBe("");
  });

  it("sends directly when the thread runtime is idle", async () => {
    mocks.threadRuntimeDisplayStatus = "idle";
    renderEmbeddedChat();
    fireEvent.change(screen.getByTestId("embedded-chat-composer"), {
      target: { value: "Send me" },
    });
    fireEvent.click(screen.getByText("Send"));
    await vi.waitFor(() => {
      expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.sendThreadMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "thr_child",
        mode: "queue-if-active",
        input: [{ type: "text", text: "Send me", mentions: [] }],
      }),
    );
  });

  it("keeps queued messages adjacent to the composer", () => {
    mocks.queuedMessages = [{ id: "q1" }, { id: "q2" }];
    renderEmbeddedChat();

    const queue = screen.getByTestId("embedded-chat-queued-messages");
    const composer = screen.getByTestId("embedded-chat-composer");
    expect(queue.nextElementSibling).toBe(composer);
    expect(screen.getByTestId("queued-count").textContent).toBe("2");
  });

  it("swaps the composer for a pending approval so it can be answered", () => {
    mocks.pendingInteractions = [
      { id: "int_1", createdAt: 1, payload: { kind: "approval" } },
    ];

    renderEmbeddedChat({ threadId: "thr_side_chat" });

    expect(screen.getByTestId("pending-interaction-banner").textContent).toBe(
      "thr_side_chat",
    );
    expect(screen.queryByTestId("embedded-chat-composer")).toBeNull();
  });

  it("keeps the composer for a plugin-owned interaction", () => {
    mocks.pendingInteractions = [
      { id: "int_2", createdAt: 1, payload: { kind: "plugin" } },
    ];

    renderEmbeddedChat({ threadId: "thr_side_chat" });

    expect(screen.queryByTestId("pending-interaction-banner")).toBeNull();
    expect(screen.getByTestId("embedded-chat-composer")).toBeTruthy();
  });

  it("delivers the new thread's draft to host subscribers immediately on a thread switch", () => {
    getPromptDraftAccessor({
      kind: "thread",
      projectId: "proj-1",
      threadId: "thr_switch_a",
    }).setDraft({ text: "alpha draft", mentions: [], attachments: [] });
    getPromptDraftAccessor({
      kind: "thread",
      projectId: "proj-1",
      threadId: "thr_switch_b",
    }).setDraft({ text: "beta draft", mentions: [], attachments: [] });

    const scopeFor = (threadId: string) =>
      ({ kind: "thread", threadId }) as const;
    const view = render(
      buildEmbeddedChat({
        threadId: "thr_switch_a",
        pluginComposerBottomScope: scopeFor("thr_switch_a"),
      }),
    );
    expect(screen.getByTestId("embedded-host-draft").textContent).toBe(
      "alpha draft",
    );

    view.rerender(
      buildEmbeddedChat({
        threadId: "thr_switch_b",
        pluginComposerBottomScope: scopeFor("thr_switch_b"),
      }),
    );
    expect(screen.getByTestId("embedded-host-draft").textContent).toBe(
      "beta draft",
    );
    expect(hostDraftMocks.textAtNotify).toEqual(["beta draft"]);

    view.rerender(
      buildEmbeddedChat({
        threadId: "thr_switch_a",
        pluginComposerBottomScope: scopeFor("thr_switch_a"),
      }),
    );
    expect(screen.getByTestId("embedded-host-draft").textContent).toBe(
      "alpha draft",
    );
    expect(hostDraftMocks.textAtNotify).toEqual(["beta draft", "alpha draft"]);
  });
});
