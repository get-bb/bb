import {
  TASK_STATUSES,
  type Label,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";
import type { TaskSort } from "../../shared/pagination.js";
import { sortTasks } from "../../shared/sort.js";

export const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export const SORT_LABELS: Record<TaskSort, string> = {
  manual: "Manual",
  priority: "Priority",
  due: "Due date",
};

interface StatusGroup {
  status: TaskStatus;
  tasks: Task[];
}

export function groupTasksByStatus(tasks: readonly Task[]): StatusGroup[] {
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const task of tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
    else byStatus.set(task.status, [task]);
  }
  return TASK_STATUSES.flatMap((status) => {
    const bucket = byStatus.get(status);
    return bucket ? [{ status, tasks: bucket }] : [];
  });
}

export interface LabelFilterOption {
  name: string;
  color: string;
  labelIds: string[];
}

export function labelFilterOptions(
  labels: readonly Label[],
): LabelFilterOption[] {
  const byName = new Map<string, LabelFilterOption>();
  for (const label of labels) {
    const existing = byName.get(label.name);
    if (existing) existing.labelIds.push(label.id);
    else
      byName.set(label.name, {
        name: label.name,
        color: label.color,
        labelIds: [label.id],
      });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function selectedLabelIds(
  options: readonly LabelFilterOption[],
  selectedNames: readonly string[],
): string[] {
  const selected = new Set(selectedNames);
  return options
    .filter((option) => selected.has(option.name))
    .flatMap((option) => option.labelIds);
}

export function formatDueDate(dueDate: string, today = new Date()): string {
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function activeWorkLabel(
  threads: readonly { liveStatus: string }[],
): string {
  if (threads.length === 1) {
    return threads[0]?.liveStatus === "starting"
      ? "Agent starting"
      : "Agent working";
  }
  return `${threads.length} agents working`;
}

interface LabelOverflow {
  visible: Label[];
  hidden: Label[];
  hiddenTitle: string;
}

export function partitionLabels(
  labels: readonly Label[],
  maxVisible: number,
): LabelOverflow {
  if (labels.length <= maxVisible) {
    return { visible: [...labels], hidden: [], hiddenTitle: "" };
  }
  const hidden = labels.slice(maxVisible);
  return {
    visible: labels.slice(0, maxVisible),
    hidden,
    hiddenTitle: hidden.map((label) => label.name).join(", "),
  };
}

export function localIsoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export const DUE_DATE_PRESETS: readonly [label: string, days: number][] = [
  ["Today", 0],
  ["Tomorrow", 1],
  ["Next week", 7],
];

function matchesFilters(
  task: Task,
  statuses: readonly TaskStatus[],
  priorities: readonly TaskPriority[],
  labelIds: readonly string[] | null,
): boolean {
  return (
    (statuses.length === 0 || statuses.includes(task.status)) &&
    (priorities.length === 0 || priorities.includes(task.priority)) &&
    (labelIds === null ||
      (labelIds.length > 0 &&
        task.labelIds.some((id) => labelIds.includes(id))))
  );
}

function matchesSearch(task: Task, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") return true;
  return (
    task.key.toLowerCase().includes(needle) ||
    task.title.toLowerCase().includes(needle)
  );
}

export interface TaskMatchCriteria {
  statuses: readonly TaskStatus[];
  priorities: readonly TaskPriority[];
  labelIds: readonly string[] | null;
  search: string;
  activeIds: ReadonlySet<string> | null;
}

export function parentIsOpen(
  parentId: string,
  collapsed: readonly string[],
  criteria: TaskMatchCriteria,
  visibleChildren: ReadonlyMap<string, readonly Task[]>,
): boolean {
  const filtering =
    criteria.search.trim() !== "" ||
    criteria.statuses.length > 0 ||
    criteria.priorities.length > 0 ||
    criteria.labelIds !== null ||
    criteria.activeIds !== null;
  return (
    !collapsed.includes(parentId) ||
    (filtering && (visibleChildren.get(parentId)?.length ?? 0) > 0)
  );
}

export function taskMatches(task: Task, criteria: TaskMatchCriteria): boolean {
  return (
    (criteria.activeIds === null || criteria.activeIds.has(task.id)) &&
    matchesFilters(
      task,
      criteria.statuses,
      criteria.priorities,
      criteria.labelIds,
    ) &&
    matchesSearch(task, criteria.search)
  );
}

export function childrenByParent(
  tasks: readonly Task[],
): ReadonlyMap<string, Task[]> {
  const result = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const children = result.get(task.parentTaskId) ?? [];
    children.push(task);
    result.set(task.parentTaskId, children);
  }
  return result;
}

export function visibleChildrenByParent(
  childrenByParent: ReadonlyMap<string, readonly Task[]>,
  criteria: TaskMatchCriteria,
  sort: TaskSort,
): ReadonlyMap<string, Task[]> {
  const result = new Map<string, Task[]>();
  for (const [parentId, children] of childrenByParent) {
    result.set(
      parentId,
      sortTasks(
        children.filter((child) => taskMatches(child, criteria)),
        sort,
      ),
    );
  }
  return result;
}

export function activeTopRows(
  activeTasks: readonly Task[],
  allTasks: readonly Task[],
): Task[] {
  const activeTopIds = new Set(
    activeTasks
      .filter((task) => task.parentTaskId === null)
      .map((task) => task.id),
  );
  return [
    ...activeTasks.filter((task) => task.parentTaskId === null),
    ...allTasks.filter(
      (task) => task.parentTaskId === null && !activeTopIds.has(task.id),
    ),
  ];
}

export function displayRows(
  rows: readonly Task[],
  criteria: TaskMatchCriteria,
  childrenByParent: ReadonlyMap<string, readonly Task[]>,
): Task[] {
  return rows.filter(
    (task) =>
      taskMatches(task, criteria) ||
      (childrenByParent.get(task.id) ?? []).some((child) =>
        taskMatches(child, criteria),
      ),
  );
}

export function subTaskTotals(children: readonly Task[]): {
  done: number;
  total: number;
} {
  let done = 0;
  let total = 0;
  for (const child of children) {
    if (child.status === "canceled") continue;
    total += 1;
    if (child.status === "done") done += 1;
  }
  return { done, total };
}

export function childrenForList(
  all: ReadonlyMap<string, readonly Task[]>,
  criteria: TaskMatchCriteria,
  sort: TaskSort,
) {
  const visible = visibleChildrenByParent(all, criteria, sort);
  const totals = new Map<string, { done: number; total: number }>();
  for (const [parentId, children] of all) {
    totals.set(parentId, subTaskTotals(children));
  }
  return { visible, totals };
}

export function listCounts(
  rows: readonly Task[],
  criteria: TaskMatchCriteria,
  visibleChildrenByParent: ReadonlyMap<string, readonly Task[]>,
  activeOnly: boolean,
): { tasks: number; subTasks: number } {
  let subTasks = 0;
  for (const task of rows) {
    subTasks += visibleChildrenByParent.get(task.id)?.length ?? 0;
  }
  const matchingTasks = rows.filter((task) =>
    taskMatches(task, criteria),
  ).length;
  const tasks = activeOnly ? matchingTasks + subTasks : matchingTasks;
  return { tasks, subTasks };
}

export function formatElapsed(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(clamped / 3600);
  const days = Math.floor(hours / 24);
  const minutes = Math.floor((clamped % 3600) / 60);
  return [
    ...(days > 0 ? [`${days}d`] : []),
    ...(hours > 0 ? [`${hours % 24}h`] : []),
    ...(minutes > 0 || hours > 0 ? [`${minutes}m`] : []),
    `${clamped % 60}s`,
  ].join(" ");
}
