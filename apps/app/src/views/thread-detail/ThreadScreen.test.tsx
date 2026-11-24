// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingInteraction } from "@bb/domain";
import type {
  ThreadTimelineEditMessageHandler,
  UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { ThreadDetailSentMessageEdit } from "./ThreadDetailPromptArea";
import { ThreadScreen, type ThreadScreenPresentation } from "./ThreadScreen";

const mocks = vi.hoisted(() => ({
  editMessageMutateAsync: vi.fn(),
  pendingInteractions: [] as PendingInteraction[],
  promptAreaProps: [] as Array<Record<string, unknown>>,
  surfaceProps: [] as Array<Record<string, unknown>>,
  timeline: null as UseThreadTimelineControllerResult | null,
  toastWarning: vi.fn(),
}));

vi.mock("@/components/ui/app-toast", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/app-toast")>();
  return {
    ...actual,
    appToast: { ...actual.appToast, warning: mocks.toastWarning },
  };
});

vi.mock("@/hooks/queries/thread-queries", () => ({
  useChildThreads: () => ({ data: [] }),
  useThread: () => ({ data: undefined }),
  useThreadPendingInteractions: () => ({ data: mocks.pendingInteractions }),
}));

vi.mock("@/hooks/queries/child-thread-pending-interactions", () => ({
  useChildThreadPendingAttention: () => [],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => {
  return {
    useEditThreadMessage: () => ({
      isPending: false,
      mutateAsync: mocks.editMessageMutateAsync,
    }),
    useSendThreadMessage: () => ({ isPending: false, mutateAsync: vi.fn() }),
  };
});

vi.mock("@/components/thread/timeline", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/thread/timeline")>();
  return {
    ...actual,
    useThreadTimelineController: () => mocks.timeline,
    ThreadTimelineSurface: (props: Record<string, unknown>) => {
      mocks.surfaceProps.push(props);
      const addToChat = props.onAddToChat as
        | ((text: string) => void)
        | undefined;
      return (
        <button type="button" onClick={() => addToChat?.("Quoted line")}>
          Add selection to chat
        </button>
      );
    },
  };
});

vi.mock("./ThreadDetailPromptArea", () => ({
  ThreadDetailPromptArea: (props: Record<string, unknown>) => {
    mocks.promptAreaProps.push(props);
    return <div data-testid="prompt-area" />;
  },
}));

const THREAD = makeThreadResponse({
  id: "thr_screen",
  projectId: "proj_screen",
  status: "active",
  runtime: { displayStatus: "active" },
});

const TIMELINE: UseThreadTimelineControllerResult = {
  activeBackgroundCommands: [],
  activePromptMode: null,
  activeThinking: null,
  activeWorkflows: [],
  contextBoundarySeq: null,
  contextWindowUsage: undefined,
  hasOlderTimelineRows: false,
  isCatchingUpTimeline: false,
  isLoadingOlderTimelineRows: false,
  loadOlderTimelineRows: async () => {},
  modelFallback: null,
  pendingTodos: null,
  providerCommands: null,
  sessionOptions: null,
  timelineError: null,
  timelineLoading: false,
  timelineRows: [],
};

const SIDE_CHAT_PRESENTATION: ThreadScreenPresentation = {
  kind: "panel",
  layout: "contained",
  measure: "panel",
  tone: "sidebar",
};

function renderScreen(
  presentation: ThreadScreenPresentation,
  timeline: UseThreadTimelineControllerResult = TIMELINE,
) {
  mocks.timeline = timeline;
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(screenElement(presentation), { wrapper: Wrapper });
}

function screenElement(presentation: ThreadScreenPresentation) {
  return (
    <ThreadScreen
      composer={{
        environmentCheckout: undefined,
        environmentChrome: undefined,
        contextEnvironmentId: null,
        focusRequest: null,
        onCreateNewThreadInEnvironment: null,
        onOpenThreadInfo: null,
        permissionPolicy: "snapshot",
      }}
      environment={null}
      presentation={presentation}
      projectId={THREAD.projectId}
      resolveMentionLink={() => null}
      thread={THREAD}
      timelineEnabled
      timelineHost={{
        instanceMessageActions: [],
        environmentHostName: null,
        leadingContent: null,
        messageActionSurface: "thread-view",
        onForkMessage: null,
        onTitleAction: null,
        unreadDividerAutoScroll: false,
        unreadDividerPlacement: null,
      }}
    />
  );
}

function timelineWithRowIds(
  rowIds: readonly string[],
): UseThreadTimelineControllerResult {
  return {
    ...TIMELINE,
    timelineRows: rowIds.map((id) =>
      conversationRow({ id, role: "user", text: "/compact" }),
    ),
  };
}

function latestSentMessageEdit(): ThreadDetailSentMessageEdit | undefined {
  return mocks.promptAreaProps.at(-1)!.sentMessageEdit as
    | ThreadDetailSentMessageEdit
    | undefined;
}

function startEditingMessage(messageId: string) {
  const onEditMessage = mocks.surfaceProps.at(-1)!
    .onEditMessage as ThreadTimelineEditMessageHandler;
  act(() => {
    onEditMessage({
      expectedRequestSequence: 1,
      input: [{ type: "text", text: "/compact", mentions: [] }],
      messageId,
    });
  });
}

function submitSentMessageEdit() {
  act(() => {
    latestSentMessageEdit()!.onSubmit({
      execution: null,
      input: [{ type: "text", text: "/compact keep it short", mentions: [] }],
    });
  });
}

function makePluginInteraction(): PendingInteraction {
  return {
    id: "int_plugin",
    threadId: THREAD.id,
    turnId: null,
    providerId: null,
    providerThreadId: null,
    providerRequestId: null,
    origin: { kind: "plugin", pluginId: "secrets" },
    payload: { kind: "plugin", pluginId: "secrets", type: "secret-request" },
    resolution: null,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  } as unknown as PendingInteraction;
}

beforeEach(() => {
  mocks.editMessageMutateAsync.mockReset();
  mocks.toastWarning.mockReset();
  mocks.pendingInteractions = [];
  mocks.promptAreaProps = [];
  mocks.surfaceProps = [];
  mocks.timeline = null;
});

afterEach(() => {
  cleanup();
  getPromptDraftAccessor({
    kind: "thread",
    projectId: THREAD.projectId,
    threadId: THREAD.id,
  }).setDraft({ text: "", mentions: [], attachments: [] });
});

describe("ThreadScreen", () => {
  it("hands a plugin-rendered interaction to an embedded chat's composer", () => {
    mocks.pendingInteractions = [makePluginInteraction()];
    renderScreen(SIDE_CHAT_PRESENTATION);

    const promptArea = mocks.promptAreaProps.at(-1)!;
    expect(promptArea.pendingInteractions).toEqual(mocks.pendingInteractions);
    expect(promptArea.isPrimaryComposer).toBe(false);
    expect(promptArea.permissionPolicy).toBe("snapshot");
    expect(mocks.surfaceProps.at(-1)!.showOngoingIndicator).toBe(false);
  });

  it("quotes a timeline selection into the thread draft and focuses the composer", () => {
    renderScreen({ kind: "page" });
    const focusKeyBefore =
      mocks.promptAreaProps.at(-1)!.composerFocusRequestKey;

    fireEvent.click(
      screen.getByRole("button", { name: "Add selection to chat" }),
    );

    const draft = getPromptDraftAccessor({
      kind: "thread",
      projectId: THREAD.projectId,
      threadId: THREAD.id,
    }).getCurrent();
    expect(draft.text).toContain("Quoted line");
    expect(mocks.promptAreaProps.at(-1)!.composerFocusRequestKey).not.toBe(
      focusKeyBefore,
    );
  });

  it("keeps a submitted edit quiet when its own rewrite removes the edited message first", async () => {
    let resolveEdit!: () => void;
    mocks.editMessageMutateAsync.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveEdit = resolve;
      }),
    );
    const view = renderScreen({ kind: "page" }, timelineWithRowIds(["msg_1"]));
    startEditingMessage("msg_1");
    submitSentMessageEdit();

    mocks.timeline = timelineWithRowIds(["msg_2"]);
    view.rerender(screenElement({ kind: "page" }));
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(latestSentMessageEdit()).toBeDefined();

    await act(async () => {
      resolveEdit();
    });
    expect(latestSentMessageEdit()).toBeUndefined();
    expect(mocks.toastWarning).not.toHaveBeenCalled();
  });

  it("discards an unsubmitted edit whose message leaves the timeline", () => {
    const view = renderScreen({ kind: "page" }, timelineWithRowIds(["msg_1"]));
    startEditingMessage("msg_1");

    mocks.timeline = timelineWithRowIds(["msg_2"]);
    view.rerender(screenElement({ kind: "page" }));

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "The message being edited is no longer available.",
    );
    expect(latestSentMessageEdit()).toBeUndefined();
  });

  it("moves a changed edit into the composer when its message leaves the timeline", () => {
    const draft = getPromptDraftAccessor({
      kind: "thread",
      projectId: THREAD.projectId,
      threadId: THREAD.id,
    });
    draft.setDraft({
      text: "newer composer text",
      mentions: [],
      attachments: [],
    });
    const view = renderScreen({ kind: "page" }, timelineWithRowIds(["msg_1"]));
    startEditingMessage("msg_1");
    act(() => {
      latestSentMessageEdit()!.updateDraft((current) => ({
        ...current,
        text: "/compact keep it short",
      }));
    });

    mocks.timeline = timelineWithRowIds(["msg_2"]);
    view.rerender(screenElement({ kind: "page" }));

    expect(latestSentMessageEdit()).toBeUndefined();
    expect(draft.getCurrent().text).toBe(
      "/compact keep it short\n\nnewer composer text",
    );
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "Your message edit is in the composer",
      { description: "The message being edited is no longer available." },
    );
  });

  it("discards a failed edit whose message left the timeline while it was submitting", async () => {
    let rejectEdit!: (error: Error) => void;
    mocks.editMessageMutateAsync.mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectEdit = reject;
      }),
    );
    const view = renderScreen({ kind: "page" }, timelineWithRowIds(["msg_1"]));
    startEditingMessage("msg_1");
    submitSentMessageEdit();
    mocks.timeline = timelineWithRowIds(["msg_2"]);
    view.rerender(screenElement({ kind: "page" }));
    expect(mocks.toastWarning).not.toHaveBeenCalled();

    await act(async () => {
      rejectEdit(new Error("edit failed"));
    });

    expect(mocks.toastWarning).toHaveBeenCalledWith(
      "The message being edited is no longer available.",
    );
    expect(latestSentMessageEdit()).toBeUndefined();
  });
});
