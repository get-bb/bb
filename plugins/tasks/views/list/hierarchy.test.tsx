// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
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
): string | null {
  return (
    slot.container
      .querySelector<HTMLElement>(`[data-task-key="${key}"]`)
      ?.closest('[role="listitem"]')
      ?.getAttribute("aria-level") ?? null
  );
}

function expectClasses(element: Element, expected: readonly string[]) {
  expect([...element.classList]).toEqual(expect.arrayContaining(expected));
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
    expect(taskLevel(slot, "TSK-1")).toBe("1");
    expect(taskLevel(slot, "TSK-2")).toBe("2");
    expect(taskLevel(slot, "TSK-4")).toBe("2");
    expect(listTasksCalls.some((input) => "parentTaskId" in input)).toBe(false);
    expect(
      slot.getByRole("button", { name: "Open TSK-2: Task 2" }),
    ).toBeDefined();
    expect(
      slot.container.querySelector('[data-status-group-header="todo"]')
        ?.lastElementChild?.textContent,
    ).toBe("1 main task · 3 visible tasks");
    expect(
      slot.container.querySelector('[data-status-group-header="done"]')
        ?.lastElementChild?.textContent,
    ).toBe("1 main task · 1 visible task");
    expect(
      slot.container.querySelector('[data-status-group-header="in_progress"]'),
    ).toBeNull();
    expect(
      within(
        slot.container.querySelector('[data-task-key="TSK-4"]')!,
      ).getByRole("button", {
        name: "Change status, currently In Progress",
      }),
    ).toBeDefined();

    const collapse = slot.getByRole("button", {
      name: "Collapse 2 subtasks for TSK-1",
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(collapse);
    await expectTaskKeys(slot, ["TSK-1", "TSK-3"]);
    expect(
      slot.container.querySelector('[data-status-group-header="todo"]')
        ?.lastElementChild?.textContent,
    ).toBe("1 main task · 1 visible task");

    const expand = slot.getByRole("button", {
      name: "Expand 2 subtasks for TSK-1",
    });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expand);
    await expectTaskKeys(slot, ["TSK-1", "TSK-2", "TSK-4", "TSK-3"]);
  });

  it("exposes nested list semantics and parent context", async () => {
    const parent = task(1);
    const child = task(2, {
      parentTaskId: parent.id,
      status: "done",
    });
    const { slot } = renderTasks(() => [parent, child]);

    await expectTaskKeys(slot, ["TSK-1", "TSK-2"]);
    const statusList = slot.getByRole("list", { name: /Todo/ });
    const parentItem = within(statusList).getByRole("listitem", {
      name: "TSK-1: Task 1. Status Todo.",
    });
    expect(parentItem.getAttribute("aria-level")).toBe("1");

    const subtaskList = within(parentItem).getByRole("list", {
      name: "Subtasks for TSK-1",
    });
    const childItem = within(subtaskList).getByRole("listitem", {
      name: "TSK-2: Task 2. Subtask of TSK-1. Status Done.",
    });
    expect(childItem.getAttribute("aria-level")).toBe("2");
    expect(
      within(parentItem)
        .getByRole("button", { name: "Collapse 1 subtask for TSK-1" })
        .getAttribute("aria-controls"),
    ).toBe(subtaskList.id);
  });

  it("keeps visible indentation, connector styling, and narrow placement", async () => {
    const parent = task(1);
    const child = task(2, { parentTaskId: parent.id });
    const { slot } = renderTasks(() => [parent, child]);

    await expectTaskKeys(slot, ["TSK-1", "TSK-2"]);
    const row = slot.container.querySelector<HTMLElement>(
      '[data-task-key="TSK-2"]',
    )!;
    expectClasses(row, [
      "pl-7",
      "pr-3.5",
      "grid-cols-[auto_auto_auto_minmax(0,1fr)]",
    ]);

    const connector = row.querySelector<HTMLElement>(
      "[data-subtask-connector]",
    )!;
    expectClasses(connector, ["col-start-1", "row-span-2", "row-start-1"]);
    expectClasses(connector.firstElementChild!, [
      "rounded-bl-sm",
      "border-b",
      "border-l",
      "border-border",
    ]);
    expectClasses(
      within(row).getByRole("button", {
        name: "Change status, currently Todo",
      }),
      ["col-start-2", "row-start-1"],
    );
    expectClasses(
      within(row).getByRole("button", {
        name: "Set priority, currently No priority",
      }),
      ["col-start-2", "row-start-2"],
    );
    expectClasses(within(row).getByText("TSK-2"), [
      "col-start-3",
      "row-start-2",
    ]);
    expectClasses(within(row).getByText("Task 2"), [
      "col-start-3",
      "col-span-2",
      "row-start-1",
    ]);
    expectClasses(row.lastElementChild!, ["col-start-4", "row-start-2"]);
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
      expect(taskLevel(slot, "TSK-2")).toBe("1");
    },
  );

  it("keeps a child visible when its parent row is absent", async () => {
    const child = task(2, { parentTaskId: "absent-parent" });
    const { slot } = renderTasks(() => [child]);

    await expectTaskKeys(slot, ["TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("1");
  });

  it("promotes a child after its parent is deleted", async () => {
    const parent = task(1);
    const child = task(2, { parentTaskId: parent.id });
    let tasks: Task[] = [parent, child];
    const { slot } = renderTasks(() => tasks);
    await expectTaskKeys(slot, ["TSK-1", "TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("2");

    tasks = [{ ...child, parentTaskId: null }];
    await slot.emitRealtime("tasks:changed", {});

    await expectTaskKeys(slot, ["TSK-2"]);
    expect(taskLevel(slot, "TSK-2")).toBe("1");
  });
});
