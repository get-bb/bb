import type {
  TaskSummary as Task,
  TaskPriority,
  TaskStatus,
} from "./contract.js";

export interface TaskEdit {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  labelIds?: string[];
  position?: number;
  title?: string;
}

export function applyEdit<Value extends Task>(
  task: Value,
  edit: TaskEdit | undefined,
): Value {
  if (edit === undefined || Object.keys(edit).length === 0) return task;
  return {
    ...task,
    ...(edit.status !== undefined ? { status: edit.status } : {}),
    ...(edit.priority !== undefined ? { priority: edit.priority } : {}),
    ...(edit.dueDate !== undefined ? { dueDate: edit.dueDate } : {}),
    ...(edit.labelIds !== undefined ? { labelIds: edit.labelIds } : {}),
    ...(edit.position !== undefined ? { position: edit.position } : {}),
    ...(edit.title !== undefined ? { title: edit.title } : {}),
  };
}

export function matchesFilters(
  task: Task,
  statuses: readonly TaskStatus[],
  priorities: readonly TaskPriority[],
  labelIds: readonly string[],
): boolean {
  return (
    (statuses.length === 0 || statuses.includes(task.status)) &&
    (priorities.length === 0 || priorities.includes(task.priority)) &&
    (labelIds.length === 0 || task.labelIds.some((id) => labelIds.includes(id)))
  );
}
