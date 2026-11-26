// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import type { ThreadTabsResponse } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import type { NewThreadComposerProps } from "@/components/promptbox/NewThreadComposer";
import {
  getCachedThreadTabs,
  invalidateCachedThreadTabs,
} from "@/hooks/cache-owners/thread-tabs-cache-owner";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createTerminalFixedPanelTab,
  getFixedPanelTabsStateStorageKey,
  serializeFixedPanelTabsState,
  type FixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  resetFixedPanelTabsStateForTest,
  useFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { BbHttpError } from "@/lib/sdk";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import { RootComposeView } from "./RootComposeView";
import { ROOT_COMPOSE_FIXED_PANEL_STATE_ID } from "./RootComposePanelTabContent";

const controls = vi.hoisted(() => ({
  createThread: vi.fn(),
  navigate: vi.fn(),
  handoff: vi.fn<NonNullable<BbDesktopBrowserApi["handoffRootComposeTabs"]>>(),
  submitError: vi.fn(),
  getTabs: vi.fn<() => Promise<ThreadTabsResponse>>(),
  updateTabs:
    vi.fn<
      (request: {
        tabs: ThreadTabsResponse["tabs"];
        expectedRevision: number;
      }) => Promise<ThreadTabsResponse>
    >(),
}));

vi.mock("@/hooks/mutations/thread-runtime-mutations", () => ({
  useCreateThread: () => ({ mutateAsync: controls.createThread }),
}));

vi.mock("@/views/thread-detail/PaneContext", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/views/thread-detail/PaneContext")
  >()),
  usePaneContext: () => ({ navigateInPane: controls.navigate }),
}));

vi.mock("@/lib/bb-desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bb-desktop")>()),
  getDesktopBrowserApi: () => ({ handoffRootComposeTabs: controls.handoff }),
}));

vi.mock("@/lib/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sdk")>()),
  sdk: {
    threads: { tabs: { get: controls.getTabs, update: controls.updateTabs } },
  },
}));

vi.mock("@/components/promptbox/NewThreadComposer", () => ({
  NewThreadComposer: ({ onSubmit }: NewThreadComposerProps) => (
    <button
      onClick={() =>
        void Promise.resolve(
          onSubmit({
            projectId: "project-repro",
            providerId: "provider-repro",
            model: "model-repro",
            reasoningLevel: "high",
            permissionMode: "auto",
            executionInputSources: {},
            environment: { type: "project-default" },
            input: [{ type: "text", text: "Ownership probe", mentions: [] }],
          }),
        ).catch(controls.submitError)
      }
    >
      Create conversation
    </button>
  ),
}));

const rootId = ROOT_COMPOSE_FIXED_PANEL_STATE_ID;
const thread = { id: "thr_23456789ab", projectId: "project-repro" };

function PanelProbe({ stateId }: { stateId: string }) {
  const state = useFixedPanelTabsState(
    stateId,
    stateId === rootId ? null : stateId,
  );
  return (
    <output data-testid={stateId}>{JSON.stringify(state.secondary)}</output>
  );
}

function DraftControls({ newTab }: { newTab: FixedPanelTab | undefined }) {
  const update = useUpdateFixedPanelTabsState(rootId, null);
  const [, setAutoOpen] = useNavigateToThreadAfterCreatePreference();
  return (
    <>
      <button onClick={() => setAutoOpen(false)}>Disable auto-open</button>
      <button
        onClick={() =>
          update((state) => ({
            ...state,
            secondary: {
              isOpen: true,
              activeTabId: newTab?.id ?? null,
              tabs: newTab ? [newTab] : [],
            },
          }))
        }
      >
        Replace draft tabs
      </button>
    </>
  );
}

function setup(
  tabs: FixedPanelTab[] = [],
  activeTabId = tabs.at(-1)?.id ?? null,
  newTab?: FixedPanelTab,
) {
  window.localStorage.setItem(
    getFixedPanelTabsStateStorageKey({ threadId: rootId }),
    serializeFixedPanelTabsState({
      state: createEmptyFixedPanelTabsState({
        lastUsedAt: Date.now(),
        secondary: { isOpen: tabs.length > 0, activeTabId, tabs },
      }),
    }),
  );
  controls.createThread.mockResolvedValue(thread);
  controls.handoff.mockImplementation(async ({ tabIds }) => [...tabIds]);
  controls.getTabs.mockResolvedValue({ revision: 0, tabs: [] });
  controls.updateTabs.mockImplementation(
    async ({ expectedRevision, tabs: saved }) => ({
      revision: expectedRevision + 1,
      tabs: saved,
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <PanelProbe stateId={rootId} />
        <PanelProbe stateId={thread.id} />
        <DraftControls newTab={newTab} />
        <RootComposeView />
      </Provider>
    </QueryClientProvider>,
  );
  return queryClient;
}

function panel(stateId: string) {
  return JSON.parse(screen.getByTestId(stateId).textContent ?? "null");
}

function browserTab(url = "about:blank") {
  return createBrowserFixedPanelTab({ environmentId: null, url });
}

function submit() {
  return act(async () =>
    fireEvent.click(screen.getByText("Create conversation")),
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetFixedPanelTabsStateForTest();
  vi.resetAllMocks();
});

it("moves the ordered Browser tabs and selected tab before navigation, keeping other draft tabs", async () => {
  const first = browserTab();
  const second = browserTab("https://example.com");
  const terminal = createTerminalFixedPanelTab({
    terminalId: "draft-terminal",
  });
  const queryClient = setup([first, terminal, second], first.id);
  expect(panel(rootId).tabs).toEqual([first, terminal, second]);

  await submit();

  expect(controls.handoff).toHaveBeenCalledExactlyOnceWith({
    threadId: thread.id,
    tabIds: [first.id, second.id],
  });
  expect(controls.navigate).toHaveBeenCalledExactlyOnceWith({
    projectId: thread.projectId,
    threadId: thread.id,
  });
  expect(panel(thread.id)).toMatchObject({
    tabs: [first, second],
    activeTabId: first.id,
    isOpen: true,
  });
  expect(panel(rootId)).toMatchObject({ tabs: [terminal] });
  queryClient.clear();
});

it("creates a thread without requesting a handoff when the draft has no Browser tabs", async () => {
  const queryClient = setup();
  await submit();
  expect(controls.handoff).not.toHaveBeenCalled();
  expect(controls.navigate).toHaveBeenCalledOnce();
  queryClient.clear();
});

it("keeps draft ownership when thread creation fails", async () => {
  const tab = browserTab();
  const queryClient = setup([tab]);
  const error = new Error("create failed");
  controls.createThread.mockRejectedValue(error);

  await submit();

  expect(controls.submitError).toHaveBeenCalledExactlyOnceWith(error);
  expect(controls.handoff).not.toHaveBeenCalled();
  expect(controls.navigate).not.toHaveBeenCalled();
  expect(panel(rootId)).toMatchObject({
    tabs: [tab],
    activeTabId: tab.id,
    isOpen: true,
  });
  expect(panel(thread.id).tabs).toEqual([]);
  queryClient.clear();
});

it("retries a lost native response for the same thread with auto-open disabled", async () => {
  const tab = browserTab();
  const queryClient = setup([tab]);
  fireEvent.click(screen.getByText("Disable auto-open"));
  controls.handoff.mockRejectedValueOnce(new Error("response lost"));

  await submit();

  expect(controls.createThread).toHaveBeenCalledOnce();
  expect(controls.handoff.mock.calls).toEqual([
    [{ threadId: thread.id, tabIds: [tab.id] }],
    [{ threadId: thread.id, tabIds: [tab.id] }],
  ]);
  expect(controls.navigate).not.toHaveBeenCalled();
  expect(panel(thread.id)).toMatchObject({
    tabs: [tab],
    activeTabId: tab.id,
    isOpen: true,
  });
  expect(panel(rootId)).toMatchObject({ tabs: [], isOpen: false });
  queryClient.clear();
});

it("keeps access to draft tabs when native ownership is not confirmed", async () => {
  const tab = browserTab();
  const queryClient = setup([tab]);
  controls.handoff.mockRejectedValue(new Error("IPC unavailable"));

  await submit();

  expect(controls.createThread).toHaveBeenCalledOnce();
  expect(controls.submitError).not.toHaveBeenCalled();
  expect(controls.handoff).toHaveBeenCalledTimes(2);
  expect(panel(rootId)).toMatchObject({ tabs: [tab], isOpen: true });
  expect(panel(thread.id).tabs).toEqual([]);
  queryClient.clear();
});

it("does not transfer tabs closed or opened while thread creation is pending", async () => {
  const tab = browserTab();
  const newTab = browserTab();
  const queryClient = setup([tab], tab.id, newTab);
  const created = createDeferredPromise<typeof thread>();
  controls.createThread.mockReturnValue(created.promise);

  fireEvent.click(screen.getByText("Create conversation"));
  fireEvent.click(screen.getByText("Replace draft tabs"));
  await act(async () => created.resolve(thread));

  expect(controls.handoff).not.toHaveBeenCalled();
  expect(panel(rootId).tabs).toEqual([newTab]);
  expect(panel(thread.id).tabs).toEqual([]);
  queryClient.clear();
});

it.each(["before", "after"] as const)(
  "preserves order and selection when the broker writes %s the renderer",
  async (brokerOrder) => {
    const tabs = [browserTab(), browserTab(), browserTab()];
    const selected = tabs[1]!;
    const queryClient = setup(tabs, selected.id);
    const desktopTarget = {
      hostId: "host",
      instanceId: "window",
      generation: "generation",
    };
    const nativeTabs = tabs.map((tab) => ({ ...tab, desktopTarget }));
    await waitFor(() =>
      expect(getCachedThreadTabs(queryClient, thread.id)).toEqual({
        revision: 0,
        tabs: [],
      }),
    );

    if (brokerOrder === "before") {
      controls.updateTabs.mockRejectedValueOnce(
        new BbHttpError({
          body: null,
          code: "thread_tabs_conflict",
          message: "changed",
          status: 409,
        }),
      );
      controls.getTabs.mockResolvedValue({
        revision: 1,
        tabs: [...nativeTabs].reverse(),
      });
    }

    await submit();

    expect(controls.updateTabs).toHaveBeenCalledWith({
      threadId: thread.id,
      expectedRevision: 0,
      tabs,
    });
    if (brokerOrder === "before") {
      await waitFor(() =>
        expect(controls.updateTabs).toHaveBeenCalledWith({
          threadId: thread.id,
          expectedRevision: 1,
          tabs: nativeTabs,
        }),
      );
    } else {
      expect(panel(thread.id).tabs).toEqual(tabs);
      controls.getTabs.mockResolvedValue({ revision: 2, tabs: nativeTabs });
      invalidateCachedThreadTabs(queryClient, thread.id);
    }
    await waitFor(() =>
      expect(panel(thread.id)).toMatchObject({
        tabs: nativeTabs,
        isOpen: true,
        activeTabId: selected.id,
      }),
    );
    queryClient.clear();
  },
);

it("restores draft order when the destination already received the native snapshot", async () => {
  const first = browserTab();
  const second = browserTab();
  const queryClient = setup([first, second], second.id);
  const desktopTarget = {
    hostId: "host",
    instanceId: "window",
    generation: "generation",
  };
  const adopted = [first, second].map((tab) => ({ ...tab, desktopTarget }));
  await waitFor(() =>
    expect(getCachedThreadTabs(queryClient, thread.id)).toEqual({
      revision: 0,
      tabs: [],
    }),
  );
  controls.getTabs.mockResolvedValue({
    revision: 1,
    tabs: [...adopted].reverse(),
  });
  invalidateCachedThreadTabs(queryClient, thread.id);
  await waitFor(() =>
    expect(panel(thread.id).tabs).toEqual([...adopted].reverse()),
  );

  await submit();

  await waitFor(() =>
    expect(controls.updateTabs).toHaveBeenCalledWith({
      threadId: thread.id,
      expectedRevision: 1,
      tabs: adopted,
    }),
  );
  expect(panel(thread.id)).toMatchObject({
    tabs: adopted,
    activeTabId: second.id,
    isOpen: true,
  });
  expect(panel(rootId).tabs).toEqual([]);
  queryClient.clear();
});
