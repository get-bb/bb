import { TASK_PRIORITIES, type TaskSummary as Task } from "./contract.js";
import type { TaskSort } from "./pagination.js";

const PRIORITY_RANK = new Map<Task["priority"], number>(
  TASK_PRIORITIES.map((priority, index) => [priority, index]),
);

function byPriority(a: Task, b: Task): number {
  return (
    (PRIORITY_RANK.get(a.priority) ?? TASK_PRIORITIES.length) -
    (PRIORITY_RANK.get(b.priority) ?? TASK_PRIORITIES.length)
  );
}

function byDueDate(a: Task, b: Task): number {
  if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

export function sortTasks<T extends Task>(
  tasks: readonly T[],
  sort: TaskSort,
): T[] {
  if (sort === "manual")
    return [...tasks].sort(
      (a, b) =>
        a.projectId.localeCompare(b.projectId) ||
        a.status.localeCompare(b.status) ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  const [primary, secondary] =
    sort === "priority" ? [byPriority, byDueDate] : [byDueDate, byPriority];
  return [...tasks].sort((a, b) => primary(a, b) || secondary(a, b));
}
