import { TASK_PRIORITIES, type Task } from "./contract.js";
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

/** Earliest due date first; tasks without a due date sort last. */
function byDueDate(a: Task, b: Task): number {
  if (a.dueDate === null) return b.dueDate === null ? 0 : 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

/**
 * Returns a new array ordered by the requested sort. "manual" keeps the
 * server's order (board position within status). "priority" orders urgent →
 * none, "due" orders soonest → latest with undated tasks last; each uses the
 * other field as the secondary key, and remaining ties keep the server's
 * order (Array.prototype.sort is stable).
 */
export function sortTasks(tasks: readonly Task[], sort: TaskSort): Task[] {
  if (sort === "manual") return [...tasks];
  const [primary, secondary] =
    sort === "priority" ? [byPriority, byDueDate] : [byDueDate, byPriority];
  return [...tasks].sort((a, b) => primary(a, b) || secondary(a, b));
}
