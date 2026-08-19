// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

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
const { loadViewMode } = await import("./view-preference.js");
const { querySnapshotStorageKey, resetQuerySnapshotStateForTest } =
  await import("./query-snapshot.js");

const tasksRegistration = app.navPanels[0]!;
const navigationView = tasksRegistration.experimental_fixedTabs?.[0]!;
const navigationRegistration = {
  ...tasksRegistration,
  component: navigationView.component,
};

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const OTHER_PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP2";
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
      // No view marker: the shell fills it from the stored preference.
      { kind: "project", projectId: PROJECT_ID, view: null },
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
    // An unknown marker is as good as none — never a silent "list".
    expect(parseTasksRoute(`${PROJECT_ID}?view=kanban`)).toEqual({
      kind: "project",
      projectId: PROJECT_ID,
      view: null,
    });
  });
});

describe("project view preference", () => {
  const openProject = (subPath: string) =>
    renderSlot(
      app.navPanels[0]!,
      { subPath },
      { rpc: seededRpc({ listLabels: () => ({ labels: [] }) }) },
    );

  it("restores the remembered view when the URL names none", async () => {
    const listed = openProject(`${PROJECT_ID}?view=list`);
    // The toggle is the only way a user picks a view; it must persist.
    fireEvent.click(await listed.findByRole("button", { name: "Board" }));
    expect(listed.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: `${PROJECT_ID}?view=board` },
    });
    listed.lifecycle.unmount();

    // Reopening the project without a marker (sidebar click, deep link).
    const reopened = openProject(PROJECT_ID);
    const boardSegment = await reopened.findByRole("button", { name: "Board" });
    expect(boardSegment.getAttribute("aria-pressed")).toBe("true");
    await reopened.findByText("In Review");
  });

  it("keeps per-project choices apart and defaults unseen projects to the last one used", async () => {
    const slot = openProject(`${PROJECT_ID}?view=list`);
    fireEvent.click(await slot.findByRole("button", { name: "Board" }));
    slot.lifecycle.unmount();

    expect(loadViewMode(PROJECT_ID)).toBe("board");
    // A project opened for the first time follows the most recent choice
    // rather than snapping back to the list.
    expect(loadViewMode(OTHER_PROJECT_ID)).toBe("board");

    const other = renderSlot(
      app.navPanels[0]!,
      { subPath: `${OTHER_PROJECT_ID}?view=list` },
      { rpc: seededRpc() },
    );
    fireEvent.click(await other.findByRole("button", { name: "List" }));
    expect(loadViewMode(OTHER_PROJECT_ID)).toBe("list");
    expect(loadViewMode(PROJECT_ID)).toBe("board");
  });

  it("navigates from the sidebar without pinning a view", async () => {
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      { rpc: seededRpc({ listLabels: () => ({ labels: [] }) }) },
    );
    fireEvent.click(await slot.findByText("Tasks Plugin"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: PROJECT_ID },
    });
  });

  it("still toggles when client storage rejects writes", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });
    const slot = openProject(`${PROJECT_ID}?view=list`);
    fireEvent.click(await slot.findByRole("button", { name: "Board" }));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: `${PROJECT_ID}?view=board` },
    });
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
  it("registers navigation as a BB-owned fixed panel tab", () => {
    expect(tasksRegistration.experimental_fixedTabs).toMatchObject([
      {
        id: "navigation",
        title: "Navigation",
        icon: "ListView",
        layout: "flush",
      },
    ]);
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
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await slot.findByText("Manually refreshed list title");
  });

  it("shares manual refresh across the page and right-panel queries", async () => {
    let listTaskCalls = 0;
    let listProjectCalls = 0;
    let holdProjects = false;
    let releaseProjects: (() => void) | null = null;
    const page = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listTasks: () => {
            listTaskCalls += 1;
            return { tasks: [] };
          },
        }),
      },
    );
    const panel = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: async () => {
            listProjectCalls += 1;
            if (holdProjects) {
              await new Promise<void>((resolve) => {
                releaseProjects = resolve;
              });
            }
            return { projects: [project] };
          },
        }),
      },
    );
    await page.findByRole("button", { name: "Refresh tasks" });
    await panel.findByText("Tasks Plugin");
    const initialTaskCalls = listTaskCalls;
    const initialProjectCalls = listProjectCalls;

    holdProjects = true;
    const refresh = page.getByRole("button", {
      name: "Refresh tasks",
    }) as HTMLButtonElement;
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(listTaskCalls).toBeGreaterThan(initialTaskCalls),
    );
    await waitFor(() =>
      expect(listProjectCalls).toBeGreaterThan(initialProjectCalls),
    );
    expect(refresh.disabled).toBe(true);
    const taskCallsWhilePanelPending = listTaskCalls;
    fireEvent.click(refresh);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listTaskCalls).toBe(taskCallsWhilePanelPending);

    releaseProjects?.();
    await waitFor(() => expect(refresh.disabled).toBe(false));
  });

  it("exposes a subtle icon-only refresh control left of New task", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listTasks: () => ({
            tasks: [
              {
                ...pagerTask("TSK-4", "todo", 1),
                title: "Order probe",
                description: "",
                labelIds: [],
              },
            ],
          }),
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("Order probe");

    const refresh = slot.getByRole("button", { name: "Refresh tasks" });
    const newTask = slot.getByRole("button", { name: /New task/i });

    // Icon-only: no visible "Refresh" text; accessible name remains.
    expect(refresh.textContent?.trim() ?? "").not.toMatch(/Refresh/i);
    expect(refresh.getAttribute("aria-label")).toBe("Refresh tasks");
    expect(refresh.className).toMatch(/size-7/);

    // DOM and tab order: refresh → New task. BB owns the right-panel toggle
    // outside this plugin surface.
    expect(
      refresh.compareDocumentPosition(newTask) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const tabbables = [refresh, newTask];
    for (let i = 0; i < tabbables.length - 1; i++) {
      expect(
        tabbables[i]!.compareDocumentPosition(tabbables[i + 1]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }

    // Focus-visible path: control is a native button and can take focus.
    refresh.focus();
    expect(document.activeElement).toBe(refresh);
  });

  it("single-flights manual refresh against deferred RPCs and keeps geometry stable", async () => {
    let listTasksCalls = 0;
    let title = "Flight title A";
    let holdListTasks = false;
    const pendingResolvers: Array<() => void> = [];
    const releaseAllPending = () => {
      const resolvers = pendingResolvers.splice(0, pendingResolvers.length);
      for (const resolve of resolvers) resolve();
    };
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
          listTasks: () => {
            listTasksCalls += 1;
            if (!holdListTasks) {
              return { tasks: [{ ...task, title }] };
            }
            // Generation-driven fetches stay pending until released so the
            // shared in-flight bit tracks real request completion.
            return new Promise((resolve) => {
              pendingResolvers.push(() =>
                resolve({ tasks: [{ ...task, title }] }),
              );
            });
          },
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("Flight title A");
    const baselineCalls = listTasksCalls;
    expect(baselineCalls).toBeGreaterThan(0);

    const refresh = slot.getByRole("button", {
      name: "Refresh tasks",
    }) as HTMLButtonElement;
    const idleClassName = refresh.className;
    expect(idleClassName).toMatch(/size-7/);
    expect(refresh.getAttribute("aria-busy")).not.toBe("true");
    expect(refresh.disabled).toBe(false);
    expect(idleClassName).toMatch(/active:bg-state-active/);

    // Accessible name is the stable tooltip/label contract.
    fireEvent.pointerMove(refresh);
    fireEvent.focus(refresh);
    expect(refresh.getAttribute("aria-label")).toBe("Refresh tasks");

    holdListTasks = true;
    title = "Flight title B";
    fireEvent.click(refresh);
    await waitFor(() => expect(listTasksCalls).toBeGreaterThan(baselineCalls));
    // In-flight while the deferred RPC is still pending.
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.className).toBe(idleClassName);

    const callsWhilePending = listTasksCalls;
    // Rapid re-activation while pending must not bump generation again.
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    // Browser keyboard activation synthesizes click; exercise that path.
    refresh.focus();
    fireEvent.click(refresh);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(listTasksCalls).toBe(callsWhilePending);

    // Stay pending well past any former fixed timer; still disabled.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(refresh.disabled).toBe(true);
    expect(listTasksCalls).toBe(callsWhilePending);

    releaseAllPending();
    await slot.findByText("Flight title B");
    await waitFor(() => {
      expect(
        (
          slot.getByRole("button", {
            name: "Refresh tasks",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    // Deliberate second refresh after completion works.
    title = "Flight title C";
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() =>
      expect(listTasksCalls).toBeGreaterThan(callsWhilePending),
    );
    releaseAllPending();
    await slot.findByText("Flight title C");
    await waitFor(() => {
      const button = slot.getByRole("button", {
        name: "Refresh tasks",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-busy")).not.toBe("true");
    });
    expect(
      (slot.getByRole("button", { name: "Refresh tasks" }) as HTMLButtonElement)
        .className,
    ).toMatch(/size-7/);
  });

  it("retains stale list data when a manual refresh fails, then recovers", async () => {
    let shouldFail = false;
    let title = "Stable title";
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
          listTasks: () => {
            if (shouldFail) throw new Error("refresh failed");
            return { tasks: [{ ...task, title }] };
          },
          listLabels: () => ({ labels: [] }),
          listAttachments: () => ({ attachments: [] }),
          listTaskThreads: () => ({ taskThreads: [] }),
          listComments: () => ({ comments: [] }),
        }),
      },
    );
    await slot.findByText("Stable title");

    shouldFail = true;
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    // Prior data stays on screen (useTasksQuery retains data on error).
    await waitFor(() => expect(slot.getByText("Stable title")).toBeDefined());
    // Failed generation work clears the shared in-flight bit.
    await waitFor(() => {
      expect(
        (
          slot.getByRole("button", {
            name: "Refresh tasks",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    expect(slot.getByText("Stable title")).toBeDefined();

    shouldFail = false;
    title = "Recovered after failure";
    fireEvent.click(slot.getByRole("button", { name: "Refresh tasks" }));
    await slot.findByText("Recovered after failure");
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
          getTaskByKey: () => ({ task: { ...task, title } }),
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

  describe("last-known snapshot", () => {
    const projectsKey = querySnapshotStorageKey("projects");
    const foldersKey = querySnapshotStorageKey("folders");
    const summaryKey = querySnapshotStorageKey("sidebar-summary");
    const summary = {
      projectId: PROJECT_ID,
      taskCount: 3,
      activeAgentCount: 1,
    };
    // An RPC the test settles by hand, so the pre-resolution render is observable.
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    it("never paints the empty state while projects are unknown", async () => {
      const projects = deferred<{ projects: never[] }>();
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        {
          rpc: seededRpc({
            listProjects: () => projects.promise,
            sidebarSummary: () => ({ projects: [] }),
          }),
        },
      );
      // Cold profile: emptiness is not known yet, so the empty state must wait.
      expect(slot.queryByText("No projects yet")).toBeNull();
      projects.resolve({ projects: [] });
      await slot.findByText("No projects yet");
    });

    it("paints the last-known empty state before listProjects resolves", () => {
      window.localStorage.setItem(projectsKey, JSON.stringify([]));
      window.localStorage.setItem(foldersKey, JSON.stringify([]));
      window.localStorage.setItem(summaryKey, JSON.stringify([]));
      const projects = deferred<{ projects: never[] }>();
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        {
          rpc: seededRpc({
            listProjects: () => projects.promise,
            sidebarSummary: () => ({ projects: [] }),
          }),
        },
      );
      // First paint already matches the last truth this browser saw: no list chrome first.
      expect(slot.getByText("No projects yet")).toBeTruthy();
    });

    it("paints last-known projects before listProjects resolves and never flashes empty", async () => {
      window.localStorage.setItem(projectsKey, JSON.stringify([project]));
      window.localStorage.setItem(foldersKey, JSON.stringify([folder]));
      window.localStorage.setItem(summaryKey, JSON.stringify([summary]));
      const projects = deferred<{ projects: (typeof project)[] }>();
      const rpc = seededRpc({ listProjects: () => projects.promise });
      // The sidebar lives in the right-panel navigation view; the page owns
      // the empty state. Both must paint the last-known truth first.
      const panel = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc },
      );
      const page = renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc });
      expect(panel.getByText(project.name)).toBeTruthy();
      expect(page.queryByText("No projects yet")).toBeNull();
      projects.resolve({ projects: [project] });
      await waitFor(() => expect(panel.getByText(project.name)).toBeTruthy());
      expect(page.queryByText("No projects yet")).toBeNull();
    });

    it("ignores a malformed snapshot and loads normally", async () => {
      window.localStorage.setItem(projectsKey, "{not json");
      window.localStorage.setItem(
        summaryKey,
        JSON.stringify([{ projectId: 1 }]),
      );
      const slot = renderSlot(
        app.navPanels[0]!,
        { subPath: "" },
        { rpc: emptyRpc },
      );
      expect(slot.queryByText("No projects yet")).toBeNull();
      await slot.findByText("No projects yet");
    });

    it("prunes snapshots written under an older storage version", async () => {
      // Pruning runs once per page load; this test owns a fresh load.
      resetQuerySnapshotStateForTest();
      window.localStorage.setItem(
        "bb-tasks:query-snapshot:v0:projects",
        JSON.stringify([]),
      );
      const slot = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc: seededRpc() },
      );
      await slot.findByText(project.name);
      expect(
        window.localStorage.getItem("bb-tasks:query-snapshot:v0:projects"),
      ).toBeNull();
      expect(window.localStorage.getItem(projectsKey)).not.toBeNull();
    });

    it("records the fetched projects and counts for the next mount", async () => {
      const slot = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc: seededRpc() },
      );
      await slot.findByText(project.name);
      await waitFor(() => {
        expect(
          JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
        ).toEqual([project]);
        expect(
          JSON.parse(window.localStorage.getItem(foldersKey) ?? "null"),
        ).toEqual([folder]);
        expect(
          JSON.parse(window.localStorage.getItem(summaryKey) ?? "null"),
        ).toEqual([summary]);
      });
    });

    it("keeps the newer projects snapshot when an older request resolves later", async () => {
      // Two hook instances (shell sidebar and list view; here two panels)
      // fetch the same query and write the same storage key. The request that
      // started first but finished last must not replace what the later
      // request already recorded.
      const olderProject = { ...project, name: "Older truth" };
      const newerProject = { ...project, name: "Newer truth" };
      const older = deferred<{ projects: (typeof project)[] }>();
      let calls = 0;
      const rpc = seededRpc({
        listProjects: () => {
          calls += 1;
          return calls === 1 ? older.promise : { projects: [newerProject] };
        },
      });
      renderSlot(navigationRegistration, { subPath: "" }, { rpc });
      const second = renderSlot(
        navigationRegistration,
        { subPath: "" },
        { rpc },
      );
      await second.findByText("Newer truth");
      await waitFor(() =>
        expect(
          JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
        ).toEqual([newerProject]),
      );
      older.resolve({ projects: [olderProject] });
      // Let the older response's continuation run before asserting.
      await act(async () => {
        await older.promise;
      });
      expect(
        JSON.parse(window.localStorage.getItem(projectsKey) ?? "null"),
      ).toEqual([newerProject]);
    });

    it.each(["listFolders", "sidebarSummary"])(
      "keeps loaded projects navigable when %s fails",
      async (method) => {
        const slot = renderSlot(
          navigationRegistration,
          { subPath: "all" },
          {
            rpc: seededRpc({
              [method]: () => Promise.reject(new Error("boom")),
            }),
          },
        );
        // The project loaded; a failed companion request must settle the
        // skeleton rather than hide the rows behind it forever.
        fireEvent.click(await slot.findByText(project.name));
        expect(slot.navigateCalls).toContainEqual({
          method: "toPluginPanel",
          path: "tasks",
          options: { subPath: PROJECT_ID },
        });
      },
    );
  });

  it("shows the error, not the previous route's rows, when a route change fails", async () => {
    // Switching All -> Active reuses the ListView instance. If Active's fetch
    // rejects, the body must not settle onto All's rows: a user would then
    // edit tasks under the wrong context.
    const tasks = [
      {
        ...pagerTask("TSK-4", "todo", 1),
        title: "Scope truth",
        description: "",
        labelIds: [],
      },
    ];
    const rpc = seededRpc({
      listLabels: () => ({ labels: [] }),
      listTasks: (input: { activeOnly?: boolean }) =>
        input.activeOnly === true
          ? Promise.reject(new Error("active fetch failed"))
          : { tasks },
    });
    const Panel = app.navPanels[0]!.component;
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, { rpc });
    await slot.findByText("Scope truth");

    slot.lifecycle.rerender(<Panel subPath="active" />);
    await slot.findByText("Couldn't load tasks");
    expect(slot.queryByText("Scope truth")).toBeNull();
    expect(slot.queryByText("No agents working right now")).toBeNull();
  });

  it("shows the empty state and opens the New project dialog", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: emptyRpc,
      },
    );
    await slot.findByText("No projects yet");
    fireEvent.click(slot.getByRole("button", { name: /New project/ }));
    await slot.findByText("Projects group tasks under a shared key prefix.");
  });

  it("does not paint another scope's empty state while its own rows load", async () => {
    // All tasks has rows; Active has none. Switching Active back to All keeps
    // the same ListView instance, whose query still holds Active's empty
    // result while All refetches; the body must read as loading, never as
    // "No tasks yet", until All's own rows settle.
    const tasks = [
      {
        ...pagerTask("TSK-4", "todo", 1),
        title: "Scope truth",
        description: "",
        labelIds: [],
      },
    ];
    let deferAll = false;
    let releaseAll: (() => void) | null = null;
    const rpc = seededRpc({
      listLabels: () => ({ labels: [] }),
      // The shell's own Active count also calls listTasks (activeOnly), so
      // route by arguments rather than call order.
      listTasks: (input: { activeOnly?: boolean }) => {
        if (input.activeOnly === true) return { tasks: [] };
        if (!deferAll) return { tasks };
        return new Promise((resolve) => {
          releaseAll = () => resolve({ tasks });
        });
      },
    });
    const Panel = app.navPanels[0]!.component;
    const slot = renderSlot(app.navPanels[0]!, { subPath: "all" }, { rpc });
    await slot.findByText("Scope truth");

    slot.lifecycle.rerender(<Panel subPath="active" />);
    await slot.findByText("No agents working right now");

    deferAll = true;
    slot.lifecycle.rerender(<Panel subPath="all" />);
    await waitFor(() => expect(releaseAll).not.toBeNull());
    // In flight: Active's emptiness must not masquerade as All's.
    expect(slot.queryByText("No tasks yet")).toBeNull();
    expect(slot.queryByText("Scope truth")).toBeNull();
    act(() => releaseAll!());
    await slot.findByText("Scope truth");
  });

  it("renders board and task subPaths without plugin-owned sidebar chrome", async () => {
    const boardSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: seededRpc() },
    );
    // The real board renders its status columns (empty listTasks → 0 cards).
    await boardSlot.findByText("Backlog");
    await boardSlot.findByText("In Review");
    expect(boardSlot.getByText("Tasks Plugin")).toBeDefined();
    expect(boardSlot.queryByRole("button", { name: /sidebar/i })).toBeNull();
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

  it("renders right-panel navigation and routes through the plugin panel", async () => {
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("Tasks Plugin");
    expect(slot.getByRole("button", { name: /^All tasks/ })).toBeDefined();
    expect(slot.getByRole("button", { name: "Manage" })).toBeDefined();

    fireEvent.click(slot.getByTitle("Tasks Plugin"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: PROJECT_ID },
    });
  });

  it("does not mount New project queries until the dialog opens", async () => {
    let bbProjectCalls = 0;
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listBbProjects: () => {
            bbProjectCalls += 1;
            return { bbProjects: [] };
          },
        }),
      },
    );
    await slot.findByRole("button", { name: "New project" });
    expect(bbProjectCalls).toBe(0);

    fireEvent.click(slot.getByRole("button", { name: "New project" }));

    await slot.findByText("Projects group tasks under a shared key prefix.");
    expect(bbProjectCalls).toBeGreaterThan(0);
  });

  it("routes 'manage' to the manage panel from right-panel navigation", async () => {
    const panel = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await panel.findByRole("button", { name: "Manage" });
    fireEvent.click(panel.getByRole("button", { name: "Manage" }));
    expect(panel.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "manage" },
    });
    cleanup();

    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "manage" },
      {
        rpc: seededRpc({ listLabels: () => ({ labels: [] }) }),
      },
    );
    await slot.findByText("Labels, agent presets, and folders.");
  });

  it("opens quick-create on bare 'c' but not from editable targets or dialogs", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      {
        rpc: seededRpc(),
      },
    );
    await slot.findByText("All tasks");
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
      permissionMode: "accept-edits",
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
      instructions: "",
      builtin: false,
      createdAt: "2026-07-15T00:00:00.000Z",
    };
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
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
      },
    );
    await slot.findByText("Worktree env");
    expect(slot.getByText("Default env")).toBeDefined();
    expect(slot.getAllByLabelText("Spawns a new worktree")).toHaveLength(1);
  });

  it("refetches sidebar data when invalidation channels fire", async () => {
    let projectCalls = 0;
    const slot = renderSlot(
      navigationRegistration,
      { subPath: "all" },
      {
        rpc: seededRpc({
          listProjects: () => {
            projectCalls += 1;
            return { projects: [project] };
          },
        }),
      },
    );
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
