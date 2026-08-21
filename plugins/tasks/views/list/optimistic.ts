import type {
  Task,
  TaskPriority,
  TaskStatus,
} from "../../shared/contract.js";

/**
 * The subset of task fields carried by an optimistic override. Every key is
 * optional so an override holds only the field(s) an in-flight edit touched; a
 * present key always holds a concrete value (including `dueDate: null`).
 * `position` is never set by the user — it is captured from the server's
 * authoritative response when a status change reorders the row, so the row
 * lands in its final slot immediately instead of jumping after the refetch.
 */
export interface TaskEdit {
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  labelIds?: string[];
  position?: number;
}

type EditField = keyof TaskEdit;
const EDIT_FIELDS: readonly EditField[] = [
  "status",
  "priority",
  "dueDate",
  "labelIds",
  "position",
];

/**
 * One task's optimistic state. `gens` records, per field, the generation of the
 * edit that last set it, so an out-of-order failure only rolls back a field it
 * still owns. `inFlight` counts pending writes so the pending indicator clears
 * only when the last one settles.
 */
interface TaskEntry {
  edit: TaskEdit;
  gens: Partial<Record<EditField, number>>;
  inFlight: number;
}

/** Optimistic entries keyed by task id (immutable snapshots). */
export type TaskEntries = ReadonlyMap<string, TaskEntry>;

function sameIds(
  a: readonly string[] | null | undefined,
  b: readonly string[] | null | undefined,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const set = new Set(right);
  return left.every((id) => set.has(id));
}

function hasFields(edit: TaskEdit): boolean {
  return EDIT_FIELDS.some((field) => edit[field] !== undefined);
}

/** Whether the server task already reflects an override field's value. */
function fieldSettled(task: Task, field: EditField, edit: TaskEdit): boolean {
  if (field === "labelIds") return sameIds(edit.labelIds, task.labelIds);
  return task[field] === edit[field];
}

/** Overlays a pending optimistic edit on top of the authoritative server task. */
export function applyEdit(task: Task, edit: TaskEdit | undefined): Task {
  if (edit === undefined || !hasFields(edit)) return task;
  return {
    ...task,
    ...(edit.status !== undefined ? { status: edit.status } : {}),
    ...(edit.priority !== undefined ? { priority: edit.priority } : {}),
    ...(edit.dueDate !== undefined ? { dueDate: edit.dueDate } : {}),
    ...(edit.labelIds !== undefined ? { labelIds: edit.labelIds } : {}),
    ...(edit.position !== undefined ? { position: edit.position } : {}),
  };
}

/** Display-ready tasks with pending optimistic edits overlaid. */
export function editedTasks(
  serverTasks: readonly Task[],
  entries: TaskEntries,
): Task[] {
  if (entries.size === 0) return [...serverTasks];
  return serverTasks.map((task) => applyEdit(task, entries.get(task.id)?.edit));
}

/**
 * Re-applies the active filters that an inline edit can invalidate — status,
 * priority, and labels. Labels use the server's any-of semantics (a task
 * matches if it carries at least one selected label id), so an optimistically
 * changed row that no longer matches drops out immediately instead of lingering
 * until the server refetch removes it.
 */
export function matchesFilters(
  task: Task,
  statuses: readonly TaskStatus[],
  priorities: readonly TaskPriority[],
  labelIds: readonly string[],
): boolean {
  return (
    (statuses.length === 0 || statuses.includes(task.status)) &&
    (priorities.length === 0 || priorities.includes(task.priority)) &&
    (labelIds.length === 0 ||
      task.labelIds.some((id) => labelIds.includes(id)))
  );
}

function makeEntry(prev: TaskEntry | undefined): {
  edit: TaskEdit;
  gens: Partial<Record<EditField, number>>;
} {
  return { edit: { ...prev?.edit }, gens: { ...prev?.gens } };
}

/** Applies an edit optimistically, stamping each touched field with `gen`. */
export function beginEdit(
  entries: TaskEntries,
  taskId: string,
  patch: TaskEdit,
  gen: number,
): TaskEntries {
  const prev = entries.get(taskId);
  // Callers only pass concrete values, so merging the patch never introduces
  // an explicit `undefined`.
  const edit: TaskEdit = { ...prev?.edit, ...patch };
  const gens = { ...prev?.gens };
  for (const field of EDIT_FIELDS) {
    if (patch[field] !== undefined) gens[field] = gen;
  }
  const next = new Map(entries);
  next.set(taskId, { edit, gens, inFlight: (prev?.inFlight ?? 0) + 1 });
  return next;
}

function finalize(
  entries: TaskEntries,
  taskId: string,
  edit: TaskEdit,
  gens: Partial<Record<EditField, number>>,
  inFlight: number,
): TaskEntries {
  const next = new Map(entries);
  if (!hasFields(edit) && inFlight <= 0) next.delete(taskId);
  else next.set(taskId, { edit, gens, inFlight: Math.max(0, inFlight) });
  return next;
}

/**
 * Settles a successful write. The optimistic values stay until the refetch
 * confirms them (avoiding a flicker); the only mutation here is capturing the
 * server-assigned `position` when this edit changed status and still owns it,
 * so a status move lands in its final ordering slot without a jump.
 */
export function settleSuccess(
  entries: TaskEntries,
  taskId: string,
  patch: TaskEdit,
  gen: number,
  serverTask: Task,
): TaskEntries {
  const prev = entries.get(taskId);
  if (prev === undefined) return entries;
  const { edit, gens } = makeEntry(prev);
  if (patch.status !== undefined && gens.status === gen) {
    edit.position = serverTask.position;
    gens.position = gen;
  }
  return finalize(entries, taskId, edit, gens, prev.inFlight - 1);
}

/**
 * Settles a failed write by rolling back only the fields this edit still owns —
 * a newer edit to the same field (higher generation) is left untouched.
 */
export function settleFailure(
  entries: TaskEntries,
  taskId: string,
  patch: TaskEdit,
  gen: number,
): TaskEntries {
  const prev = entries.get(taskId);
  if (prev === undefined) return entries;
  const { edit, gens } = makeEntry(prev);
  for (const field of EDIT_FIELDS) {
    if (patch[field] !== undefined && gens[field] === gen) {
      delete edit[field];
      delete gens[field];
    }
  }
  return finalize(entries, taskId, edit, gens, prev.inFlight - 1);
}

function sameEntry(a: TaskEntry, b: TaskEntry): boolean {
  if (a.inFlight !== b.inFlight) return false;
  for (const field of EDIT_FIELDS) {
    if (a.gens[field] !== b.gens[field]) return false;
    if (field === "labelIds") {
      if (!sameIds(a.edit.labelIds, b.edit.labelIds)) return false;
    } else if (a.edit[field] !== b.edit[field]) {
      return false;
    }
  }
  return true;
}

function sameEntries(a: TaskEntries, b: TaskEntries): boolean {
  if (a.size !== b.size) return false;
  for (const [id, entryA] of a) {
    const entryB = b.get(id);
    if (entryB === undefined || !sameEntry(entryA, entryB)) return false;
  }
  return true;
}

/**
 * Reconciles optimistic entries against fresh server data: drops fields the
 * server now agrees with (the write landed) and entries for tasks the server no
 * longer returns, while keeping any entry with an in-flight write. Returns the
 * same reference when nothing changed so an effect can set state without
 * re-rendering.
 */
export function reconcileEntries(
  entries: TaskEntries,
  tasks: readonly Task[],
): TaskEntries {
  if (entries.size === 0) return entries;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const next = new Map<string, TaskEntry>();
  for (const [id, entry] of entries) {
    const task = byId.get(id);
    if (task === undefined) continue;
    const edit: TaskEdit = {};
    const gens: Partial<Record<EditField, number>> = {};
    for (const field of EDIT_FIELDS) {
      const value = entry.edit[field];
      if (value === undefined || fieldSettled(task, field, entry.edit)) continue;
      Object.assign(edit, { [field]: value });
      gens[field] = entry.gens[field];
    }
    if (hasFields(edit) || entry.inFlight > 0) {
      next.set(id, { edit, gens, inFlight: entry.inFlight });
    }
  }
  return sameEntries(entries, next) ? entries : next;
}

/** Task ids with an in-flight write, for loading affordances. */
export function pendingIds(entries: TaskEntries): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [id, entry] of entries) {
    if (entry.inFlight > 0) ids.add(id);
  }
  return ids;
}
