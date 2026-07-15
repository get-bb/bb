// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(cleanup);

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

describe("tasks app shell", () => {
  it("shows the empty state and opens the New project dialog", async () => {
    const slot = renderSlot(app.navPanels[0]!, { subPath: "" }, {
      rpc: emptyRpc,
    });
    await slot.findByText("No projects yet");
    fireEvent.click(slot.getByRole("button", { name: /New project/ }));
    await slot.findByText("Project creation coming soon");
  });

  it("renders sidebar data and routes project/board/task subPaths", async () => {
    const boardSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: seededRpc() },
    );
    await boardSlot.findByText(
      `Board view coming soon · projectId=${PROJECT_ID}`,
    );
    expect(boardSlot.getAllByText("Tasks Plugin").length).toBeGreaterThan(0);
    expect(boardSlot.getByText("All tasks")).toBeDefined();
    cleanup();

    const taskSlot = renderSlot(
      app.navPanels[0]!,
      { subPath: "task/TSK-4" },
      { rpc: seededRpc() },
    );
    await taskSlot.findByText("Task detail coming soon · taskKey=TSK-4");
    // Esc returns to the previous list/board (default: all tasks).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(taskSlot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "all" },
    });
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
