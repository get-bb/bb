// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import type { ThreadListEntry } from "@bb/domain";
import type { AppSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { jsonResponse } from "@/test/http-test-utils";
import { threadAppsQueryKey } from "@/hooks/queries/query-keys";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";

const PROJECT_ID = "proj_demo";
const noop = () => {};

interface MakeAppArgs {
  id: string;
  name: string;
  icon: AppSummary["icon"];
}

function makeApp({ id, name, icon }: MakeAppArgs): AppSummary {
  return {
    id,
    name,
    entry: { path: "index.html", kind: "html" },
    capabilities: [],
    icon,
  };
}

const STATUS_APP = makeApp({
  id: "status",
  name: "Status",
  icon: { kind: "builtin", name: "ListTodo" },
});
const TERMINAL_APP = makeApp({
  id: "terminal",
  name: "Terminal",
  icon: { kind: "builtin", name: "Terminal" },
});
const NOTES_APP = makeApp({
  id: "notes",
  name: "Notes",
  icon: { kind: "builtin", name: "File" },
});
const PREVIEW_APP = makeApp({
  id: "preview",
  name: "Preview",
  icon: { kind: "builtin", name: "GridView" },
});
const DEPLOY_APP = makeApp({
  id: "deploy",
  name: "Deploy",
  icon: { kind: "builtin", name: "Zap" },
});

function managerOptions(): ThreadRowOptions {
  return {
    kind: "manager",
    indent: "project-child",
    isCollapsed: false,
    managedChildCount: 0,
    managedChildActivity: NO_COLLAPSED_CHILD_ACTIVITY,
    onToggleCollapsed: noop,
  };
}

const defaultOptions: ThreadRowOptions = {
  kind: "default",
  indent: "project-child",
};

function makeManagerThread(id: string): ThreadListEntry {
  return makeThreadListEntry({
    id,
    type: "manager",
    title: "Onboarding revamp",
    titleFallback: "Onboarding revamp",
    environmentWorkspaceDisplayKind: "managed-worktree",
  });
}

interface PanelStateProbeProps {
  threadId: string;
}

function PanelStateProbe({ threadId }: PanelStateProbeProps) {
  const state = useFixedPanelTabsState(threadId);
  return (
    <div data-testid="panel-state">
      {JSON.stringify({
        activeTabId: state.secondary.activeTabId,
        isOpen: state.secondary.isOpen,
      })}
    </div>
  );
}

interface RenderRowArgs {
  apps?: AppSummary[];
  thread: ThreadListEntry;
  options: ThreadRowOptions;
}

function renderRow({ apps, thread, options }: RenderRowArgs) {
  const harness = createQueryClientTestHarness();
  if (apps !== undefined) {
    harness.queryClient.setQueryData(threadAppsQueryKey(thread.id), apps);
  }
  const result = render(
    <ThreadRow
      projectId={PROJECT_ID}
      thread={thread}
      isActive={false}
      options={options}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) =>
        harness.wrapper({
          children: (
            <BrowserRouter>
              <ThreadActionsProvider>
                {children}
                <PanelStateProbe threadId={thread.id} />
              </ThreadActionsProvider>
            </BrowserRouter>
          ),
        }),
    },
  );
  return { ...result, queryClient: harness.queryClient };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThreadRow app cluster", () => {
  it("renders a manager's app icons left of the branch/environment icon", async () => {
    const thread = makeManagerThread("thr_apps_two");
    const { container } = renderRow({
      apps: [STATUS_APP, TERMINAL_APP],
      thread,
      options: managerOptions(),
    });

    const statusButton = await screen.findByRole("button", { name: "Status" });
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();

    const branchIcon = container.querySelector("[data-icon='GitBranch']");
    if (!branchIcon) {
      throw new Error("expected the trailing branch/environment icon");
    }
    // The app icons must precede the trailing branch/environment icon.
    expect(
      statusButton.compareDocumentPosition(branchIcon) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the app in the thread's secondary panel when an icon is clicked", async () => {
    const thread = makeManagerThread("thr_apps_open");
    renderRow({ apps: [STATUS_APP], thread, options: managerOptions() });

    fireEvent.click(await screen.findByRole("button", { name: "Status" }));

    await waitFor(() => {
      const probe = screen.getByTestId("panel-state");
      expect(probe.textContent).toContain('"activeTabId":"app:status"');
      expect(probe.textContent).toContain('"isOpen":true');
    });
  });

  it("collapses extra apps into an informational +N chip that names the hidden apps", async () => {
    const thread = makeManagerThread("thr_apps_overflow");
    renderRow({
      apps: [STATUS_APP, TERMINAL_APP, NOTES_APP, PREVIEW_APP, DEPLOY_APP],
      thread,
      options: managerOptions(),
    });

    expect(await screen.findByRole("button", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notes" })).toBeTruthy();
    // The hidden apps are not rendered as their own openable icons.
    expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deploy" })).toBeNull();

    // The chip surfaces the count and names the hidden apps in its label.
    const overflowChip = screen.getByRole("button", {
      name: "2 more apps: Preview, Deploy",
    });
    expect(overflowChip.textContent).toBe("+2");

    // It is purely informational — clicking it opens nothing.
    fireEvent.click(overflowChip);
    const probe = screen.getByTestId("panel-state");
    expect(probe.textContent).toContain('"activeTabId":null');
    expect(probe.textContent).toContain('"isOpen":false');
  });

  it("renders no app cluster for a manager without apps", async () => {
    const thread = makeManagerThread("thr_apps_none");
    const { container } = renderRow({
      apps: [],
      thread,
      options: managerOptions(),
    });

    await waitFor(() => {
      expect(container.querySelector("[data-icon='GitBranch']")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("button", { name: /more app/ })).toBeNull();
  });

  it("instantiates the apps query only for manager rows", async () => {
    // Stub fetch so the manager's query resolves without real network.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse([])),
    );

    // A manager row mounts the cluster, which creates the thread-apps query.
    const managerRender = renderRow({
      thread: makeManagerThread("thr_manager_query"),
      options: managerOptions(),
    });
    await waitFor(() => {
      expect(
        managerRender.queryClient.getQueryState(
          threadAppsQueryKey("thr_manager_query"),
        ),
      ).toBeDefined();
    });

    // A non-manager row never mounts the cluster, so no query observer or cache
    // entry is ever created for its apps key.
    const leafRender = renderRow({
      thread: makeThreadListEntry({ id: "thr_leaf_no_query" }),
      options: defaultOptions,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      leafRender.queryClient.getQueryState(
        threadAppsQueryKey("thr_leaf_no_query"),
      ),
    ).toBeUndefined();
  });
});
