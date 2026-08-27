// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
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
  window.sessionStorage.clear();
});

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const LABEL_ID = "01HZZZZZZZZZZZZZZZZZZZZLB1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 100,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

const bugLabel = {
  id: LABEL_ID,
  projectId: PROJECT_ID,
  name: "Bug",
  color: "#e5484d",
};

function task(number: number, overrides: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

type TaskSource = () => readonly Task[];

function renderTasks(source: TaskSource) {
  const listTasksCalls: Record<string, unknown>[] = [];
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [bugLabel] }),
        listTasks: (input: {
          projectId?: string;
          parentTaskId?: string | null;
          statuses?: readonly Task["status"][];
          priorities?: readonly Task["priority"][];
          labelIds?: readonly string[];
        }) => {
          listTasksCalls.push(input);
          let tasks = [...source()];
          if (input.projectId !== undefined) {
            tasks = tasks.filter((item) => item.projectId === input.projectId);
          }
          if (input.parentTaskId !== undefined) {
            tasks = tasks.filter(
              (item) => item.parentTaskId === input.parentTaskId,
            );
          }
          if (input.statuses !== undefined && input.statuses.length > 0) {
            const statuses = new Set(input.statuses);
            tasks = tasks.filter((item) => statuses.has(item.status));
          }
          if (input.priorities !== undefined && input.priorities.length > 0) {
            const priorities = new Set(input.priorities);
            tasks = tasks.filter((item) => priorities.has(item.priority));
          }
          if (input.labelIds !== undefined) {
            const labelIds = new Set(input.labelIds);
            tasks = tasks.filter((item) =>
              item.labelIds.some((labelId) => labelIds.has(labelId)),
            );
          }
          return { tasks };
        },
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      },
    },
  );
  return { slot, listTasksCalls };
}

function taskKeys(slot: ReturnType<typeof renderSlot>): string[] {
  return Array.from(
    slot.container.querySelectorAll<HTMLElement>("[data-task-key]"),
    (row) => row.dataset.taskKey ?? "",
  );
}

async function expectTaskKeys(
  slot: ReturnType<typeof renderSlot>,
  expected: readonly string[],
) {
  await waitFor(() => expect(taskKeys(slot)).toEqual(expected));
}

function taskLevel(
  slot: ReturnType<typeof renderSlot>,
  key: string,
): string | undefined {
  return slot.container.querySelector<HTMLElement>(`[data-task-key="${key}"]`)
    ?.dataset.taskLevel;
}

async function selectFilter(
  slot: ReturnType<typeof renderSlot>,
  filter: "Status" | "Priority" | "Label",
  option: string,
) {
  fireEvent.click(slot.getByRole("button", { name: filter, exact: true }));
  fireEvent.click(await slot.findByRole("menuitemcheckbox", { name: option }));
}

describe("task list hierarchy", () => {
  it("renders direct children below their parent and supports collapse", async () => {
    const parent = task(1);
    const childA = task(2, {
      parentTaskId: parent.id,
      status: "done",
    });
    const otherRoot = task(3, { status: "done" });
    const childB = task(4, {
      parentTaskId: parent.id,
      status: "in_progress",
    });
    const { slot, listTasksCalls } = renderTasks(() => [
      parent,
      childA,
      otherRoot,
      childB,
    ]);

    await expectTaskKeys(slot, ["TSK-1", "TSK-2", "TSK-4", "TSK-3"]);
    expect(taskLevel(slot, "TSK-1")).toBe("0");
    expect(taskLevel(slot, "TSK-2")).toBe("1");
    expect(taskLevel(slot, "TSK-4")).toBe("1");
    expect(listTasksCalls.some((input) => "parentTaskId" in input)).toBe(false);
    expect(
      slot.getByRole("button", { name: "Open TSK-2: Task 2" }),
    ).toBeDefined();

    const collapse = slot.getByRole("button", {
      name: "Collapse 2 subtasks for TSK-1",
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    await expectTaskKeys(slot, ["TSK-1", "TSK-3"]);

    const expand = slot.getByRole("button", {
      name: "Expand 2 subtasks for TSK-1",
    });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    await expectTaskKeys(slot, ["TSK-1", "TSK-2", "TSK-4", "TSK-3"]);
  });

  it.each([
    {
      name: "status",
      filter: "Status" as const,
      option: "Done",
      child: { status: "done" as const },
    },
    {
      name: "priority",
      filter: "Priority" as const,
      option: "Urgent",
      child: { priority: "urgent" as const },
    },
    {
      name: "label",
      filter: "Label" as const,
      option: "Bug",
      child: { labelIds: [LABEL_ID] },
    },
  ])(
    "promotes a matching child when the $name filter hides its parent",
    async ({ filter, option, child: childOverrides }) => {
      const parent = task(1);
      const child = task(2, {
        parentTaskId: parent.id,
        ...childOverrides,
      });
      const { slot } = renderTasks(() => [parent, child]);
      await expectTaskKeys(slot, ["TSK-1", "TSK-2"]);

      await selectFilter(slot, filter, option);

      await expectTaskKeys(slot, ["TSK-2"]);
      expect(taskLevel(slot, "TSK-2")).toBe("0");
    },
  );

  it("keeps a child visible when its parent row is absent", async () => {
    const child = task(2, { parentTaskId: "absent-parent" });
    const { slot } = renderTasks(() => [child]);

    await expectTaskKeys(slot, ["TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("0");
  });

  it("promotes a child after its parent is deleted", async () => {
    const parent = task(1);
    const child = task(2, { parentTaskId: parent.id });
    let tasks: Task[] = [parent, child];
    const { slot } = renderTasks(() => tasks);
    await expectTaskKeys(slot, ["TSK-1", "TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("1");

    tasks = [{ ...child, parentTaskId: null }];
    await slot.emitRealtime("tasks:changed", {});

    await expectTaskKeys(slot, ["TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("0");
  });
});
