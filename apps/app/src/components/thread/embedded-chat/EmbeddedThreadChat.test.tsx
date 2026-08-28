// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpComposerProps } from "@/components/promptbox/FollowUpPromptBox";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { EmbeddedThreadChat } from "./EmbeddedThreadChat";

const mocks = vi.hoisted(() => ({
  createQueuedMessageMutateAsync: vi.fn(),
  markThreadReadMutate: vi.fn(),
  onOpenLink: vi.fn(),
  onOpenLocalFileLink: vi.fn(),
  pendingInteractions: [] as Array<{
    id: string;
    createdAt: number;
    payload: { kind: string };
  }>,
  queuedMessages: [] as Array<{ id: string }>,
  readTrackingThreads: [] as Array<unknown>,
  sendThreadMessageMutateAsync: vi.fn(),
  threadRuntimeDisplayStatus: "idle" as string,
  timelineRows: [] as Array<{ text: string }>,
  injectedTimelineProps: [] as Array<unknown>,
  timelinePanelProps: [] as Array<Record<string, unknown>>,
  timelineProjectIds: [] as Array<string | undefined>,
  resolveMentionLink: vi.fn(),
}));

const hostDraftMocks = vi.hoisted(() => ({
  latestHost: null as {
    getCurrent(): { text: string };
    subscribeDraft(listener: () => void): () => void;
  } | null,
  textAtNotify: [] as string[],
  subscribed: false,
}));

vi.mock("@/components/promptbox/FollowUpPromptBox", async () => {
  const { usePluginComposerHostDraft } =
    await import("@/components/plugin/plugin-composer-host");
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
  return {
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
  };
});

vi.mock("@/components/promptbox/banner/QueuedMessagesList", () => ({
  QueuedMessagesList: ({
    queuedMessages,
  }: {
    queuedMessages: readonly unknown[];
  }) => (
    <div data-testid="embedded-chat-queued-messages">
      <span data-testid="queued-count">{queuedMessages.length}</span>
    </div>
  ),
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body", () => ({
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
}));

vi.mock("@/components/ui/overflow-fade", () => ({
  OverflowFade: ({ tone }: { tone: string }) => (
    <div data-testid="embedded-chat-overflow-fade" data-tone={tone} />
  ),
}));

vi.mock("@/components/thread/timeline", () => ({
  isRunningThreadRuntimeDisplayStatus: (status: string) => status === "active",
  ThreadTimelinePanelContent: (props: Record<string, unknown>) => {
    mocks.timelinePanelProps.push(props);
    mocks.injectedTimelineProps.push(props.timeline);
    mocks.timelineProjectIds.push(props.projectId as string | undefined);
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
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn() },
}));

vi.mock("@/hooks/useThreadCreationOptions", () => ({
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
}));

vi.mock("@/hooks/usePromptMentions", () => ({
  usePromptMentions: () => ({
    triggers: [],
    results: { groups: [], suggestions: [] },
    isLoading: false,
    isError: false,
    setQuery: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCommandSuggestions", () => ({
  useCommandSuggestions: () => ({
    trigger: null,
    suggestions: [],
    isLoading: false,
    isError: false,
    hasMore: false,
    isLoadingMore: false,
    loadMore: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
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
  useThreadQueuedMessages: () => ({ data: mocks.queuedMessages }),
  useThreadPendingInteractions: () => ({ data: mocks.pendingInteractions }),
  getLatestPendingInteraction: (
    interactions: readonly { createdAt: number }[] | undefined,
  ) => (interactions && interactions.length > 0 ? interactions[0] : null),
}));

vi.mock(
  "@/components/thread/pending-interactions/ThreadPendingInteractionBanner",
  () => ({
    ThreadPendingInteractionBanner: ({ threadId }: { threadId: string }) => (
      <div data-testid="pending-interaction-banner">{threadId}</div>
    ),
  }),
);

vi.mock("@/hooks/queries/thread-default-execution-options-query", () => ({
  useThreadDefaultExecutionOptions: () => ({
    data: {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: undefined,
    },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: {
        steerActiveThreadOnEnter: false,
      },
    },
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
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
  useDeleteThreadQueuedMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useReorderThreadQueuedMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSendThreadQueuedMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useSetThreadQueuedMessageGroupBoundary: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateThreadQueuedMessage: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMarkThreadRead: () => ({ mutate: mocks.markThreadReadMutate }),
}));

vi.mock("@/hooks/useThreadReadTracking", () => ({
  useThreadReadTracking: ({ thread }: { thread?: unknown }) => {
    mocks.readTrackingThreads.push(thread);
  },
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useUploadPromptAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function buildEmbeddedChat({
  threadId = "thr_child",
  surfaceTone = "background",
  pluginComposerBottomScope,
}: {
  threadId?: string;
  surfaceTone?: "background" | "sidebar";
  pluginComposerBottomScope?: PluginComposerHost["scope"];
} = {}) {
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
      composer={{
        draftScope: {
          kind: "thread",
          projectId: "proj-1",
          threadId,
        },
        executionDefaultsThreadId: threadId,
        executionResetKey: "thr_parent",
        permissionPolicy: "snapshot",
        environmentSummary: null,
        ...(pluginComposerBottomScope ? { pluginComposerBottomScope } : {}),
      }}
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
