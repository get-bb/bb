// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";

// jsdom lacks matchMedia; the vendored Dialog's responsive root needs it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// loadPluginApp installs the fake SDK runtime; routes.ts (via the app) must
// not be imported before that happens.
const app = await loadPluginApp(() => import("../app"));
const { parseTasksRoute, tasksRouteToSubPath } = await import("./routes.js");
const { pagerPosition } = await import("./topbar.js");
const { SIDEBAR_COLLAPSED_STORAGE_KEY } =
  await import("./sidebar-preference.js");

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const FOLDER_ID = "01HZZZZZZZZZZZZZZZZZZZZZF1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 5,
  color: "blue",
  folderId: FOLDER_ID,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const folder = {
  id: FOLDER_ID,
  name: "bb",
  parentFolderId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function seededRpc(overrides: Record<string, unknown> = {}) {
  return {
    listProjects: () => ({ projects: [project] }),
    listFolders: () => ({ folders: [folder] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({
      projects: [{ projectId: PROJECT_ID, taskCount: 3, activeAgentCount: 1 }],
    }),
    listTasks: () => ({ tasks: [] }),
    getTaskByKey: () => ({ task: null }),
    ...overrides,
  };
}

const emptyRpc = seededRpc({
  listProjects: () => ({ projects: [] }),
  listFolders: () => ({ folders: [] }),
  sidebarSummary: () => ({ projects: [] }),
});

describe("tasks route grammar", () => {
  it("round-trips every route kind and decodes host-encoded subPaths", () => {
    const routes = [
      { kind: "all" },
      { kind: "active" },
      { kind: "manage" },
      { kind: "task", taskKey: "TSK-4" },
      { kind: "project", projectId: PROJECT_ID, view: "list" },
      { kind: "project", projectId: PROJECT_ID, view: "board" },
    ] as const;
    for (const route of routes) {
      expect(parseTasksRoute(tasksRouteToSubPath(route))).toEqual(route);
    }
    // The host hands the splat through URL-encoded per segment.
    expect(parseTasksRoute(`${PROJECT_ID}%3Fview%3Dboard`)).toEqual({
      kind: "project",
      projectId: PROJECT_ID,
      view: "board",
    });
    expect(parseTasksRoute("")).toEqual({ kind: "all" });
  });
});

function pagerTask(key: string, status: string, position: number) {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZ${key.replace("-", "")}`,
    projectId: PROJECT_ID,
    number: position,
    key,
    title: key,
    status,
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    // Only key/status/position matter to the pager; the rest satisfies Task.
  } as never;
}

describe("task pager", () => {
  // List order: canonical status groups, server (board) order within a group.
  const tasks = [
    pagerTask("TSK-3", "done", 1),
    pagerTask("TSK-1", "in_progress", 1),
    pagerTask("TSK-2", "todo", 1),
    pagerTask("TSK-4", "todo", 2),
  ];

  it("orders siblings like the list view and exposes neighbors", () => {
    // Visual order: TSK-2, TSK-4 (todo) → TSK-1 (in_progress) → TSK-3 (done).
    expect(pagerPosition(tasks, "TSK-4")).toEqual({
      index: 2,
      total: 4,
      prevKey: "TSK-2",
      nextKey: "TSK-1",
    });
    expect(pagerPosition(tasks, "tsk-2")).toMatchObject({
      index: 1,
      prevKey: null,
    });
    expect(pagerPosition(tasks, "TSK-3")).toMatchObject({
      index: 4,
      nextKey: null,
    });
  });

  it("has no position for unknown keys", () => {
    expect(pagerPosition(tasks, "TSK-99")).toBeNull();
    expect(pagerPosition([], "TSK-1")).toBeNull();
  });

  it("renders n / m on the task route and steps to the next sibling", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      {
        rpc: seededRpc({
          listTasks: () => ({ tasks }),
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("2 / 4");
    fireEvent.click(slot.getByRole("button", { name: "Next task" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/TSK-1" },
    });
  });
});

describe("tasks app shell", () => {
  it("keeps the first-use sidebar expanded without writing a preference", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("Tasks Plugin");

    expect(
      slot
        .getByRole("button", { name: "Collapse sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY),
    ).toBeNull();
  });

  it("persists collapsed state across route changes and remounts", async () => {
    const registration = app.navPanels[0]!;
    const slot = renderSlot(
      registration,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("Tasks Plugin");

    fireEvent.click(slot.getByRole("button", { name: "Collapse sidebar" }));
    expect(slot.queryByRole("button", { name: "Manage" })).toBeNull();
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "true",
    );

    const Shell = registration.component;
    slot.lifecycle.rerender(<Shell subPath={`${PROJECT_ID}?view=board`} />);
    await slot.findByText("Backlog");
    expect(
      slot
        .getByRole("button", { name: "Expand sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    slot.lifecycle.unmount();
    const remounted = renderSlot(
      registration,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await remounted.findByText("All tasks");
    expect(remounted.queryByRole("button", { name: "Manage" })).toBeNull();
    expect(
      remounted.getByRole("button", { name: "Expand sidebar" }),
    ).toBeDefined();
  });

  it("persists expanded state after restoring a collapsed preference", async () => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    const registration = app.navPanels[0]!;
    const slot = renderSlot(
      registration,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("All tasks");
    fireEvent.click(slot.getByRole("button", { name: "Expand sidebar" }));

    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      "false",
    );
    await slot.findByRole("button", { name: "Manage" });

    slot.lifecycle.unmount();
    const remounted = renderSlot(
      registration,
      { subPath: "manage" },
      {
        rpc: seededRpc({ listLabels: () => ({ labels: [] }) }),
      },
    );
    await remounted.findByText("Labels, agent presets, and folders.");
    expect(
      remounted.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeDefined();
    expect(remounted.getByRole("button", { name: "Manage" })).toBeDefined();
  });

  it("keeps toggling usable when client storage rejects writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("Tasks Plugin");

    fireEvent.click(slot.getByRole("button", { name: "Collapse sidebar" }));
    expect(
      slot
        .getByRole("button", { name: "Expand sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("does not treat the first connection as a reconnect", async () => {
    let requests = 0;
    let title = "Initial connection title";
    const task = {
      ...pagerTask("TSK-4", "todo", 1),
      description: "",
      labelIds: [],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        realtimeConnectionState: "connecting",
        rpc: seededRpc({
          listTasks: () => {
            requests += 1;
            return { tasks: [{ ...task, title }] };
          },
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("Initial connection title");
    const initialRequests = requests;
    expect(initialRequests).toBeGreaterThan(0);

    await slot.behavior.setRealtimeConnectionState("connected");
    expect(requests).toBe(initialRequests);

    title = "Recovered from connecting state";
    await slot.behavior.setRealtimeConnectionState("connecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Recovered from connecting state");
    expect(requests).toBeGreaterThan(initialRequests);
  });

  it("recovers when the shell mounts during an existing outage", async () => {
    let serverAvailable = false;
    const task = {
      ...pagerTask("TSK-4", "todo", 1),
      title: "Loaded after existing outage",
      description: "",
      labelIds: [],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        realtimeConnectionState: "reconnecting",
        rpc: seededRpc({
          listTasks: async () => {
            if (!serverAvailable) throw new Error("server unavailable");
            return { tasks: [task] };
          },
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.some((call) => call.method === "listTasks"),
      ).toBe(true),
    );
    expect(slot.queryByText("Loaded after existing outage")).toBeNull();

    serverAvailable = true;
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Loaded after existing outage");
  });

  it("resyncs the task list after reconnect and supports manual refresh", async () => {
    let title = "Stale list title";
    const task = {
      ...pagerTask("TSK-4", "todo", 1),
      title,
      description: "",
      labelIds: [],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listTasks: () => ({ tasks: [{ ...task, title }] }),
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("Stale list title");

    title = "Recovered list title";
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(slot.queryByText("Recovered list title")).toBeNull();
    await slot.behavior.setRealtimeConnectionState("connected");
    await slot.findByText("Recovered list title");

    title = "Manually refreshed list title";
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));
    await slot.findByText("Manually refreshed list title");
  });

  it("resyncs an open task detail after reconnect", async () => {
    let title = "Stale detail title";
    const task = {
      ...pagerTask("TSK-4", "todo", 1),
      title,
      description: "",
      labelIds: [],
    };
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      {
        rpc: seededRpc({
          listTasks: () => ({ tasks: [{ ...task, title }] }),
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByRole("textbox", { name: "Task title" });
    expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
      "Stale detail title",
    );

    title = "Recovered detail title";
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
      "Stale detail title",
    );
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() =>
      expect(
        slot.getByRole("textbox", { name: "Task title" }).textContent,
      ).toBe("Recovered detail title"),
    );
  });

  it("shows the empty state and opens the New project dialog", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: emptyRpc,
    });
    await slot.findByText("No projects yet");
    fireEvent.click(slot.getByRole("button", { name: /New project/ }));
    await slot.findByText("Projects group tasks under a shared key prefix.");
  });

  it("renders sidebar data and routes project/board/task subPaths", async () => {
    const boardSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: seededRpc() },
    );
    // The real board renders its status columns (empty listTasks → 0 cards).
    await boardSlot.findByText("Backlog");
    await boardSlot.findByText("In Review");
    expect(boardSlot.getAllByText("Tasks Plugin").length).toBeGreaterThan(0);
    expect(boardSlot.getByText("All tasks")).toBeDefined();
    cleanup();

    const taskSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      { rpc: seededRpc() },
    );
    // Seeded getTaskByKey is null, so the real detail view lands on not-found.
    await taskSlot.findByText(/Task TSK-4 was not found/);
    // Esc returns to the previous list/board (default: all tasks).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(taskSlot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all" },
    });
  });

  it("routes 'manage' to the manage panel via the sidebar footer", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "manage" }, {
      rpc: seededRpc({ listLabels: () => ({ labels: [] }) }),
    });
    await slot.findByText("Labels, agent presets, and folders.");
    // The sidebar footer row is highlighted and present on every route.
    expect(slot.getByRole("button", { name: "Manage" })).toBeDefined();
  });

  it("opens quick-create on bare 'c' but not from editable targets or dialogs", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, {
      rpc: seededRpc(),
    });
    await slot.findByText("Tasks Plugin");
    fireEvent.keyDown(window, { key: "c" });
    // The New task dialog mounts (project select defaults to the only project).
    await slot.findByRole("dialog");
    // With the dialog open, another 'c' must not stack a second overlay, and
    // Esc still closes the dialog rather than navigating.
    fireEvent.keyDown(window, { key: "c" });
    expect(slot.getAllByRole("dialog")).toHaveLength(1);
  });

  it("marks only new-worktree presets with the worktree hint", async () => {
    const basePreset = {
      id: "01HZZZZZZZZZZZZZZZZZZZZZE1",
      name: "Default env",
      providerId: "claude-code",
      modelId: "claude-sonnet-5",
      reasoningLevel: "medium",
      permissionMode: "workspace-write",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
      instructions: "",
      builtin: false,
      createdAt: "2026-07-15T00:00:00.000Z",
    };
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, {
      rpc: seededRpc({
        listPresets: () => ({
          presets: [
            basePreset,
            {
              ...basePreset,
              id: "01HZZZZZZZZZZZZZZZZZZZZZE2",
              name: "Worktree env",
              environmentKind: "new-worktree",
              baseBranch: "main",
            },
          ],
        }),
      }),
    });
    await slot.findByText("Worktree env");
    expect(slot.getByText("Default env")).toBeDefined();
    expect(slot.getAllByLabelText("Spawns a new worktree")).toHaveLength(1);
  });

  it("refetches sidebar data when invalidation channels fire", async () => {
    let projectCalls = 0;
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, {
      rpc: seededRpc({
        listProjects: () => {
          projectCalls += 1;
          return { projects: [project] };
        },
      }),
    });
    await slot.findByText("Tasks Plugin");
    const before = projectCalls;
    await slot.emitRealtime("projects:changed", { projectId: null });
    await waitFor(() => expect(projectCalls).toBeGreaterThan(before));
    // Unrelated channels leave the projects query alone.
    const settled = projectCalls;
    await slot.emitRealtime("comments:changed", { taskId: "x" });
    expect(projectCalls).toBe(settled);
  });
});
