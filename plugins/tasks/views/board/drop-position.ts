import { TASK_STATUSES, type TaskStatus } from "../../shared/contract.js";

/** Always-visible columns in board order; Canceled is appended on demand. */
export const BOARD_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
] as const satisfies readonly TaskStatus[];

/**
 * The board's column set: the five canonical columns, plus Canceled appended
 * at the end whenever it holds cards (canceled top-level tasks would
 * otherwise be unreachable from the board).
 */
export function visibleBoardStatuses(
  columns: Readonly<Record<TaskStatus, readonly unknown[]>>,
): TaskStatus[] {
  return [
    ...BOARD_STATUSES,
    ...(columns.canceled.length > 0 ? (["canceled"] as const) : []),
  ];
}

/**
 * Reorder neighbors for a board drop, matching the `boardMove` RPC contract:
 * `beforeTaskId` is the card that sorts BEFORE (above) the dropped card and
 * `afterTaskId` the card that sorts AFTER (below) it.
 */
interface BoardDropNeighbors {
  beforeTaskId: string | null;
  afterTaskId: string | null;
}

/**
 * Maps a drop index to the before/after neighbor ids the server expects.
 *
 * `columnTaskIds` is the destination column's current top-to-bottom order and
 * may still contain the dragged card (same-column reorder); it is excluded
 * first. `dropIndex` is the insertion slot among the REMAINING cards
 * (0 = top, length = bottom) and is clamped into range.
 */
export function dropNeighborsForIndex(
  columnTaskIds: readonly string[],
  draggedTaskId: string,
  dropIndex: number,
): BoardDropNeighbors {
  const ids = columnTaskIds.filter((id) => id !== draggedTaskId);
  const index = Math.max(0, Math.min(dropIndex, ids.length));
  return {
    beforeTaskId: ids[index - 1] ?? null,
    afterTaskId: ids[index] ?? null,
  };
}

/**
 * Insertion slot for a pointer at `pointerY`, given the vertical centers of
 * the column's cards (top-to-bottom, dragged card excluded): the card count
 * whose center sits above the pointer.
 */
export function dropIndexForPointer(
  cardCenterYs: readonly number[],
  pointerY: number,
): number {
  let index = 0;
  for (const centerY of cardCenterYs) {
    if (pointerY > centerY) index += 1;
  }
  return index;
}

/**
 * Optimistic local application of a board move: removes the task from its
 * current column and inserts it at `dropIndex` in `toStatus` (index among the
 * destination cards after the dragged card is removed, as elsewhere in this
 * module). Returns the input unchanged when the task is unknown.
 */
export function applyBoardMove<T extends { id: string; status: TaskStatus }>(
  columns: Readonly<Record<TaskStatus, readonly T[]>>,
  taskId: string,
  toStatus: TaskStatus,
  dropIndex: number,
): Record<TaskStatus, T[]> {
  let moved: T | undefined;
  const next: Record<TaskStatus, T[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
    canceled: [],
  };
  for (const status of TASK_STATUSES) {
    next[status] = columns[status].filter((task) => {
      if (task.id !== taskId) return true;
      moved = task;
      return false;
    });
  }
  if (!moved) return next;
  const destination = next[toStatus];
  const index = Math.max(0, Math.min(dropIndex, destination.length));
  destination.splice(index, 0, { ...moved, status: toStatus });
  return next;
}
