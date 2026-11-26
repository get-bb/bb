import { describe, expect, it } from "vitest";
import type { Label, Task, TaskThread } from "../../shared/contract.js";
import type { TaskSort } from "../../shared/pagination.js";
import { isActiveThread } from "../detail/meta.js";
import {
  activeWorkLabel,
  childrenByParent,
  childrenForList,
  displayRows,
  formatDueDate,
  groupTasksByStatus,
  labelFilterOptions,
  parentIsOpen,
  partitionLabels,
  selectedLabelIds,
  taskMatches,
  listTaskCount,
  visibleChildrenByParent,
  type TaskMatchCriteria,
} from "./lib.js";
import { makeTask } from "../../test-fixtures.js";

const ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAA";
const ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
const ULID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAC";

const thread: TaskThread = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZH1",
  taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  threadId: "thr_worker",
  presetName: "Sonnet · high",
  title: "Worker",
  liveStatus: "working",
  attachedAt: "2026-07-15T00:00:00.000Z",
  updatedAt: "2026-07-15T00:00:00.000Z",
};

function task(overrides: Partial<Task> & Pick<Task, "id" | "status">): Task {
  return makeTask({
    projectId: ULID_A,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  });
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
      hiddenTitle: "",
    });
    expect(partitionLabels([], 2)).toEqual({
      visible: [],
      hidden: [],
      hiddenTitle: "",
    });
  });

  it("titles the overflow with every hidden label name", () => {
    const labels = [label("bug"), label("frontend"), label("needs-design")];
    expect(partitionLabels(labels, 1)).toEqual({
      visible: [labels[0]],
      hidden: [labels[1], labels[2]],
      hiddenTitle: "frontend, needs-design",
    });
  });
});

describe("isActiveThread", () => {
  it.each<[TaskThread["liveStatus"], boolean]>([
    ["starting", true],
    ["working", true],
    ["idle", false],
    ["completed", false],
    ["failed", false],
  ])("liveStatus %s is active: %s", (liveStatus, expected) => {
    expect(isActiveThread({ ...thread, liveStatus })).toBe(expected);
  });
});

describe("activeWorkLabel", () => {
  it.each<[string, TaskThread["liveStatus"][], string]>([
    ["one working agent", ["working"], "Agent working"],
    ["one starting agent", ["starting"], "Agent starting"],
    ["several agents", ["working", "starting"], "2 agents working"],
  ])("labels %s", (_name, statuses, expected) => {
    expect(
      activeWorkLabel(statuses.map((liveStatus) => ({ liveStatus }))),
    ).toBe(expected);
  });
});

function criteria(
  overrides: Partial<TaskMatchCriteria> = {},
): TaskMatchCriteria {
  return {
    statuses: [],
    priorities: [],
    labelIds: null,
    search: "",
    activeIds: null,
    ...overrides,
  };
}

const DEMO_PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

function demoTask(number: number, overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: `01HZD${String(number).padStart(20, "0")}`,
    projectId: DEMO_PROJECT_ID,
    number,
    key: `DEMO-${number}`,
    title: `Demo task ${number}`,
    position: number,
    ...overrides,
  });
}

const demoParent = demoTask(1, { title: "Wire up the settings page" });
const demoOther = demoTask(2, {
  status: "in_progress",
  title: "Ship the changelog",
});
const demoChildLayout = demoTask(3, {
  parentTaskId: demoParent.id,
  priority: "low",
  title: "Draft the layout",
});
const demoChildCanceled = demoTask(4, {
  parentTaskId: demoParent.id,
  status: "canceled",
  title: "Ask legal",
});
const demoChildPalette = demoTask(5, {
  parentTaskId: demoParent.id,
  status: "done",
  priority: "high",
  title: "Redesign the palette picker",
});
const demoTasks = [
  demoParent,
  demoOther,
  demoChildLayout,
  demoChildCanceled,
  demoChildPalette,
];

describe("taskMatches", () => {
  it.each<[string, Partial<TaskMatchCriteria>, Partial<Task>, boolean]>([
    ["passes an unfiltered task", {}, {}, true],
    [
      "finds a task by key search",
      { search: "demo-9" },
      { title: "Unrelated" },
      true,
    ],
    [
      "finds a task by title search case-insensitively",
      { search: "PALETTE" },
      { key: "DEMO-9", title: "Redesign the palette picker" },
      true,
    ],
    [
      "rejects a task that matches neither key nor title",
      { search: "palette" },
      { key: "DEMO-9", title: "Unrelated" },
      false,
    ],
    [
      "keeps a task with the filtered status",
      { statuses: ["done"] },
      { status: "done" },
      true,
    ],
    [
      "drops a task with another status",
      { statuses: ["done"] },
      { status: "todo" },
      false,
    ],
    [
      "keeps a task with the filtered priority",
      { priorities: ["high"] },
      { priority: "high" },
      true,
    ],
    [
      "keeps a task carrying a selected label",
      { labelIds: ["lbl-1"] },
      { labelIds: ["lbl-1", "lbl-2"] },
      true,
    ],
    [
      "drops a task without the selected label",
      { labelIds: ["lbl-1"] },
      { labelIds: ["lbl-2"] },
      false,
    ],
    [
      "drops every task when selected labels resolve to none",
      { labelIds: [] },
      { labelIds: ["lbl-1"] },
      false,
    ],
  ])("%s", (_name, criteriaOverrides, taskOverrides, expected) => {
    expect(
      taskMatches(demoTask(9, taskOverrides), criteria(criteriaOverrides)),
    ).toBe(expected);
  });

  it.each<[string, ReadonlySet<string>, boolean]>([
    ["keeps a task inside the active set", new Set(["active"]), true],
    ["drops a task outside the active set", new Set(["other"]), false],
  ])("%s", (_name, activeIds, expected) => {
    expect(
      taskMatches(demoTask(9, { id: "active" }), criteria({ activeIds })),
    ).toBe(expected);
  });
});

describe("visible task tree", () => {
  const all = childrenByParent(demoTasks);
  const topRows = [demoParent, demoOther];

  it.each([
    ["search", criteria({ search: "palette" }), true],
    ["status filter", criteria({ statuses: ["done"] }), true],
    [
      "active filter",
      criteria({ activeIds: new Set([demoChildPalette.id]) }),
      true,
    ],
    ["no filter", criteria(), false],
  ] as const)(
    "opens a collapsed parent only for matching sub-tasks with %s",
    (_name, match, expected) => {
      const visible = visibleChildrenByParent(all, match, "manual");
      const open = parentIsOpen(demoParent.id, [], match, visible);
      expect(open).toBe(expected);
      expect(
        open ? visible.get(demoParent.id)?.map((child) => child.id) : [],
      ).toEqual(expected ? [demoChildPalette.id] : []);
    },
  );

  it("keeps a parent the user expanded open without a filter", () => {
    const visible = visibleChildrenByParent(all, criteria(), "manual");
    expect(
      parentIsOpen(demoParent.id, [demoParent.id], criteria(), visible),
    ).toBe(true);
  });

  it.each<{
    name: string;
    criteria: TaskMatchCriteria;
    sort: TaskSort;
    rows: string[];
    childrenOfParent: string[];
    muted: string[];
  }>([
    {
      name: "keeps the tree unchanged with no filter or search",
      criteria: criteria(),
      sort: "manual",
      rows: [demoParent.id, demoOther.id],
      childrenOfParent: [
        demoChildLayout.id,
        demoChildCanceled.id,
        demoChildPalette.id,
      ],
      muted: [],
    },
    {
      name: "finds a matching sub-task by search under its muted parent",
      criteria: criteria({ search: "palette" }),
      sort: "manual",
      rows: [demoParent.id],
      childrenOfParent: [demoChildPalette.id],
      muted: [demoParent.id],
    },
    {
      name: "shows a done sub-task under its muted parent when filtering by status",
      criteria: criteria({ statuses: ["done"] }),
      sort: "manual",
      rows: [demoParent.id],
      childrenOfParent: [demoChildPalette.id],
      muted: [demoParent.id],
    },
    {
      name: "hides sub-tasks that do not match the priority filter",
      criteria: criteria({ priorities: ["high"] }),
      sort: "manual",
      rows: [demoParent.id],
      childrenOfParent: [demoChildPalette.id],
      muted: [demoParent.id],
    },
    {
      name: "applies the chosen sort to sub-tasks within their parent",
      criteria: criteria(),
      sort: "priority",
      rows: [demoParent.id, demoOther.id],
      childrenOfParent: [
        demoChildPalette.id,
        demoChildLayout.id,
        demoChildCanceled.id,
      ],
      muted: [],
    },
  ])("$name", ({ criteria, sort, rows, childrenOfParent, muted }) => {
    const display = displayRows(
      topRows,
      criteria,
      visibleChildrenByParent(all, criteria, sort),
    );
    expect(display.map((task) => task.id)).toEqual(rows);
    expect(display.map((task) => taskMatches(task, criteria))).toEqual(
      rows.map((id) => !muted.includes(id)),
    );
    expect(
      visibleChildrenByParent(all, criteria, sort)
        .get(demoParent.id)
        ?.map((task) => task.id),
    ).toEqual(childrenOfParent);
  });
});

describe("listTaskCount", () => {
  it.each<[string, TaskMatchCriteria, number]>([
    ["counts only top-level tasks without a search or filter", criteria(), 2],
    [
      "counts matching parents and sub-tasks under a filter",
      criteria({ statuses: ["todo", "done"] }),
      3,
    ],
    [
      "counts only matches while searching, not the muted parent",
      criteria({ search: "palette" }),
      1,
    ],
  ])("%s", (_name, criteria, expected) => {
    const visible = visibleChildrenByParent(
      childrenByParent(demoTasks),
      criteria,
      "manual",
    );
    const display = displayRows([demoParent, demoOther], criteria, visible);
    expect(listTaskCount(display, criteria, visible)).toBe(expected);
  });
});

describe("sub-task progress", () => {
  it("counts every sub-task, including canceled, like the board and detail page", () => {
    const { totals } = childrenForList(
      childrenByParent(demoTasks.slice(2)),
      criteria({ search: "palette" }),
      "manual",
    );
    expect(totals.get(demoParent.id)).toEqual({ done: 1, total: 3 });
  });
});

describe("active view rows", () => {
  it("shows an active sub-task under its muted parent and counts matching rows", () => {
    const parent = demoTask(16, { key: "TSK-16", title: "Idle parent" });
    const child = demoTask(17, {
      key: "TSK-17",
      title: "Active child",
      parentTaskId: parent.id,
      status: "in_progress",
    });
    const solo = demoTask(18, {
      id: "01HZT3ZZZZZZZZZZZZZZZZZZT3",
      key: "TSK-18",
      title: "Solo active",
      status: "in_progress",
    });
    const idle = demoTask(19, { key: "TSK-19", title: "Idle" });
    const active = criteria({ activeIds: new Set([child.id, solo.id]) });
    const visible = visibleChildrenByParent(
      childrenByParent([parent, child, solo, idle]),
      active,
      "manual",
    );
    const rows = displayRows([parent, solo, idle], active, visible);
    expect(rows.map((task) => task.id)).toEqual([parent.id, solo.id]);
    expect(rows.map((task) => taskMatches(task, active))).toEqual([
      false,
      true,
    ]);
    expect(listTaskCount(rows, active, visible)).toBe(2);
  });
});
