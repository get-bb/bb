// @vitest-environment jsdom

import { promptAreaMocks as mocks } from "@/test/thread-detail-prompt-area-harness";
import type {
  PendingInteraction,
  ThreadQueuedMessage,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  makeThreadQueuedMessage,
  makeThreadWithRuntime,
} from "@bb/test-helpers/domain-fixtures";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
  usePluginComposerHostDraft,
} from "@/components/plugin/plugin-composer-host";
import { LazyQueuedMessagesList } from "@/components/promptbox/banner/LazyQueuedMessagesList";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { ThreadDetailPromptArea } from "./ThreadDetailPromptArea";

const shellProbeRenders = vi.fn();

const PROJECT_ID = "proj_keystrokes";

function makeThread(id: string): ThreadWithRuntime {
  return makeThreadWithRuntime({
    environmentId: null,
    id,
    projectId: PROJECT_ID,
  });
}

function makeQueuedMessage(): ThreadQueuedMessage {
  return makeThreadQueuedMessage({
    id: "qmsg_1",
    threadId: "thr_keystrokes",
    content: [{ type: "text", text: "Already queued", mentions: [] }],
    model: "gpt-5",
    createdAt: 1,
    updatedAt: 1,
  });
}

function makePendingInteraction(threadId: string): PendingInteraction {
  return {
    id: `interaction-${threadId}`,
    threadId,
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

function ShellProbe() {
  shellProbeRenders(usePluginComposerHost());
  return null;
}

function PublishedHostDraftProbe() {
  const host = usePluginComposerHost();
  const draft = usePluginComposerHostDraft(host);
  return <div data-testid="published-host-draft">{draft?.text ?? ""}</div>;
}

function observedShellHosts(): readonly unknown[] {
  return shellProbeRenders.mock.calls.map((call) => call[0]);
}

function shellRenderCount(): number {
  return shellProbeRenders.mock.calls.length;
}

interface RenderPromptAreaArgs {
  thread: ThreadWithRuntime;
  pendingInteractions?: readonly PendingInteraction[];
}

function buildPromptArea({
  thread,
  pendingInteractions = [],
}: RenderPromptAreaArgs) {
  return (
    <PluginComposerHostScopeProvider>
      <ShellProbe />
      <PublishedHostDraftProbe />
      <ThreadDetailPromptArea
        showGitChanges={true}
        activeBackgroundAgentCount={0}
        activeBackgroundCommands={[]}
        activePromptMode={null}
        activeWorkflows={[]}
        canUseGitUi={false}
        childPendingInteractions={[]}
        childThreadsSection={null}
        composerFocusRequestNonce={0}
        contextBannerMergeBase={null}
        canRestoreEnvironment={false}
        environmentGoneStatus={null}
        goal={null}
        providerCommands={null}
        sessionOptions={null}
        modelFallback={null}
        isEnvironmentActionPending={false}
        onChangedFileClick={vi.fn()}
        parentThreadSection={null}
        pendingInteractions={pendingInteractions}
        queuedMessageCount={0}
        pendingTodos={null}
        projectId={PROJECT_ID}
        pullRequest={null}
        pullRequestMergeMethod="squash"
        resolveMentionLink={() => null}
        sendMessage={{
          isPending: false,
          mutateAsync: mocks.sendMessageMutateAsync,
        }}
        steerActiveThreadOnEnter={false}
        thread={thread}
        workspaceChangedFilesSection={null}
        workspaceStatusPending={false}
      />
    </PluginComposerHostScopeProvider>
  );
}

function renderPromptArea(args: RenderPromptAreaArgs) {
  return render(buildPromptArea(args));
}

function getBottomComposerInput(): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: "Composer message",
  }) as HTMLInputElement;
}

let threadCounter = 0;
let threadId = "";

beforeAll(() => LazyQueuedMessagesList.preload());

beforeEach(() => {
  threadCounter += 1;
  threadId = `thr_keystrokes_${threadCounter}`;
  mocks.queuedMessages = [];
  mocks.sendMessageMutateAsync.mockResolvedValue(undefined);
  mocks.updateQueuedMessageMutateAsync.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("ThreadDetailPromptArea published composer host", () => {
  it("keeps the published host referentially stable while keystrokes reach draft consumers", () => {
    renderPromptArea({ thread: makeThread(threadId) });
    const input = getBottomComposerInput();
    const rendersAfterMount = shellRenderCount();
    const hostAfterMount = observedShellHosts().at(-1);
    expect(hostAfterMount).not.toBe(null);

    const typed = "abcdefghijklmnopqrstu";
    for (let index = 1; index <= typed.length; index += 1) {
      fireEvent.change(input, { target: { value: typed.slice(0, index) } });
    }

    expect(input.value).toBe(typed);
    expect(screen.getByTestId("published-host-draft").textContent).toBe(typed);
    expect(shellRenderCount()).toBe(rendersAfterMount);
    expect(observedShellHosts().at(-1)).toBe(hostAfterMount);
  });

  it("submits the draft as typed, read imperatively at event time", async () => {
    renderPromptArea({ thread: makeThread(threadId) });
    const input = getBottomComposerInput();
    for (const index of Array.from({ length: 7 }, (_, i) => i + 1)) {
      fireEvent.change(input, { target: { value: "Ship it".slice(0, index) } });
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit composer" }));
    });

    expect(mocks.sendMessageMutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageMutateAsync.mock.calls[0]?.[0]).toMatchObject({
      input: [{ type: "text", text: "Ship it", mentions: [] }],
    });
    expect(
      getPromptDraftAccessor({
        kind: "thread",
        projectId: PROJECT_ID,
        threadId,
      }).getCurrent().text,
    ).toBe("");
  });

  it("delivers external draft writes to consumers without re-rendering the shell, even while a pending interaction hides the composer", () => {
    const accessor = getPromptDraftAccessor({
      kind: "thread",
      projectId: PROJECT_ID,
      threadId,
    });
    renderPromptArea({
      thread: makeThread(threadId),
      pendingInteractions: [makePendingInteraction(threadId)],
    });
    expect(screen.getByText("Pending interaction")).toBeTruthy();
    expect(screen.getByTestId("published-host-draft").textContent).toBe("");
    const rendersAfterMount = shellRenderCount();

    act(() => {
      accessor.setDraft({
        text: "typed elsewhere",
        mentions: [],
        attachments: [],
      });
    });
    expect(screen.getByTestId("published-host-draft").textContent).toBe(
      "typed elsewhere",
    );

    act(() => {
      accessor.setDraft({
        text: "typed elsewhere again",
        mentions: [],
        attachments: [],
      });
    });
    expect(screen.getByTestId("published-host-draft").textContent).toBe(
      "typed elsewhere again",
    );
    expect(shellRenderCount()).toBe(rendersAfterMount);
  });

  it("swaps to a per-session stable host for inline queued-message edits and streams the inline draft", () => {
    mocks.queuedMessages = [makeQueuedMessage()];
    renderPromptArea({ thread: makeThread(threadId) });
    const rendersAfterMount = shellRenderCount();
    const threadHost = observedShellHosts().at(-1);

    fireEvent.click(
      screen.getByRole("button", { name: "Edit queued message 1" }),
    );
    expect(shellRenderCount()).toBe(rendersAfterMount + 1);
    expect(observedShellHosts().at(-1)).not.toBe(threadHost);
    expect(screen.getByTestId("published-host-draft").textContent).toBe(
      "Already queued",
    );

    const inlineInput = within(
      screen.getByTestId("inline-queued-message-editor"),
    ).getByRole("textbox", { name: "Composer message" }) as HTMLInputElement;
    const typed = "Already queued and refined";
    for (
      let index = "Already queued".length + 1;
      index <= typed.length;
      index += 1
    ) {
      fireEvent.change(inlineInput, {
        target: { value: typed.slice(0, index) },
      });
    }

    expect(inlineInput.value).toBe(typed);
    expect(screen.getByTestId("published-host-draft").textContent).toBe(typed);
    expect(shellRenderCount()).toBe(rendersAfterMount + 1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel queued edit" }));
    expect(shellRenderCount()).toBe(rendersAfterMount + 2);
    expect(observedShellHosts().at(-1)).toBe(threadHost);
    expect(screen.getByTestId("published-host-draft").textContent).toBe("");
  });
});
