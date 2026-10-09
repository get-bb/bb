// @vitest-environment jsdom

import { promptAreaMocks as mocks } from "@/test/thread-detail-prompt-area-harness";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  PendingInteraction,
  PromptTextMention,
  ThreadQueuedMessage,
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelineModelFallback,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  cleanup,
  fireEvent,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  TimelineWorkflowWorkRow,
  ThreadTimelineSessionOption,
} from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  makeThreadQueuedMessage as makeThreadQueuedMessageFixture,
  makeThreadWithRuntime as makeThreadWithRuntimeFixture,
} from "@bb/test-helpers/domain-fixtures";
import type { ComponentProps } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LazyQueuedMessagesList } from "@/components/promptbox/banner/LazyQueuedMessagesList";
import { workflowRow } from "@/test/fixtures/thread-timeline-rows";
import type { PromptDraftAttachment } from "@bb/client-core";
import { BbHttpError } from "@/lib/sdk";
import type { ExperimentalComposerSelection } from "@get-bb/plugin-sdk";
import { setComposerTextEffect } from "@/lib/composer-text-effects";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import type { ChildThreadPendingAttention } from "@/hooks/queries/child-thread-pending-interactions";
import {
  ThreadDetailPromptArea,
  type ThreadDetailSentMessageEdit,
} from "./ThreadDetailPromptArea";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftStorage: () => mocks.promptDraft,
}));

function makeQueuedMessage(
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return makeThreadQueuedMessageFixture({
    id: "qmsg_1",
    threadId: "thr_1",
    content: [{ type: "text", text: "Already queued", mentions: [] }],
    model: "gpt-5",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}

function makeThread(
  overrides: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return makeThreadWithRuntimeFixture({
    environmentId: null,
    id: "thr_1",
    projectId: "proj_1",
    ...overrides,
  });
}

const activePlan = {
  mode: "plan",
  providerId: "codex",
  prompt: "Plan the work",
} satisfies ThreadTimelineActivePromptMode;

const activeGoal = {
  sourceSeq: 1,
  updatedAt: 100,
  objective: "Finish the work",
  status: "active",
  tokenBudget: null,
  tokensUsed: 100,
  timeUsedSeconds: 10,
} satisfies ThreadTimelineGoal;

function makePendingInteraction(): PendingInteraction {
  return {
    id: "interaction-1",
    threadId: "thr_1",
    turnId: "turn-1",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "provider-request-1",
    origin: {
      kind: "provider",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      providerRequestId: "provider-request-1",
    },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-1",
          prompt: "Continue?",
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    },
    resolution: null,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

interface RenderPromptAreaOptions {
  activePromptMode?: ThreadTimelineActivePromptMode | null;
  activeWorkflows?: TimelineWorkflowWorkRow[];
  goal?: ThreadTimelineGoal | null;
  modelFallback?: ThreadTimelineModelFallback | null;
  pendingInteractions?: readonly PendingInteraction[];
  childPendingInteractions?: readonly ChildThreadPendingAttention[];
  environmentGoneStatus?: ComponentProps<
    typeof ThreadDetailPromptArea
  >["environmentGoneStatus"];
  queuedMessageCount?: number;
  sentMessageEdit?: ThreadDetailSentMessageEdit;
  sessionOptions?: readonly ThreadTimelineSessionOption[] | null;
  thread?: ThreadWithRuntime;
}

let testQueryClient: QueryClient;

function buildPromptAreaElement({
  activePromptMode = null,
  activeWorkflows = [],
  goal = null,
  modelFallback = null,
  pendingInteractions = [],
  childPendingInteractions = [],
  environmentGoneStatus = null,
  queuedMessageCount = 0,
  sentMessageEdit,
  sessionOptions = null,
  thread = makeThread(),
}: RenderPromptAreaOptions = {}) {
  return (
    <QueryClientProvider client={testQueryClient}>
      <ThreadDetailPromptArea
        showGitChanges={true}
        activeBackgroundAgentCount={0}
        activeBackgroundCommands={[]}
        activePromptMode={activePromptMode}
        activeWorkflows={activeWorkflows}
        canUseGitUi={false}
        childPendingInteractions={childPendingInteractions}
        childThreadsSection={null}
        composerFocusRequestNonce={0}
        contextBannerMergeBase={null}
        canRestoreEnvironment={false}
        environmentGoneStatus={environmentGoneStatus}
        goal={goal}
        providerCommands={null}
        sessionOptions={sessionOptions}
        modelFallback={modelFallback}
        isEnvironmentActionPending={false}
        onChangedFileClick={vi.fn()}
        parentThreadSection={null}
        pendingInteractions={pendingInteractions}
        queuedMessageCount={queuedMessageCount}
        pendingTodos={null}
        projectId="proj_1"
        pullRequest={null}
        pullRequestMergeMethod="squash"
        resolveMentionLink={() => null}
        sendMessage={{
          isPending: false,
          mutateAsync: mocks.sendMessageMutateAsync,
        }}
        sentMessageEdit={sentMessageEdit}
        steerActiveThreadOnEnter={false}
        thread={thread}
        workspaceChangedFilesSection={null}
        workspaceStatusPending={false}
      />
    </QueryClientProvider>
  );
}

function renderPromptArea(options: RenderPromptAreaOptions = {}) {
  return render(buildPromptAreaElement(options));
}

beforeAll(() => LazyQueuedMessagesList.preload());

beforeEach(() => {
  testQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mocks.defaultExecutionOptions = null;
  mocks.executionInputSources = {};
  mocks.pluginComposerHost = null;
  mocks.promptDraft.text = "";
  mocks.promptDraft.mentions = [];
  mocks.promptDraft.attachments = [];
  mocks.promptDraft.getCurrent.mockImplementation(() => ({
    attachments: mocks.promptDraft.attachments,
    mentions: mocks.promptDraft.mentions,
    text: mocks.promptDraft.text,
  }));
  mocks.promptDraft.setDraft.mockImplementation(
    (draft: {
      attachments: PromptDraftAttachment[];
      mentions: PromptTextMention[];
      text: string;
    }) => {
      mocks.promptDraft.attachments = draft.attachments;
      mocks.promptDraft.mentions = draft.mentions;
      mocks.promptDraft.text = draft.text;
    },
  );
  mocks.queuedMessages = [];
  mocks.serviceTier = undefined;
  mocks.supportsServiceTier = false;
  mocks.updateQueuedMessageMutateAsync.mockResolvedValue(undefined);
  mocks.useThreadCreationOptions.mockClear();
  mocks.useThreadDefaultExecutionOptions.mockClear();
  mocks.useThreadPromptHistory.mockClear();
  mocks.useThreadQueuedMessages.mockClear();
});

afterEach(() => {
  cleanup();
  document
    .querySelectorAll("[data-sent-message-editor-test-host]")
    .forEach((element) => element.remove());
  resetPluginSlotStoreForTest();
  vi.clearAllMocks();
});

it.each(["removed", "removing", "cleanup-failed"] as const)(
  "hides execution for a %s machine even when the environment still exists",
  (status) => {
    renderPromptArea({
      environmentGoneStatus: status,
      thread: makeThread({ environmentId: "env_retained" }),
    });
    expect(screen.getByTestId("composer-hidden").textContent).toBe("true");
  },
);

describe("environment follow-up summary", () => {
  it("renders for a thread with an environment even when it has no environment label", () => {
    renderPromptArea({ thread: makeThread({ environmentId: "env_1" }) });

    expect(screen.getByTestId("thread-environment-summary")).toBeTruthy();
  });

  it("shows no environment row for an errored thread with no environment", () => {
    renderPromptArea({
      thread: makeThread({ environmentId: null, status: "error" }),
    });

    expect(screen.queryByTestId("thread-environment-summary")).toBeNull();
  });
});

describe("agent session options", () => {
  const modeOption: ThreadTimelineSessionOption = {
    type: "select",
    id: "mode",
    label: "Mode",
    description: null,
    category: "mode",
    value: "agent",
    pendingValue: null,
    values: [
      { id: "agent", label: "Agent", description: null, group: null },
      { id: "plan", label: "Plan", description: null, group: null },
    ],
  };

  it("offers no agent options menu for a thread whose agent reports none", () => {
    renderPromptArea();

    expect(screen.queryByRole("button", { name: "Agent options" })).toBeNull();
  });

  it("saves a choice on the thread and shows it at once, then returns to the agent's value if the save fails", async () => {
    renderPromptArea({ sessionOptions: [modeOption] });
    const trigger = () => screen.getByRole("button", { name: "Agent options" });
    expect(trigger().textContent).toContain("Agent");

    fireEvent.keyDown(trigger(), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Plan" }));

    expect(mocks.updateThreadMutate).toHaveBeenCalledWith(
      { id: "thr_1", sessionOptions: { mode: "plan" } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    await waitFor(() => expect(trigger().textContent).toContain("Plan"));

    const [, callbacks] = mocks.updateThreadMutate.mock.calls.at(-1) as [
      unknown,
      { onError: () => void },
    ];
    act(() => callbacks.onError());
    await waitFor(() => expect(trigger().textContent).toContain("Agent"));
  });

  it("keeps the mode in the footer and moves every other option into the model picker", async () => {
    renderPromptArea({
      sessionOptions: [
        modeOption,
        {
          type: "boolean",
          id: "web",
          label: "Web search",
          description: null,
          category: null,
          value: false,
          pendingValue: null,
        },
      ],
    });

    fireEvent.keyDown(screen.getByRole("button", { name: "Agent options" }), {
      key: "Enter",
    });
    await screen.findByRole("menuitem", { name: "Plan" });
    expect(screen.queryByRole("menuitem", { name: "On" })).toBeNull();

    const pickerOption = () =>
      within(screen.getByTestId("picker-agent-options")).getByRole("button", {
        hidden: true,
      });
    expect(pickerOption().textContent).toBe("Web search: Off");
    fireEvent.click(pickerOption());

    expect(mocks.updateThreadMutate).toHaveBeenCalledWith(
      { id: "thr_1", sessionOptions: { web: true } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(pickerOption().textContent).toBe("Web search: On (next turn)"),
    );
  });

  it("shows no footer menu when the agent reports only picker options", () => {
    renderPromptArea({
      sessionOptions: [
        {
          type: "boolean",
          id: "web",
          label: "Web search",
          description: null,
          category: null,
          value: true,
          pendingValue: null,
        },
      ],
    });

    expect(screen.queryByRole("button", { name: "Agent options" })).toBeNull();
    expect(screen.getByTestId("picker-agent-options").textContent).toBe(
      "Web search: On",
    );
  });
});

describe("ThreadDetailPromptArea", () => {
  it("preserves plugin submission data through a follow-up composer", async () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Keep this follow-up queued";
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Capture plugin host" }),
    );
    const pluginSubmission = {
      pluginId: "drafts",
      data: { kind: "draft" } as const,
    };

    await act(async () => {
      await mocks.pluginComposerHost?.submit?.(
        { experimental_data: pluginSubmission.data },
        pluginSubmission,
      );
    });

    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        executionInputSources: {},
        id: "thr_1",
        pluginSubmission,
      }),
    );
  });

  it("shows queued work while its message details are loading", () => {
    mocks.queuedMessages = undefined;

    renderPromptArea({ queuedMessageCount: 1 });

    screen.getByRole("status", { name: "Loading queued messages" });
    expect(screen.getByLabelText("Queued messages").textContent).toContain(
      "Queue1",
    );
  });

  it("keeps sent-message edit submission out of the normal send path", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Untouched follow-up draft";
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const updateDraft = vi.fn();
    const hostElement = document.createElement("div");
    hostElement.dataset.sentMessageEditorTestHost = "";
    document.body.append(hostElement);

    renderPromptArea({
      sentMessageEdit: {
        draft: {
          text: "Edited request",
          mentions: [],
          attachments: [],
        },
        hostElement,
        isSubmitting: false,
        operationId: "edit-operation-1",
        onCancel,
        onSubmit,
        updateDraft,
      },
    });

    const inlineEditor = within(hostElement);
    const editingLabel = inlineEditor.getByText("Editing message");
    const editingFrame = editingLabel.closest(
      '[data-inline-message-editor-frame="cap"]',
    );
    expect(editingFrame).not.toBeNull();
    expect(inlineEditor.getByTestId("submit-title").textContent).toBe(
      "Submit edit (Enter)",
    );
    expect(
      inlineEditor.getByTestId("plugin-customizations-suppressed").textContent,
    ).toBe("true");
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    expect(mocks.pluginComposerHost?.getSelection?.()).toEqual({
      providerId: "codex",
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "auto",
    });
    expect(
      (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Edited request");
    const bottomComposer = screen
      .getAllByTestId("follow-up-prompt-box")
      .find((element) => !hostElement.contains(element));
    expect(bottomComposer).toBeDefined();
    expect(
      (
        within(bottomComposer!).getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Untouched follow-up draft");
    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate plugin replacement",
      }),
    );
    expect(updateDraft).toHaveBeenCalledTimes(1);
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();

    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      execution: {
        model: "gpt-5",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: undefined,
        supportsServiceTier: false,
        executionInputSources: {},
      },
      input: [{ type: "text", text: "Edited request", mentions: [] }],
    });
    expect(mocks.promptDraft.clearIfCurrentMatches).not.toHaveBeenCalled();
    expect(mocks.createQueuedMessageMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Stop editing sent message",
      }),
    );
    expect(onCancel).toHaveBeenCalledTimes(1);

    expect(
      within(bottomComposer!).queryByRole("button", {
        name: "Escape composer",
      }),
    ).toBeNull();
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Escape composer" }),
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("allows a staged sent-message edit while another message is queued", () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.queuedMessages = [makeQueuedMessage()];
    const hostElement = document.createElement("div");
    hostElement.dataset.sentMessageEditorTestHost = "";
    document.body.append(hostElement);
    const onSubmit = vi.fn();

    renderPromptArea({
      sentMessageEdit: {
        draft: { text: "Edited request", mentions: [], attachments: [] },
        hostElement,
        isSubmitting: false,
        operationId: "edit-operation-1",
        onCancel: vi.fn(),
        onSubmit,
        updateDraft: vi.fn(),
      },
    });

    const inlineEditor = within(hostElement);
    expect(inlineEditor.getByTestId("submit-mode").textContent).toBe("ready:");
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the queued drawer adjacent to the bottom composer", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();

    const stack = screen.getByTestId("prompt-stack");
    const queue = screen.getByTestId("queued-message-list");
    const composer = screen.getByTestId("composer-boundary");
    expect(stack.lastElementChild).toBe(queue);
    expect(stack.nextElementSibling).toBe(composer);
  });

  it("sends the next queued message with the modifier shortcut after a stopped thread becomes idle", async () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea({
      thread: makeThread({
        runtime: {
          displayStatus: "idle",
        },
        status: "idle",
      }),
    });

    expect(screen.getByTestId("submit-mode").textContent).toBe("ready:");
    fireEvent.click(screen.getByRole("button", { name: "Modifier submit" }));

    await waitFor(() => {
      expect(mocks.sendQueuedMessageMutateAsync).toHaveBeenCalledWith({
        id: "thr_1",
        mode: "steer",
        queuedMessageId: "qmsg_1",
      });
    });
  });

  it("steers a queued row once a provisioning thread is ready", async () => {
    mocks.queuedMessages = [
      makeQueuedMessage({ waitingOn: { kind: "provisioning" } }),
    ];

    renderPromptArea({
      thread: makeThread({
        runtime: {
          displayStatus: "provisioning",
        },
        status: "starting",
      }),
    });

    const queue = screen.getByTestId("queued-message-list");
    expect(queue.dataset.sendAction).toBe("steer-when-ready");
    expect(queue.dataset.sendDisabled).toBeUndefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Steer queued message 1 when ready",
      }),
    );

    await waitFor(() => {
      expect(mocks.sendQueuedMessageMutateAsync).toHaveBeenCalledWith({
        id: "thr_1",
        mode: "steer",
        queuedMessageId: "qmsg_1",
      });
    });
  });

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

  it("binds the normal plugin composer host to the rendered pane thread", () => {
    renderPromptArea({ thread: makeThread({ id: "thr_nonfocused" }) });

    expect(screen.getByTestId("plugin-composer-scope").textContent).toBe(
      "thread:thr_nonfocused",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate plugin replacement" }),
    );
    expect(mocks.promptDraft.setDraft).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Plugin-enhanced queued message" }),
    );
  });

  it("updates an inline-edited queue item without touching the bottom draft", async () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.promptDraft.text = "Keep this bottom draft";
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();
    expect(screen.getByTestId("composer-location").textContent).toBe("bottom");
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    expect(screen.getByTestId("queued-message-count").textContent).toBe("1");
    expect(
      (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("Already queued");
    const bottomComposer = screen
      .getAllByRole("textbox", { name: "Composer message" })
      .find(
        (element) =>
          element.closest('[data-testid="inline-queued-message-editor"]') ===
          null,
      ) as HTMLInputElement;
    expect(bottomComposer.value).toBe("Keep this bottom draft");
    fireEvent.change(bottomComposer, {
      target: { value: "Still-usable bottom draft" },
    });
    expect(mocks.promptDraft.setTextAndMentions).toHaveBeenCalledWith(
      "Still-usable bottom draft",
      [],
    );
    fireEvent.change(
      inlineEditor.getByRole("textbox", { name: "Composer message" }),
      { target: { value: "Edited queued message" } },
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    await waitFor(() => {
      expect(mocks.updateQueuedMessageMutateAsync).toHaveBeenCalledWith({
        expectedUpdatedAt: 1,
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
    expect(screen.getByTestId("composer-location").textContent).toBe("bottom");
  });

  it("exposes the inline queued draft to plugins without dropping attachments", async () => {
    mocks.queuedMessages = [
      makeQueuedMessage({
        content: [
          { type: "text", text: "Already queued", mentions: [] },
          {
            type: "localFile",
            path: "uploads/queued-spec.md",
            name: "queued-spec.md",
            sizeBytes: 42,
          },
        ],
      }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );

    expect(inlineEditor.getByTestId("plugin-composer-scope").textContent).toBe(
      "queued-message:qmsg_1",
    );
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("1");

    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate plugin replacement",
      }),
    );
    expect(
      (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Plugin-enhanced queued message");
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("1");

    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    await waitFor(() => {
      expect(mocks.updateQueuedMessageMutateAsync).toHaveBeenCalledWith({
        expectedUpdatedAt: 1,
        id: "thr_1",
        input: [
          {
            mentions: [],
            text: "Plugin-enhanced queued message",
            type: "text",
          },
          {
            name: "queued-spec.md",
            path: "uploads/queued-spec.md",
            sizeBytes: 42,
            type: "localFile",
          },
        ],
        queuedMessageId: "qmsg_1",
      });
    });
  });

  it("keeps back-to-back plugin updates in the active queued draft", () => {
    mocks.queuedMessages = [makeQueuedMessage()];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", {
        name: "Simulate chained plugin updates",
      }),
    );

    expect(
      (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("First plugin update + second plugin update");
  });

  it("renders text effects only for the active queued edit session", () => {
    mocks.queuedMessages = [
      makeQueuedMessage({ id: "qmsg_1" }),
      makeQueuedMessage({ id: "qmsg_2" }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const firstHost = mocks.pluginComposerHost!;
    act(() => {
      setComposerTextEffect(firstHost.textEffectKey, "composer-effect-test", {
        className: "queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "queued-test-effect",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 2" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "none",
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const secondHost = mocks.pluginComposerHost!;
    expect(secondHost.textEffectKey).not.toBe(firstHost.textEffectKey);

    act(() => {
      setComposerTextEffect(firstHost.textEffectKey, "composer-effect-test", {
        className: "stale-queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "none",
    );
    act(() => {
      setComposerTextEffect(secondHost.textEffectKey, "composer-effect-test", {
        className: "queued-test-effect",
      });
    });
    expect(inlineEditor.getByTestId("composer-text-effect").textContent).toBe(
      "queued-test-effect",
    );

    act(() => {
      setComposerTextEffect(
        firstHost.textEffectKey,
        "composer-effect-test",
        null,
      );
      setComposerTextEffect(
        secondHost.textEffectKey,
        "composer-effect-test",
        null,
      );
    });
  });

  it("ignores a stale plugin write after the queued edit changes", () => {
    mocks.queuedMessages = [
      makeQueuedMessage({
        id: "qmsg_1",
        content: [{ type: "text", text: "First queued draft", mentions: [] }],
      }),
      makeQueuedMessage({
        id: "qmsg_2",
        content: [{ type: "text", text: "Second queued draft", mentions: [] }],
      }),
    ];

    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    const staleHost = mocks.pluginComposerHost;
    expect(staleHost?.scope).toMatchObject({
      kind: "queued-message",
      queuedMessageId: "qmsg_1",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 2" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    expect(inlineEditor.getByTestId("plugin-composer-scope").textContent).toBe(
      "queued-message:qmsg_2",
    );

    act(() => {
      staleHost?.setDraft({
        ...staleHost.getCurrent(),
        text: "Late plugin replacement",
      });
    });
    expect(
      (
        inlineEditor.getByRole("textbox", {
          name: "Composer message",
        }) as HTMLInputElement
      ).value,
    ).toBe("Second queued draft");
  });

  it("keeps queued execution and commands source-locked during a bottom handoff", () => {
    mocks.defaultExecutionOptions = {
      model: "bottom-model",
      permissionMode: "auto",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.queuedMessages = [
      makeQueuedMessage({
        model: "queued-model",
        permissionMode: "full",
        reasoningLevel: "high",
        serviceTier: "fast",
      }),
    ];

    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Switch provider" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );

    expect(inlineEditor.getByTestId("selected-provider").textContent).toBe(
      "codex",
    );
    expect(inlineEditor.getByTestId("command-suggestions").textContent).toBe(
      "codex:thread",
    );
    const inlineHost = screen.getByTestId("inline-queued-message-editor");
    for (const name of ["Switch provider", "Complete handoff flow"]) {
      expect(inlineEditor.queryByRole("button", { name })).toBeNull();
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
    expect(
      screen
        .getAllByTestId("selected-provider")
        .filter((element) => !inlineHost.contains(element))
        .map((element) => element.textContent),
    ).toEqual(["claude-code"]);
    expect(
      screen
        .getAllByTestId("command-suggestions")
        .filter((element) => !inlineHost.contains(element))
        .map((element) => element.textContent),
    ).toEqual(["claude-code:new-thread"]);
    expect(inlineEditor.getByTestId("selected-model").textContent).toBe(
      "queued-model",
    );
    expect(inlineEditor.getByTestId("selected-reasoning").textContent).toBe(
      "high",
    );
    expect(inlineEditor.getByTestId("selected-service-tier").textContent).toBe(
      "fast",
    );
    expect(inlineEditor.getByTestId("selected-permission").textContent).toBe(
      "full",
    );
    expect(inlineEditor.getByTestId("execution-read-only").textContent).toBe(
      "true",
    );
    expect(inlineEditor.getByTestId("permission-read-only").textContent).toBe(
      "true",
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );
    expect(mocks.pluginComposerHost?.getSelection?.()).toEqual({
      providerId: "codex",
      model: "queued-model",
      reasoningLevel: "high",
      permissionMode: "full",
    });
  });

  it("dismisses an inline edit when its thread changes or its live row disappears", async () => {
    mocks.promptDraft.text = "Untouched bottom draft";
    mocks.queuedMessages = [makeQueuedMessage()];
    const view = renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    view.rerender(
      buildPromptAreaElement({ thread: makeThread({ id: "thr_2" }) }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLInputElement
        ).value,
      ).toBe("Untouched bottom draft"),
    );

    view.rerender(buildPromptAreaElement());
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    mocks.queuedMessages = [];
    view.rerender(buildPromptAreaElement());
    await waitFor(() =>
      expect(
        (
          screen.getByRole("textbox", {
            name: "Composer message",
          }) as HTMLInputElement
        ).value,
      ).toBe("Untouched bottom draft"),
    );
    expect(mocks.promptDraft.setDraft).not.toHaveBeenCalled();
  });

  it("does not attach a delayed queued upload to a later edit or the bottom draft", async () => {
    const upload = createDeferredPromise<{
      mimeType: string;
      name: string;
      path: string;
      sizeBytes: number;
      type: "localFile";
    }>();
    mocks.uploadPromptAttachmentMutateAsync.mockReturnValueOnce(upload.promise);
    mocks.queuedMessages = [makeQueuedMessage({ id: "qmsg_1" })];
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(inlineEditor.getByRole("button", { name: "Attach file" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel queued edit" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));

    upload.resolve({
      mimeType: "text/plain",
      name: "queued.txt",
      path: "thread-storage/uploads/queued.txt",
      sizeBytes: 6,
      type: "localFile",
    });

    await waitFor(() =>
      expect(mocks.uploadPromptAttachmentMutateAsync).toHaveBeenCalledTimes(1),
    );
    expect(inlineEditor.getByTestId("attachment-count").textContent).toBe("0");
    expect(mocks.promptDraft.addAttachment).not.toHaveBeenCalled();
  });

  it("keeps a delayed bottom upload owned by the bottom draft", async () => {
    const upload = createDeferredPromise<{
      mimeType: string;
      name: string;
      path: string;
      sizeBytes: number;
      type: "localFile";
    }>();
    const uploaded = {
      mimeType: "text/plain",
      name: "queued.txt",
      path: "thread-storage/uploads/queued.txt",
      sizeBytes: 6,
      type: "localFile" as const,
    };
    mocks.uploadPromptAttachmentMutateAsync.mockReturnValueOnce(upload.promise);
    mocks.queuedMessages = [makeQueuedMessage()];
    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );

    upload.resolve(uploaded);

    await waitFor(() =>
      expect(mocks.promptDraft.addAttachment).toHaveBeenCalledWith(uploaded),
    );
    expect(
      within(screen.getByTestId("inline-queued-message-editor")).getByTestId(
        "attachment-count",
      ).textContent,
    ).toBe("0");
  });

  it("dismisses a missing queued message but keeps a stale edit recoverable", async () => {
    mocks.queuedMessages = [makeQueuedMessage()];
    mocks.updateQueuedMessageMutateAsync.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "invalid_request",
        status: 409,
        message: "Queued message changed",
      }),
    );
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    let inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Failed to update queued message",
        {
          description: "Queued message changed",
        },
      ),
    );
    expect(
      screen.getByRole("button", { name: "Cancel queued edit" }),
    ).toBeTruthy();

    mocks.updateQueuedMessageMutateAsync.mockRejectedValueOnce(
      new BbHttpError({
        body: null,
        code: "invalid_request",
        status: 404,
        message: "Queued message not found",
      }),
    );
    inlineEditor = within(screen.getByTestId("inline-queued-message-editor"));
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Submit composer" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Cancel queued edit" }),
      ).toBeNull(),
    );
  });

  it("auto-collapses concurrently running workflows into a stack that expands to independently expandable cards", () => {
    renderPromptArea({
      activeWorkflows: [
        workflowRow({
          id: "row-wf-late",
          status: "pending",
          taskStatus: "running",
          workflowName: "rfn-visual-identity",
        }),
        workflowRow({
          id: "row-wf-early",
          status: "pending",
          taskStatus: "running",
          workflowName: "rfn-pass-a-balance",
        }),
      ],
    });

    const stack = screen.getByRole("button", {
      name: "2 workflows running. Show all",
    });
    expect(stack.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("workflow-summary").textContent).toBe(
      "rfn-visual-identity",
    );
    expect(screen.queryAllByTestId("workflow-card")).toHaveLength(0);

    fireEvent.click(stack);
    const collapse = screen.getByRole("button", {
      name: "Collapse 2 workflows",
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(collapse);
    const cards = screen.getAllByTestId("workflow-card");
    expect(cards.map((card) => card.textContent)).toEqual([
      "rfn-visual-identity",
      "rfn-pass-a-balance",
    ]);

    fireEvent.click(cards[1]!);
    expect(
      screen
        .getAllByTestId("workflow-card")
        .map((card) => card.getAttribute("data-expanded")),
    ).toEqual(["false", "true"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse 2 workflows" }),
    );
    expect(screen.queryAllByTestId("workflow-card")).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "2 workflows running. Show all" }),
    );
  });

  it("re-collapses the workflow stack after the running count drops below two", () => {
    const first = workflowRow({
      id: "row-wf-a",
      status: "pending",
      taskStatus: "running",
      workflowName: "wf-a",
    });
    const second = workflowRow({
      id: "row-wf-b",
      status: "pending",
      taskStatus: "running",
      workflowName: "wf-b",
    });
    const { rerender } = renderPromptArea({ activeWorkflows: [first, second] });

    fireEvent.click(
      screen.getByRole("button", { name: "2 workflows running. Show all" }),
    );
    expect(
      screen.getByRole("button", { name: "Collapse 2 workflows" }),
    ).toBeTruthy();

    rerender(buildPromptAreaElement({ activeWorkflows: [first] }));
    rerender(buildPromptAreaElement({ activeWorkflows: [first, second] }));

    expect(
      screen.getByRole("button", { name: "2 workflows running. Show all" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Collapse 2 workflows" }),
    ).toBeNull();
  });

  it("shows a child permission prompt on the parent composer", () => {
    renderPromptArea({
      childPendingInteractions: [
        {
          childThreadId: "thr_child",
          childTitle: "Install workspace tools",
          href: "/threads/thr_child",
          interactions: [makePendingInteraction()],
        },
      ],
    });

    expect(screen.getByText("Pending interaction")).toBeTruthy();
  });

  it("keeps Goal above a pending interaction", () => {
    renderPromptArea({
      goal: activeGoal,
      pendingInteractions: [makePendingInteraction()],
    });

    expect(
      screen
        .getAllByTestId("composer-stack-item")
        .map((item) => item.textContent),
    ).toEqual(["Goal banner", "Pending interaction"]);
  });

  it("keeps plugin banners mounted while pending interaction suspends editor regions", () => {
    setPluginSlotRegistrations(
      "pending-plugin",
      makePluginRegistrationSet({
        composerCustomizations: [
          {
            id: "pending",
            scopes: ["thread"],
            actions: [
              { id: "action", component: () => <button>Editor action</button> },
            ],
            plusMenu: [{ id: "menu", label: "Editor menu", run: () => {} }],
            banners: [
              {
                id: "banner",
                component: () => <div>Persistent plugin banner</div>,
              },
            ],
            richText: {
              effects: [
                {
                  id: "rule",
                  className: "pending-rule",
                  match: (text) => [{ from: 0, to: text.length }],
                },
              ],
            },
          },
        ],
        pendingInteractions: [],
        sidebarFooterActions: [],
        fileOpeners: [],
      }),
    );

    renderPromptArea({ pendingInteractions: [makePendingInteraction()] });

    expect(screen.getByText("Persistent plugin banner")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Editor action" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
    expect(document.querySelector(".pending-rule")).toBeNull();
    expect(screen.getByTestId("composer-hidden").textContent).toBe("true");
    expect(screen.getByTestId("submit-mode").textContent).toBe(
      "blocked:pending-interaction",
    );
    expect(screen.queryByTestId("queued-message-list")).toBeNull();
  });

  it("wires the Plan exit action to the current thread", () => {
    renderPromptArea({
      activePromptMode: activePlan,
      thread: makeThread({ id: "thr_plan" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Exit plan mode" }));

    expect(mocks.cancelThreadPlanMutate).toHaveBeenCalledWith("thr_plan");
    expect(mocks.clearThreadGoalMutate).not.toHaveBeenCalled();
  });

  it("wires the Goal clear action to the current thread", () => {
    renderPromptArea({
      goal: activeGoal,
      thread: makeThread({ id: "thr_goal" }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear active Goal" }));

    expect(mocks.clearThreadGoalMutate).toHaveBeenCalledWith("thr_goal");
    expect(mocks.cancelThreadPlanMutate).not.toHaveBeenCalled();
  });

  it("keeps independent Plan and Goal banners above a pending interaction", () => {
    renderPromptArea({
      activePromptMode: activePlan,
      goal: activeGoal,
      pendingInteractions: [makePendingInteraction()],
    });

    expect(
      screen
        .getAllByTestId("composer-stack-item")
        .map((item) => item.textContent),
    ).toEqual(["Plan banner", "Goal banner", "Pending interaction"]);
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

  async function settledSelection(
    promise: Promise<ExperimentalComposerSelection>,
  ): Promise<ExperimentalComposerSelection> {
    let result: ExperimentalComposerSelection | null = null;
    let failure: unknown = null;
    void promise.then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        failure = error;
      },
    );
    await waitFor(() => {
      expect(result !== null || failure !== null).toBe(true);
    });
    if (failure !== null) throw failure;
    return result as unknown as ExperimentalComposerSelection;
  }

  it("starts a handoff when a plugin sets another provider, and drops the fields a thread has no picker for", async () => {
    mocks.promptDraft.text = "Keep going";
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_1",
    });
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Capture plugin host" }),
    );
    const host = mocks.pluginComposerHost;
    expect(host?.setSelection).toBeDefined();

    const result = await settledSelection(
      host!.setSelection!({
        projectId: "proj_other",
        environment: { type: "project-default" },
        providerId: "claude-code",
        model: "claude-opus-5",
        serviceTier: "fast",
      }),
    );

    expect(result).toEqual({
      providerId: "claude-code",
      model: "claude-opus-5",
      reasoningLevel: "medium",
      permissionMode: "auto",
    });
    expect(host!.getSelection?.()).toEqual(result);
    expect(screen.getByTestId("submit-label").textContent).toBe("New thread");
    expect(screen.getByTestId("command-suggestions").textContent).toBe(
      "claude-code:new-thread",
    );
    expect(screen.getByTestId("selected-model").textContent).toBe(
      "claude-opus-5",
    );
    expect(mocks.promptDraft.text).not.toBe("Keep going");
    expect(mocks.promptDraft.text.endsWith("Keep going")).toBe(true);
    expect(mocks.setServiceTier).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));
    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "claude-code",
          model: "claude-opus-5",
        }),
      ),
    );
    expect(mocks.sendMessageMutateAsync).not.toHaveBeenCalled();
  });

  it("sets a same-provider model in place without starting a handoff", async () => {
    mocks.promptDraft.text = "Keep going";
    mocks.supportsServiceTier = true;
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Capture plugin host" }),
    );

    const result = await settledSelection(
      mocks.pluginComposerHost!.setSelection!({
        model: "gpt-5-mini",
        reasoningLevel: "high",
        serviceTier: "fast",
        permissionMode: "full",
      }),
    );

    expect(result).toEqual({
      providerId: "codex",
      model: "gpt-5-mini",
      reasoningLevel: "medium",
      permissionMode: "auto",
    });
    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5-mini");
    expect(screen.getByTestId("submit-label").textContent).toBe("");
    expect(screen.getByTestId("command-suggestions").textContent).toBe(
      "codex:thread",
    );
    expect(mocks.promptDraft.text).toBe("Keep going");
    expect(mocks.setReasoningLevel).toHaveBeenCalledWith("high");
    expect(mocks.setServiceTier).toHaveBeenCalledWith("fast");
    expect(mocks.setPermissionMode).toHaveBeenCalledWith("full");
  });

  it("gives the queued-message editor no pickers to set", () => {
    mocks.queuedMessages = [makeQueuedMessage()];
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    const inlineEditor = within(
      screen.getByTestId("inline-queued-message-editor"),
    );
    fireEvent.click(
      inlineEditor.getByRole("button", { name: "Capture plugin host" }),
    );

    expect(mocks.pluginComposerHost?.scope.kind).toBe("queued-message");
    expect(mocks.pluginComposerHost?.setSelection).toBeUndefined();
  });

  it("creates a new thread with a changed model from the same provider", async () => {
    mocks.promptDraft.text = "Keep going";
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_1",
    });
    renderPromptArea();
    fireEvent.click(
      screen.getByRole("button", { name: "Same provider handoff" }),
    );
    expect(screen.getByTestId("submit-label").textContent).toBe("New thread");
    expect(screen.getByTestId("command-suggestions").textContent).toBe(
      "codex:new-thread",
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));
    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "codex",
          model: "gpt-5-mini",
          executionInputSources: {
            providerId: "explicit",
            model: "explicit",
            reasoningLevel: "explicit",
            permissionMode: "explicit",
          },
        }),
      ),
    );
    expect(mocks.sendMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.createQueuedMessageMutateAsync).not.toHaveBeenCalled();
  });

  it("creates a same-provider handoff with unchanged execution marked explicit", async () => {
    mocks.promptDraft.text = "Keep going";
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_1",
    });
    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Start handoff" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));

    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "codex",
          model: "gpt-5",
          executionInputSources: {
            providerId: "explicit",
            model: "explicit",
            reasoningLevel: "explicit",
            permissionMode: "explicit",
          },
        }),
      ),
    );
    expect(mocks.sendMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.createQueuedMessageMutateAsync).not.toHaveBeenCalled();
  });

  it("marks a supported handoff service tier explicit", async () => {
    mocks.promptDraft.text = "Keep going";
    mocks.serviceTier = "fast";
    mocks.supportsServiceTier = true;
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_1",
    });
    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Start handoff" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));

    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceTier: "fast",
          executionInputSources: expect.objectContaining({
            serviceTier: "explicit",
          }),
        }),
      ),
    );
  });

  it("exits a same-provider handoff and preserves draft edits", () => {
    mocks.promptDraft.text = "Keep going";
    renderPromptArea();
    fireEvent.click(screen.getByRole("button", { name: "Start handoff" }));
    expect(screen.getByTestId("submit-label").textContent).toBe("New thread");
    fireEvent.click(
      screen.getByRole("button", { name: "Same provider handoff" }),
    );
    mocks.promptDraft.text += " with tests";
    fireEvent.click(screen.getByRole("button", { name: "Exit handoff" }));
    expect(mocks.promptDraft.getCurrent().text).toBe("Keep going with tests");
    expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5");
    expect(screen.getByTestId("submit-label").textContent).toBe("");
    expect(screen.getByTestId("command-suggestions").textContent).toBe(
      "codex:thread",
    );
  });

  it.each(["Switch provider", "Complete handoff flow"])(
    "%s prepares a handoff and restores the draft on return",
    (entryAction) => {
      mocks.promptDraft.text = "Keep going";
      renderPromptArea();
      expect(screen.getByTestId("submit-title").textContent).toBe("Submit");
      expect(screen.getByTestId("submit-label").textContent).toBe("");

      fireEvent.click(screen.getByRole("button", { name: entryAction }));

      expect(screen.getByTestId("submit-label").textContent).toBe("New thread");
      expect(screen.getByTestId("submit-icon").textContent).toBe(
        "MessageSquarePlus",
      );
      expect(screen.getByTestId("submit-title").textContent).toBe(
        "Create new thread (Enter)",
      );
      expect(screen.getByTestId("selected-model").textContent).toBe(
        "claude-opus-5",
      );
      expect(screen.getByTestId("submit-mode").textContent).toBe("ready:");
      expect(mocks.promptDraft.setDraft).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: "Continue from @thread:thr_1\n\nKeep going",
        }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Exit handoff" }));

      expect(mocks.promptDraft.setDraft).toHaveBeenLastCalledWith({
        attachments: [],
        mentions: [],
        text: "Keep going",
      });
      expect(screen.getByTestId("submit-label").textContent).toBe("");
      expect(screen.getByTestId("submit-icon").textContent).toBe("");
      expect(screen.getByTestId("submit-title").textContent).toBe("Submit");
    },
  );

  it("shows destination permissions instead of the source active Plan mode", async () => {
    mocks.defaultExecutionOptions = {
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      source: "client/turn/requested",
    };
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_1",
    });
    renderPromptArea({ activePromptMode: activePlan });
    expect(screen.getByTestId("active-permission-mode").textContent).toBe(
      "plan",
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch provider" }));
    expect(screen.getByTestId("active-permission-mode").textContent).toBe("");
    expect(screen.getByTestId("selected-permission").textContent).toBe("full");
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));
    await waitFor(() =>
      expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "claude-code",
          permissionMode: "full",
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Exit handoff" }));
    expect(screen.getByTestId("active-permission-mode").textContent).toBe(
      "plan",
    );
  });

  it.each([false, true])(
    "keeps the destination model after a source fallback (scheduled: %s)",
    async (scheduled) => {
      const thread = makeThread({
        providerId: "claude-code",
        environmentId: "env_1",
      });
      mocks.createThreadMutateAsync.mockResolvedValue({
        id: "thr_new",
        projectId: "proj_1",
      });
      const { rerender } = renderPromptArea({ thread });
      fireEvent.click(
        screen.getByRole("button", { name: "Switch provider back" }),
      );
      rerender(
        buildPromptAreaElement({
          thread,
          modelFallback: {
            sourceSeq: 43,
            detectedAt: 123,
            originalModel: "claude-fable-5",
            fallbackModel: "claude-opus-4-8",
            reason: "refusal",
            message: "Switched to Opus.",
          },
        }),
      );
      expect(screen.getByTestId("selected-model").textContent).toBe("gpt-5");
      expect(screen.getByTestId("preview-environment").textContent).toBe(
        "env_1",
      );
      if (scheduled) {
        fireEvent.click(
          screen.getByRole("button", { name: "Capture plugin host" }),
        );
        await act(async () => {
          await mocks.pluginComposerHost?.submit?.(
            { sendAt: 1234567890 },
            undefined,
          );
        });
      } else {
        fireEvent.click(
          screen.getByRole("button", { name: "Submit composer" }),
        );
      }
      await waitFor(() =>
        expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            providerId: "codex",
            model: "gpt-5",
            ...(scheduled ? { sendAt: 1234567890 } : {}),
          }),
        ),
      );
    },
  );

  it("creates a new thread from the draft as typed and navigates to it", async () => {
    mocks.promptDraft.text = "Refactor the tests";
    mocks.createThreadMutateAsync.mockResolvedValue({
      id: "thr_new",
      projectId: "proj_source",
    });

    renderPromptArea({
      thread: makeThread({
        environmentId: "env_1",
        id: "thr_source",
        projectId: "proj_source",
        runtime: { displayStatus: "active" },
        status: "active",
        title: "Source thread",
        titleFallback: null,
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch provider" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith(
        "/projects/proj_source/threads/thr_new",
      ),
    );
    expect(mocks.createThreadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: { type: "reuse", environmentId: "env_1" },
        input: [
          expect.objectContaining({
            type: "text",
            text: "Continue from @thread:thr_source\n\nRefactor the tests",
            mentions: [
              expect.objectContaining({
                start: 14,
                end: 32,
                resource: expect.objectContaining({ threadId: "thr_source" }),
              }),
            ],
          }),
        ],
        model: "claude-opus-5",
        projectId: "proj_source",
        providerId: "claude-code",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
        },
      }),
    );
    expect(mocks.sendMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.createQueuedMessageMutateAsync).not.toHaveBeenCalled();
    expect(mocks.promptDraft.clearIfCurrentMatches).toHaveBeenCalledTimes(1);
  });
});
