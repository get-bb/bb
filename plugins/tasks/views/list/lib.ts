import {
  TASK_STATUSES,
  type Label,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from "../../shared/contract.js";
import type { TaskSort } from "../../shared/sort.js";

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

export interface StatusGroup {
  status: TaskStatus;
  tasks: Task[];
}

export interface HierarchicalTask {
  task: Task;
  depth: 0 | 1;
}

export interface HierarchicalStatusGroup {
  status: TaskStatus;
  entries: HierarchicalTask[];
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

/**
 * Builds the list presentation from an already-sorted task set. Roots keep
 * their incoming order, while matching children move directly beneath their
 * parent and keep their incoming sibling order. A child whose parent is not
 * in the filtered result remains a root, so filtering never hides a match.
 *
 * Children inherit their parent's presentation group even when their own
 * status differs; the row still renders the child's status editor. This keeps
 * the parent/child relationship intact while preserving canonical root status
 * groups and the caller's selected sort.
 */
export function groupTaskHierarchyByStatus(
  tasks: readonly Task[],
): HierarchicalStatusGroup[] {
  const taskIds = new Set(tasks.map((task) => task.id));
  const childrenByParentId = new Map<string, Task[]>();
  const roots: Task[] = [];

  for (const task of tasks) {
    if (task.parentTaskId !== null && taskIds.has(task.parentTaskId)) {
      const children = childrenByParentId.get(task.parentTaskId);
      if (children) children.push(task);
      else childrenByParentId.set(task.parentTaskId, [task]);
    } else {
      roots.push(task);
    }
  }

  const byStatus = new Map<TaskStatus, HierarchicalTask[]>();
  for (const root of roots) {
    const entries = byStatus.get(root.status) ?? [];
    entries.push({ task: root, depth: 0 });
    for (const child of childrenByParentId.get(root.id) ?? []) {
      entries.push({ task: child, depth: 1 });
    }
    byStatus.set(root.status, entries);
  }

  return TASK_STATUSES.flatMap((status) => {
    const entries = byStatus.get(status);
    return entries ? [{ status, entries }] : [];
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
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
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

export interface LabelOverflow {
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
