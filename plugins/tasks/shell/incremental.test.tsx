// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { makeTask } from "../test-fixtures.js";
import type { Task } from "../shared/contract.js";

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

const app = await loadPluginApp(() => import("../app"));

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 5,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(key: string, status: Task["status"], position: number) {
  return makeTask({
    id: `01HZZZZZZZZZZZZZZZZZZZZ${key.replace("-", "")}`,
    projectId: PROJECT_ID,
    number: position,
    key,
    title: `${key} title`,
    status,
    position,
    description: "",
    labelIds: [],
  });
}

interface Counters {
  listTasks: number;
  getTask: string[];
  listAttachments: string[];
}

function trackedRpc(store: Map<string, Task>, counters: Counters) {
  const handlers = {
    listProjects: () => ({ projects: [project] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({
      projects: [
        { projectId: PROJECT_ID, taskCount: store.size, activeAgentCount: 0 },
      ],
    }),
    listLabels: () => ({ labels: [] }),
    listComments: () => ({ comments: [] }),
    listTaskThreads: () => ({ taskThreads: [] }),
    getTaskByKey: () => ({ task: null }),
    listTasks: (input: { statuses?: string[]; activeOnly?: boolean }) => {
      counters.listTasks += 1;
      if (input.activeOnly === true) return { tasks: [] };
      return {
        tasks: [...store.values()].filter(
          (entry) =>
            input.statuses === undefined ||
            input.statuses.length === 0 ||
            input.statuses.includes(entry.status),
        ),
      };
    },
    getTask: (input: { taskId: string }) => {
      counters.getTask.push(input.taskId);
      return { task: store.get(input.taskId) ?? null };
    },
    listAttachments: (input: { taskId: string }) => {
      counters.listAttachments.push(input.taskId);
      return { attachments: [] };
    },
  };
  return handlers as never;
}

function seed(...tasks: Task[]) {
  return new Map(tasks.map((entry) => [entry.id, entry]));
}

function counters(): Counters {
  return { listTasks: 0, getTask: [], listAttachments: [] };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("incremental task list updates", () => {
  it("patches one row per burst instead of refetching the list", async () => {
    const first = task("TSK-1", "todo", 1);
    const second = task("TSK-2", "in_progress", 2);
    const store = seed(first, second);
    const calls = counters();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: trackedRpc(store, calls) },
    );
    await slot.findByText("TSK-1 title");
    await waitFor(() => expect(calls.listTasks).toBeGreaterThan(0));
    const settled = calls.listTasks;

    store.set(first.id, { ...first, title: "TSK-1 renamed" });
    for (let index = 0; index < 5; index += 1) {
      await slot.emitRealtime("tasks:changed", {
        taskId: first.id,
        projectId: PROJECT_ID,
      });
    }
    await slot.findByText("TSK-1 renamed");
    expect(calls.getTask).toEqual([first.id]);
    expect(calls.listTasks).toBe(settled);
    expect(slot.getByText("TSK-2 title")).toBeDefined();
  });

  it("drops a deleted task without a refetch", async () => {
    const first = task("TSK-1", "todo", 1);
    const second = task("TSK-2", "todo", 2);
    const store = seed(first, second);
    const calls = counters();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: trackedRpc(store, calls) },
    );
    await slot.findByText("TSK-2 title");
    await waitFor(() => expect(calls.listTasks).toBeGreaterThan(0));
    const settled = calls.listTasks;

    store.delete(second.id);
    await slot.emitRealtime("tasks:changed", {
      taskId: second.id,
      projectId: PROJECT_ID,
    });
    await waitFor(() => expect(slot.queryByText("TSK-2 title")).toBeNull());
    expect(calls.listTasks).toBe(settled);
  });

  it("falls back to a full refetch when a signal names no task", async () => {
    const first = task("TSK-1", "todo", 1);
    const store = seed(first);
    const calls = counters();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "all" },
      { rpc: trackedRpc(store, calls) },
    );
    await slot.findByText("TSK-1 title");
    await waitFor(() => expect(calls.listTasks).toBeGreaterThan(0));
    const settled = calls.listTasks;

    store.set(first.id, { ...first, title: "TSK-1 resynced" });
    await slot.emitRealtime("tasks:changed", { projectId: PROJECT_ID });
    await slot.findByText("TSK-1 resynced");
    expect(calls.listTasks).toBeGreaterThan(settled);
    expect(calls.getTask).toEqual([]);
  });
});

describe("incremental board updates", () => {
  it("re-reads only the changed card", async () => {
    const first = task("TSK-1", "todo", 1);
    const second = task("TSK-2", "done", 2);
    const store = seed(first, second);
    const calls = counters();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: trackedRpc(store, calls) },
    );
    await slot.findByText("TSK-2 title");
    const settledList = calls.listTasks;
    const settledAttachments = calls.listAttachments.length;

    store.set(first.id, {
      ...first,
      status: "in_review",
      title: "TSK-1 moved",
    });
    await slot.emitRealtime("tasks:changed", {
      taskId: first.id,
      projectId: PROJECT_ID,
    });
    await slot.findByText("TSK-1 moved");
    expect(calls.getTask).toEqual([first.id]);
    expect(calls.listAttachments.slice(settledAttachments)).toEqual([first.id]);
    expect(calls.listTasks).toBe(settledList);
  });

  it("ignores thread signals for tasks outside the board", async () => {
    const first = task("TSK-1", "todo", 1);
    const store = seed(first);
    const calls = counters();
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: `${PROJECT_ID}?view=board` },
      { rpc: trackedRpc(store, calls) },
    );
    await slot.findByText("TSK-1 title");
    const settledList = calls.listTasks;

    await slot.emitRealtime("threads:changed", {
      taskId: "01HZZZZZZZZZZZZZZZZZZZZOTHER",
      projectId: "01HZZZZZZZZZZZZZZZZZZZZZP9",
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls.listTasks).toBe(settledList);
    expect(calls.getTask).toEqual([]);
  });
});
