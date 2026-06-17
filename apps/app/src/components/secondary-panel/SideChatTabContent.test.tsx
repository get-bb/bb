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
  createThreadMutateAsync: vi.fn(),
  noopMutate: vi.fn(),
  noopMutateAsync: vi.fn(),
}));

vi.mock("@/components/promptbox/PromptBoxInternal", () => ({
  INERT_TYPEAHEAD_COMMAND_CONFIG: {
    isError: false,
    isLoading: false,
    onQueryChange: vi.fn(),
    suggestions: [],
  },
}));

vi.mock("@/components/promptbox/FollowUpPromptBox", () => ({
  FollowUpPromptBox: ({
    composer,
  }: {
    composer: Pick<
      FollowUpComposerProps,
      "message" | "onChangeMessage" | "onSubmit"
    >;
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
  ThreadTimelineRows: () => <div />,
  TimelineStatusIndicator: ({ label }: { label: string }) => <div>{label}</div>,
  TimelineWorkingIndicator: ({ label }: { label?: string }) => (
    <div>{label ?? "Working"}</div>
  ),
}));

vi.mock("@/components/thread/timeline/ConversationMessageMentions", () => ({
  messageBodyHasQuote: () => false,
  renderMessageBodyWithQuotes: () => null,
}));

vi.mock("@/components/ui/height-transition.js", () => ({
  HeightTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/ui/icon.js", () => ({
  Icon: () => <span />,
}));

vi.mock("@/components/ui/overflow-fade", () => ({
  OverflowFade: () => null,
}));

vi.mock("@/components/ui/skeleton.js", () => ({
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
    selectedProviderDisplayName: "Codex",
    selectedProviderId: "codex",
    serviceTier: undefined,
    serviceTierSupportByProvider: {},
    supportsPermissionModeSelection: true,
    supportsServiceTier: false,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: undefined, error: null, status: "success" }),
  useThreadDefaultExecutionOptions: () => ({
    data: {
      model: "gpt-5",
      reasoningLevel: "medium",
      serviceTier: undefined,
    },
    isLoading: false,
  }),
  useThreadQueuedMessages: () => ({ data: [] }),
  useThreadTimeline: () => ({
    data: { activeThinking: null, rows: [] },
    isError: false,
    isPending: false,
  }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThread: () => ({ mutateAsync: mocks.createThreadMutateAsync }),
  useCreateThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
  useDeleteThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
  useReorderThreadQueuedMessage: () => ({ mutateAsync: mocks.noopMutateAsync }),
  useSendThreadMessage: () => ({
    isPending: false,
    mutate: mocks.noopMutate,
    mutateAsync: mocks.noopMutateAsync,
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("SideChatTabContent", () => {
  function renderDraftSideChat() {
    const onSetThreadId = vi.fn();
    const tab: SideChatFixedPanelTab = {
      id: "side-chat:one",
      kind: "side-chat",
      sourceMessageText: "Earlier answer",
      sourceSeqEnd: 9,
      threadId: null,
      title: "Side chat",
    };
    const sourceThread = {
      environmentId: null,
      id: "thr_parent",
      projectId: "proj_parent",
      providerId: "codex",
    } as Thread;

    render(
      <SideChatTabContent
        tab={tab}
        sourceThread={sourceThread}
        sourceEnvironment={null}
        sourceTimelineRows={[]}
        onSetThreadId={onSetThreadId}
      />,
    );

    return { onSetThreadId };
  }

  it("does not create a side-chat child thread just by opening the tab", () => {
    renderDraftSideChat();

    expect(mocks.createThreadMutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText("Provisioning side chat...")).toBeNull();
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
});
