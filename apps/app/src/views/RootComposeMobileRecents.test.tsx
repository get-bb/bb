// @vitest-environment jsdom

import type { ThreadListEntry } from "@bb/domain";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
import { mobileRecentsCollapsedThreadIdsAtom } from "./mobile-recents-collapse";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { SystemEnvironmentProvider } from "@bb/server-contract";
import { systemEnvironmentProvidersQueryKey } from "@/hooks/queries/environment-provider-queries";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { CORE_THREAD_ACTIONS } from "@/lib/thread-actions/core-thread-actions";
import { ThreadActionCollectors } from "@/lib/thread-actions/thread-action-registry";

const threadActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestDelete: vi.fn(),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => threadActions,
}));

const sdkThreads = vi.hoisted(() => ({
  pin: vi.fn(async ({ threadId }: { threadId: string }) => ({
    id: threadId,
  })),
}));

vi.mock("@/lib/sdk", () => ({ sdk: { threads: sdkThreads } }));

const personalProvider: SystemEnvironmentProvider = {
  machineProviderId: null,
  id: "personal-workspace",
  displayName: "Personal workspace",
  description: "Prepare a workspace for this thread.",
  icon: "Folder",
  logoUrl: null,
  pluginId: "environment-personal-workspace",
  acceptsEmptyInputs: true,
  machineAvailability: {},
  availability: null,
  requires: {
    projectCheckout: false,
    gitCheckout: false,
    gitRemote: false,
    projectless: true,
  },
  inputs: null,
};

function TestProviders({
  children,
  store = createStore(),
}: {
  children: ReactNode;
  store?: ReturnType<typeof createStore>;
}) {
  return (
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadActionCollectors
            coreRegistrations={CORE_THREAD_ACTIONS}
            requestRename={() => {}}
          />
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>
  );
}

function storeWithCollapsedThreads(threadIds: string[]) {
  const store = createStore();
  store.set(mobileRecentsCollapsedThreadIdsAtom, threadIds);
  return store;
}

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_mobile",
    projectId: "proj_mobile",
    title: "Mobile activity",
    titleFallback: "Mobile activity",
    status: "active",
    lastReadAt: 1,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 1,
      activeGoalCount: 1,
    },
    runtime: {
      displayStatus: "active",
    },
    ...overrides,
  });
}

const IDLE_ACTIVITY: ThreadListEntry["activity"] = {
  activeWorkflowCount: 0,
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activePlanModeCount: 0,
  activeGoalCount: 0,
};

function makeIdleThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThread({
    status: "idle",
    runtime: {
      displayStatus: "idle",
    },
    activity: IDLE_ACTIVITY,
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("mobile recents hierarchy interaction", () => {
  function renderTree() {
    return render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              id: "thr_parent",
              title: "Rework folder model",
              titleFallback: "Rework folder model",
              latestAttentionAt: 10,
            }),
            makeThread({
              id: "thr_child",
              title: "Audit folder query paths",
              titleFallback: "Audit folder query paths",
              parentThreadId: "thr_parent",
              latestAttentionAt: 9,
            }),
          ]}
        />
      </TestProviders>,
    );
  }

  it("collapses and expands children from the provider tile and caret", () => {
    const { container } = renderTree();

    expect(container.querySelector("a button")).toBeNull();

    expect(screen.getByText("Audit folder query paths")).not.toBeNull();
    const collapse = screen.getByRole("button", {
      name: "Hide threads under Rework folder model",
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");

    const providerTile = collapse.querySelector("span.size-7");
    if (!(providerTile instanceof HTMLElement)) {
      throw new Error("Expected provider tile inside the disclosure button");
    }
    fireEvent.click(providerTile);

    expect(screen.queryByText("Audit folder query paths")).toBeNull();
    const expand = screen.getByRole("button", {
      name: "Show threads under Rework folder model",
    });
    expect(expand.getAttribute("aria-expanded")).toBe("false");

    const caret = expand.querySelector("svg");
    if (caret === null) {
      throw new Error("Expected disclosure caret");
    }
    fireEvent.click(caret);
    expect(screen.getByText("Audit folder query paths")).not.toBeNull();
  });

  it.each([
    {
      label: "Thread needs user input",
      child: makeIdleThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        hasPendingInteraction: true,
      }),
    },
    {
      label: "Plan mode active",
      child: makeIdleThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        activity: {
          ...IDLE_ACTIVITY,
          activePlanModeCount: 1,
        },
      }),
    },
    {
      label: "Thread working",
      child: makeThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        activity: IDLE_ACTIVITY,
      }),
    },
  ])(
    "renders child-only $label state on a collapsed parent",
    ({ child, label }) => {
      render(
        <TestProviders store={storeWithCollapsedThreads(["thr_parent"])}>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={new Map()}
            providersById={new Map()}
            showCreatingRow={false}
            threads={[
              makeIdleThread({
                id: "thr_parent",
                lastReadAt: 10,
                latestAttentionAt: 5,
              }),
              child,
            ]}
          />
        </TestProviders>,
      );

      expect(screen.getByLabelText(label)).not.toBeNull();
      expect(
        screen.getByRole("link", {
          name: `Open Mobile activity — ${label}`,
        }),
      ).not.toBeNull();
    },
  );

  it("renders a child-only draft state on a collapsed parent", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_child-3",
      JSON.stringify({ text: "Continue child work", attachments: [] }),
    );
    render(
      <TestProviders store={storeWithCollapsedThreads(["thr_parent"])}>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeIdleThread({
              id: "thr_parent",
              lastReadAt: 10,
              latestAttentionAt: 5,
            }),
            makeIdleThread({
              id: "thr_child",
              parentThreadId: "thr_parent",
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(
      screen.getByLabelText("Thread has unsubmitted draft"),
    ).not.toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Open Mobile activity — Thread has unsubmitted draft",
      }),
    ).not.toBeNull();
  });

  it("reveals a highlighted thread whose parent is collapsed", () => {
    const store = storeWithCollapsedThreads(["thr_parent"]);
    render(
      <TestProviders store={store}>
        <RootComposeMobileRecents
          highlightedThreadId="thr_child"
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              id: "thr_parent",
              title: "Rework folder model",
              titleFallback: "Rework folder model",
            }),
            makeThread({
              id: "thr_child",
              title: "Audit folder query paths",
              titleFallback: "Audit folder query paths",
              parentThreadId: "thr_parent",
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(screen.getByText("Audit folder query paths")).not.toBeNull();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([]);
  });

  it("gives only the parent a toggle and indents the child", () => {
    renderTree();

    expect(screen.getAllByRole("button")).toHaveLength(1);
    const [parentRow, childRow] = screen.getAllByRole("listitem");
    if (!parentRow || !childRow) {
      throw new Error("Expected a parent and a child row");
    }
    expect(parentRow.style.paddingLeft).toBe("8px");
    expect(childRow.style.paddingLeft).toBe("32px");
  });
});

describe("mobile recents section", () => {
  it("keeps the Recent label pinned while the list scrolls under it", () => {
    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </TestProviders>,
    );

    const label = screen.getByText("Recent").parentElement;
    if (!(label instanceof HTMLElement)) {
      throw new Error("Expected a Recent label wrapper");
    }
    expect(label.className).toContain("sticky");
    expect(label.className).toContain("top-0");
    expect(label.className).toContain("bg-background");
    expect(label.querySelector('[data-overflow-fade="below"]')).not.toBeNull();
  });
});

describe("mobile recent thread rows", () => {
  it("shows project and relative activity on a metadata line", () => {
    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map([["proj_mobile", "bb"]])}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              latestAttentionAt: Date.now() - 3 * 60 * 60 * 1000,
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(screen.getByText("bb \u00b7 3h ago")).not.toBeNull();
  });

  it("includes the worktree branch when the thread has one", () => {
    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map([["proj_mobile", "bb"]])}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              environmentBranchName: "bb/mobile-home",
              environmentProviderId: null,
              latestAttentionAt: Date.now() - 3 * 60 * 60 * 1000,
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(
      screen.getByText("bb \u00b7 bb/mobile-home \u00b7 3h ago"),
    ).not.toBeNull();
  });

  it("does not repeat the project name as the workspace segment", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(systemEnvironmentProvidersQueryKey({}), [
      personalProvider,
    ]);
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={new Map([["proj_mobile", "Personal"]])}
            providersById={new Map()}
            showCreatingRow={false}
            threads={[
              makeThread({
                environmentId: "env_personal",
                environmentProviderId: "personal-workspace",
                latestAttentionAt: Date.now() - 3 * 60 * 60 * 1000,
                activity: {
                  activeWorkflowCount: 0,
                  activeBackgroundAgentCount: 0,
                  activeBackgroundCommandCount: 0,
                  activePlanModeCount: 0,
                  activeGoalCount: 0,
                },
              }),
            ]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Personal \u00b7 3h ago")).not.toBeNull();
  });

  it("drops the status slot entirely when a thread has no indicator", () => {
    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              lastReadAt: 10,
              latestAttentionAt: 5,
              runtime: {
                displayStatus: "idle",
              },
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(
      screen.getByRole("link").querySelectorAll("span.size-6"),
    ).toHaveLength(0);
  });
});

describe("RootComposeMobileRecents", () => {
  it("opens thread actions on a long press without following the thread link", async () => {
    vi.useFakeTimers();
    const thread = makeThread();
    render(
      <TestProviders>
        <CompactViewportOverrideProvider isCompactViewport>
          <RootComposeMobileRecents
            highlightedThreadId={null}
            projectNamesById={new Map()}
            providersById={new Map()}
            showCreatingRow={false}
            threads={[thread]}
          />
        </CompactViewportOverrideProvider>
      </TestProviders>,
    );
    const link = screen.getByRole("link");
    fireEvent.pointerDown(link, {
      pointerId: 1,
      pointerType: "touch",
      isPrimary: true,
      clientX: 100,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(700));
    fireEvent.pointerUp(link, { pointerId: 1, pointerType: "touch" });
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    const pin = screen.getByRole("menuitem", { name: "Pin" });
    fireEvent.pointerDown(pin, { pointerType: "touch" });
    fireEvent.click(pin);
    vi.useRealTimers();
    await waitFor(() =>
      expect(sdkThreads.pin).toHaveBeenCalledWith({ threadId: thread.id }),
    );
  });

  it("shows concurrent Plan activity before the runtime spinner", () => {
    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </TestProviders>,
    );

    expect(screen.getByLabelText("Plan mode active")).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Goal active")).toBeNull();
  });

  it("keeps the mobile working draft state ahead of runtime activity", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[makeThread()]}
        />
      </TestProviders>,
    );

    expect(
      screen.getByLabelText("Thread working with unsubmitted draft"),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });

  it("includes only the resolved unread-success indicator in the link label", () => {
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_mobile-thr_mobile-3",
      JSON.stringify({ text: "Keep editing", attachments: [] }),
    );

    render(
      <TestProviders>
        <RootComposeMobileRecents
          highlightedThreadId={null}
          projectNamesById={new Map()}
          providersById={new Map()}
          showCreatingRow={false}
          threads={[
            makeThread({
              status: "idle",
              activity: {
                activeWorkflowCount: 0,
                activeBackgroundAgentCount: 0,
                activeBackgroundCommandCount: 0,
                activePlanModeCount: 0,
                activeGoalCount: 0,
              },
              runtime: {
                displayStatus: "idle",
              },
            }),
          ]}
        />
      </TestProviders>,
    );

    expect(
      screen.getByRole("link", {
        name: "Open Mobile activity — Unread thread succeeded",
      }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
  });
});
