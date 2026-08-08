// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";
import { LIST_PREFERENCE_STORAGE_KEY } from "./list-preference.js";

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
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const PROJECT_A = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const PROJECT_B = "01HZZZZZZZZZZZZZZZZZZZZZP2";

const projectA = {
  id: PROJECT_A,
  name: "Alpha",
  prefix: "ALP",
  nextTaskNumber: 20,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-08-08T00:00:00.000Z",
};

const projectB = {
  id: PROJECT_B,
  name: "Beta",
  prefix: "BET",
  nextTaskNumber: 20,
  color: "green",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-08-08T00:00:00.000Z",
};

function task(
  projectId: string,
  number: number,
  overrides: Partial<Task> = {},
): Task {
  const prefix = projectId === PROJECT_A ? "ALP" : "BET";
  return {
    id: `${projectId.slice(0, -2)}T${projectId.slice(-1)}${number}`,
    projectId,
    number,
    key: `${prefix}-${number}`,
    title: `${prefix} task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

interface ListTasksInput {
  projectId?: string;
  statuses?: Task["status"][];
  priorities?: Task["priority"][];
  parentTaskId?: string | null;
}

function taskRpc(allTasks: readonly Task[]) {
  const listTasksCalls: ListTasksInput[] = [];
  const rpc = {
    listProjects: () => ({ projects: [projectA, projectB] }),
    listFolders: () => ({ folders: [] }),
    listPresets: () => ({ presets: [] }),
    sidebarSummary: () => ({ projects: [] }),
    listLabels: () => ({ labels: [] }),
    listTasks: (input: ListTasksInput) => {
      listTasksCalls.push(input);
      let tasks = [...allTasks];
      if (input.projectId !== undefined) {
        tasks = tasks.filter((entry) => entry.projectId === input.projectId);
      }
      if (input.statuses !== undefined) {
        const statuses = new Set(input.statuses);
        tasks = tasks.filter((entry) => statuses.has(entry.status));
      }
      if (input.priorities !== undefined) {
        const priorities = new Set(input.priorities);
        tasks = tasks.filter((entry) => priorities.has(entry.priority));
      }
      if (input.parentTaskId !== undefined) {
        tasks = tasks.filter(
          (entry) => entry.parentTaskId === input.parentTaskId,
        );
      }
      return { tasks, nextCursor: null };
    },
    listTaskThreads: () => ({ taskThreads: [] }),
    listComments: () => ({ comments: [] }),
    listAttachments: () => ({ attachments: [] }),
  };
  return Object.assign(rpc, { listTasksCalls });
}

function renderList(subPath: string, tasks: readonly Task[]) {
  const rpc = taskRpc(tasks);
  const slot = renderSlot(app.navPanels[0]!, { subPath }, { rpc });
  return { rpc, slot };
}

async function renderedKeys(slot: ReturnType<typeof renderSlot>) {
  await waitFor(() =>
    expect(slot.container.querySelector("[data-task-key]")).not.toBeNull(),
  );
  return Array.from(
    slot.container.querySelectorAll<HTMLElement>("[data-task-key]"),
  ).map((row) => row.dataset.taskKey);
}

function row(slot: ReturnType<typeof renderSlot>, key: string): HTMLElement {
  const result = slot.container.querySelector<HTMLElement>(
    `[data-task-key="${key}"]`,
  );
  if (result === null) throw new Error(`Missing task row ${key}`);
  return result;
}

function storePreference(
  scope: string,
  preference: {
    statuses?: Task["status"][];
    priorities?: Task["priority"][];
    sort: "manual" | "priority" | "due";
  },
) {
  window.localStorage.setItem(
    LIST_PREFERENCE_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      scopes: {
        [scope]: {
          filters: {
            statuses: preference.statuses ?? [],
            priorities: preference.priorities ?? [],
            labelNames: [],
          },
          sort: preference.sort,
        },
      },
    }),
  );
}

describe("task list hierarchy", () => {
  it("renders project children directly beneath their parent", async () => {
    const parent = task(PROJECT_A, 1);
    const child = task(PROJECT_A, 2, {
      status: "done",
      parentTaskId: parent.id,
    });
    const doneRoot = task(PROJECT_A, 3, { status: "done" });
    const { rpc, slot } = renderList(PROJECT_A, [parent, child, doneRoot]);

    expect(await renderedKeys(slot)).toEqual(["ALP-1", "ALP-2", "ALP-3"]);
    expect(row(slot, "ALP-1").dataset.taskDepth).toBe("0");
    expect(row(slot, "ALP-2").dataset.taskDepth).toBe("1");
    expect(
      row(slot, "ALP-2").querySelector('[data-icon="CornerDownRight"]'),
    ).not.toBeNull();
    expect(rpc.listTasksCalls.some((input) => "parentTaskId" in input)).toBe(
      false,
    );

    const todoSection = slot.container
      .querySelector('[data-status-group-header="todo"]')
      ?.closest("section");
    expect(
      Array.from(todoSection?.querySelectorAll("[data-task-key]") ?? []).map(
        (entry) => entry.getAttribute("data-task-key"),
      ),
    ).toEqual(["ALP-1", "ALP-2"]);
  });

  it("sorts roots and child siblings while keeping each child attached", async () => {
    storePreference(`project:${PROJECT_A}`, { sort: "priority" });
    const parent = task(PROJECT_A, 1);
    const lowChild = task(PROJECT_A, 2, {
      priority: "low",
      parentTaskId: parent.id,
    });
    const urgentChild = task(PROJECT_A, 3, {
      priority: "urgent",
      parentTaskId: parent.id,
    });
    const highRoot = task(PROJECT_A, 4, { priority: "high" });
    const { slot } = renderList(PROJECT_A, [
      parent,
      lowChild,
      urgentChild,
      highRoot,
    ]);

    expect(await renderedKeys(slot)).toEqual([
      "ALP-4",
      "ALP-1",
      "ALP-3",
      "ALP-2",
    ]);
    expect(row(slot, "ALP-3").dataset.taskDepth).toBe("1");
    expect(row(slot, "ALP-2").dataset.taskDepth).toBe("1");
  });

  it("keeps a filtered child visible as a root when its parent is absent", async () => {
    storePreference(`project:${PROJECT_A}`, {
      statuses: ["done"],
      sort: "manual",
    });
    const parent = task(PROJECT_A, 1, { status: "todo" });
    const child = task(PROJECT_A, 2, {
      status: "done",
      parentTaskId: parent.id,
    });
    const { slot } = renderList(PROJECT_A, [parent, child]);

    expect(await renderedKeys(slot)).toEqual(["ALP-2"]);
    expect(row(slot, "ALP-2").dataset.taskDepth).toBe("0");
    expect(
      row(slot, "ALP-2").querySelector('[data-icon="CornerDownRight"]'),
    ).toBeNull();
  });

  it("nests children for each project in the All Tasks overview", async () => {
    const parentA = task(PROJECT_A, 1);
    const childA = task(PROJECT_A, 2, { parentTaskId: parentA.id });
    const parentB = task(PROJECT_B, 1);
    const childB = task(PROJECT_B, 2, { parentTaskId: parentB.id });
    const { rpc, slot } = renderList("all", [parentA, childA, parentB, childB]);

    expect(await renderedKeys(slot)).toEqual([
      "ALP-1",
      "ALP-2",
      "BET-1",
      "BET-2",
    ]);
    expect(row(slot, "ALP-2").dataset.taskDepth).toBe("1");
    expect(row(slot, "BET-2").dataset.taskDepth).toBe("1");
    expect(rpc.listTasksCalls[0]?.projectId).toBeUndefined();
    expect(rpc.listTasksCalls.some((input) => "parentTaskId" in input)).toBe(
      false,
    );
  });
});
