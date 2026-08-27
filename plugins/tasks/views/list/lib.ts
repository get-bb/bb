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

export interface TaskHierarchyGroup {
  root: Task;
  children: Task[];
}

/**
 * Builds the one-level task hierarchy used by the list. Roots and each child
 * group use the selected sort independently, which keeps every child directly
 * below its parent. A task becomes a root when its parent is absent from the
 * filtered result. Invalid deeper data is also promoted instead of hidden.
 */
export function taskHierarchyGroups(
  tasks: readonly Task[],
  sort: TaskSort,
): TaskHierarchyGroup[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const roots: Task[] = [];
  const childrenByParent = new Map<string, Task[]>();

  for (const task of tasks) {
    const parent =
      task.parentTaskId === null ? undefined : byId.get(task.parentTaskId);
    if (parent === undefined || parent.parentTaskId !== null) {
      roots.push(task);
      continue;
    }
    const children = childrenByParent.get(parent.id);
    if (children) children.push(task);
    else childrenByParent.set(parent.id, [task]);
  }

  return sortTasks(roots, sort).map((root) => ({
    root,
    children: sortTasks(childrenByParent.get(root.id) ?? [], sort),
  }));
}
interface StatusGroup {
  status: TaskStatus;
  tasks: Task[];
}

/**
 * Buckets tasks into canonical status order, dropping empty groups. Within a
 * group the incoming order is preserved, so callers control ordering by
 * pre-sorting (the server default is board position).
 */
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
  /** All label ids sharing this name (one per project on cross-project routes). */
  labelIds: string[];
}

/**
 * Collapses labels into name-keyed filter options so "Bug" on the All-tasks
 * route matches every project's Bug label with a single selection.
 */
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

/** "2026-07-18" → "Jul 18" (with the year appended when it isn't this year). */
export function formatDueDate(dueDate: string, today = new Date()): string {
  const date = new Date(`${dueDate}T00:00:00`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}

/**
 * Accessible name for the list-row activity dot. Callers only render the dot
 * when at least one thread is live, so the input is never empty.
 */
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
}

/**
 * Splits row labels into visible chips and a "+N" overflow so rows stay a
 * bounded width no matter how many labels a task carries.
 */
export function partitionLabels(
  labels: readonly Label[],
  maxVisible: number,
): LabelOverflow {
  if (labels.length <= maxVisible) {
    return { visible: [...labels], hidden: [] };
  }
  return {
    visible: labels.slice(0, maxVisible),
    hidden: labels.slice(maxVisible),
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
