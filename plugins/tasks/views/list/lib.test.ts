import { describe, expect, it } from "vitest";
import type { Label, Task } from "../../shared/contract.js";
import {
  activeWorkLabel,
  formatDueDate,
  groupTasksByStatus,
  labelFilterOptions,
  partitionLabels,
  selectedLabelIds,
  taskHierarchyGroups,
} from "./lib.js";

const ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAA";
const ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
const ULID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAC";
const ULID_D = "01ARZ3NDEKTSV4RRFFQ69G5FAD";
const ULID_E = "01ARZ3NDEKTSV4RRFFQ69G5FAE";

function task(overrides: Partial<Task> & Pick<Task, "id" | "status">): Task {
  return {
    projectId: ULID_A,
    number: 1,
    key: "TSK-1",
    title: "A task",
    description: "",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

describe("groupTasksByStatus", () => {
  it("orders groups canonically and hides empty ones", () => {
    const groups = groupTasksByStatus([
      task({ id: ULID_A, status: "done" }),
      task({ id: ULID_B, status: "todo" }),
      task({ id: ULID_C, status: "todo" }),
    ]);
    expect(groups.map((g) => g.status)).toEqual(["todo", "done"]);
    expect(groups[0]?.tasks.map((t) => t.id)).toEqual([ULID_B, ULID_C]);
  });

  it("returns nothing for no tasks", () => {
    expect(groupTasksByStatus([])).toEqual([]);
  });
});

describe("taskHierarchyGroups", () => {
  const hierarchyTasks = [
    task({
      id: ULID_A,
      number: 1,
      key: "TSK-1",
      status: "todo",
      priority: "none",
      dueDate: "2026-07-30",
    }),
    task({
      id: ULID_C,
      number: 3,
      key: "TSK-3",
      status: "done",
      priority: "low",
      parentTaskId: ULID_A,
    }),
    task({
      id: ULID_D,
      number: 4,
      key: "TSK-4",
      status: "in_progress",
      priority: "urgent",
      dueDate: "2026-07-20",
      parentTaskId: ULID_A,
    }),
    task({
      id: ULID_B,
      number: 2,
      key: "TSK-2",
      status: "done",
      priority: "urgent",
    }),
    task({
      id: ULID_E,
      number: 5,
      key: "TSK-5",
      status: "todo",
      priority: "none",
      parentTaskId: ULID_B,
    }),
  ];

  const keysFor = (sort: "manual" | "priority" | "due") =>
    taskHierarchyGroups(hierarchyTasks, sort).flatMap((group) => [
      group.root.key,
      ...group.children.map((child) => child.key),
    ]);

  it("sorts roots and direct children independently in every sort mode", () => {
    expect(keysFor("manual")).toEqual([
      "TSK-1",
      "TSK-3",
      "TSK-4",
      "TSK-2",
      "TSK-5",
    ]);
    expect(keysFor("priority")).toEqual([
      "TSK-2",
      "TSK-5",
      "TSK-1",
      "TSK-4",
      "TSK-3",
    ]);
    expect(keysFor("due")).toEqual([
      "TSK-1",
      "TSK-4",
      "TSK-3",
      "TSK-2",
      "TSK-5",
    ]);
  });

  it("promotes absent-parent and deleted-parent tasks to roots", () => {
    const missingParent = task({
      id: ULID_C,
      key: "TSK-3",
      status: "todo",
      parentTaskId: "missing-parent",
    });
    const deletedParent = task({
      id: ULID_D,
      key: "TSK-4",
      status: "todo",
      parentTaskId: null,
    });

    expect(
      taskHierarchyGroups([missingParent, deletedParent], "manual").map(
        (group) => ({ root: group.root.key, children: group.children }),
      ),
    ).toEqual([
      { root: "TSK-3", children: [] },
      { root: "TSK-4", children: [] },
    ]);
  });
});
describe("label filter options", () => {
  const label = (id: string, projectId: string, name: string): Label => ({
    id,
    projectId,
    name,
    color: "#5e6ad2",
  });

  it("merges same-named labels across projects and resolves ids", () => {
    const options = labelFilterOptions([
      label(ULID_A, ULID_A, "Bug"),
      label(ULID_B, ULID_B, "Bug"),
      label(ULID_C, ULID_A, "Feature"),
    ]);
    expect(options.map((o) => o.name)).toEqual(["Bug", "Feature"]);
    expect(selectedLabelIds(options, ["Bug"])).toEqual([ULID_A, ULID_B]);
    expect(selectedLabelIds(options, [])).toEqual([]);
  });
});

describe("formatDueDate", () => {
  it("omits the current year and shows other years", () => {
    const today = new Date("2026-07-15T12:00:00");
    expect(formatDueDate("2026-07-18", today)).toBe("Jul 18");
    expect(formatDueDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });
});

describe("activeWorkLabel", () => {
  it("distinguishes starting from working for a single agent", () => {
    expect(activeWorkLabel([{ liveStatus: "starting" }])).toBe(
      "Agent starting",
    );
    expect(activeWorkLabel([{ liveStatus: "working" }])).toBe("Agent working");
  });

  it("counts multiple live agents", () => {
    expect(
      activeWorkLabel([{ liveStatus: "working" }, { liveStatus: "starting" }]),
    ).toBe("2 agents working");
  });
});

describe("partitionLabels", () => {
  const label = (name: string): Label => ({
    id: name,
    projectId: ULID_A,
    name,
    color: "#5e6ad2",
  });

  it("keeps everything visible at or under the cap", () => {
    const labels = [label("a"), label("b")];
    expect(partitionLabels(labels, 2)).toEqual({
      visible: labels,
      hidden: [],
    });
    expect(partitionLabels([], 2)).toEqual({ visible: [], hidden: [] });
  });

  it("moves the tail into hidden above the cap", () => {
    const labels = [label("a"), label("b"), label("c")];
    expect(partitionLabels(labels, 1)).toEqual({
      visible: [labels[0]],
      hidden: [labels[1], labels[2]],
    });
  });
});
