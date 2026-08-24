import {
  SYNC_STORE_VERSION,
  SYNCED_TASK_FIELDS,
  type SyncComment,
  type SyncStore,
  type SyncTask,
  type SyncedTaskField,
} from "./store-file";

/** One task as it exists on the local board, with sync-relevant fields only. */
export interface BoardTask {
  id: string;
  key: string;
  number: number;
  title: string;
  status: SyncTask["status"];
  priority: SyncTask["priority"];
  description: string;
  dueDate: string | null;
  updatedAt: string;
  /** User and agent comments only; plugin audit rows are excluded upstream. */
  comments: SyncComment[];
}

export type ImportAction =
  | { kind: "create"; key: string; task: SyncTask }
  | {
      kind: "update";
      key: string;
      taskId: string;
      fields: SyncedTaskField[];
      task: SyncTask;
    }
  | { kind: "comment"; key: string; taskId: string; comment: SyncComment }
  | {
      kind: "conflict";
      key: string;
      taskId: string;
      fields: SyncedTaskField[];
      boardUpdatedAt: string;
      storeUpdatedAt: string;
    };

export type DriftClass = "MISSING" | "DRIFT" | "AHEAD" | "BEHIND" | "UNTRACKED";

export interface DriftEntry {
  drift: DriftClass;
  key: string;
  detail: string;
}

export function buildSyncStore(
  project: { prefix: string; name: string },
  tasks: readonly BoardTask[],
  generatedAt: string,
): SyncStore {
  return {
    version: SYNC_STORE_VERSION,
    generatedAt,
    project: { prefix: project.prefix, name: project.name },
    tasks: [...tasks]
      .sort((left, right) => left.number - right.number)
      .map((task) => ({
        key: task.key,
        number: task.number,
        title: task.title,
        status: task.status,
        priority: task.priority,
        description: task.description,
        dueDate: task.dueDate,
        updatedAt: task.updatedAt,
        comments: task.comments,
      })),
  };
}

function fieldValue(
  task: Pick<SyncTask, SyncedTaskField>,
  field: SyncedTaskField,
): string {
  return task[field] ?? "";
}

function changedFields(board: BoardTask, stored: SyncTask): SyncedTaskField[] {
  return SYNCED_TASK_FIELDS.filter(
    (field) => fieldValue(board, field) !== fieldValue(stored, field),
  );
}

function missingComments(board: BoardTask, stored: SyncTask): SyncComment[] {
  const seen = new Set(board.comments.map((comment) => comment.hash));
  return stored.comments.filter((comment) => !seen.has(comment.hash));
}

function extraComments(board: BoardTask, stored: SyncTask): SyncComment[] {
  const seen = new Set(stored.comments.map((comment) => comment.hash));
  return board.comments.filter((comment) => !seen.has(comment.hash));
}

function byKey(tasks: readonly BoardTask[]): Map<string, BoardTask> {
  return new Map(tasks.map((task) => [task.key.toUpperCase(), task]));
}

/**
 * What an import would do. Field updates are refused when the board's task was
 * updated after the store was exported, because the plugin cannot tell which
 * side is right and silent loss is worse than a stall. That comparison trusts
 * two hosts' wall clocks, so it is a guard against the common case rather than
 * a total order; `overwriteNewerBoardEdits` is the caller's way to say the
 * store wins anyway. Comments always append: matching them by body hash means
 * import never edits or deletes a note, so running it twice changes nothing
 * the second time.
 */
export function planImport(
  store: SyncStore,
  board: readonly BoardTask[],
  options: { overwriteNewerBoardEdits: boolean },
): ImportAction[] {
  const local = byKey(board);
  const actions: ImportAction[] = [];
  for (const stored of store.tasks) {
    const existing = local.get(stored.key.toUpperCase());
    if (!existing) {
      actions.push({ kind: "create", key: stored.key, task: stored });
      continue;
    }
    const fields = changedFields(existing, stored);
    if (fields.length > 0) {
      const boardIsNewer = existing.updatedAt > stored.updatedAt;
      actions.push(
        boardIsNewer && !options.overwriteNewerBoardEdits
          ? {
              kind: "conflict",
              key: stored.key,
              taskId: existing.id,
              fields,
              boardUpdatedAt: existing.updatedAt,
              storeUpdatedAt: stored.updatedAt,
            }
          : {
              kind: "update",
              key: stored.key,
              taskId: existing.id,
              fields,
              task: stored,
            },
      );
    }
    for (const comment of missingComments(existing, stored)) {
      actions.push({
        kind: "comment",
        key: stored.key,
        taskId: existing.id,
        comment,
      });
    }
  }
  return actions;
}

/**
 * Drift between the store and the local board, in the five classes that need
 * different responses: MISSING and BEHIND are fixed by importing here, AHEAD
 * and UNTRACKED by exporting from here, and DRIFT needs a human to decide
 * which side is right.
 */
export function checkDrift(
  store: SyncStore,
  board: readonly BoardTask[],
): DriftEntry[] {
  const local = byKey(board);
  const entries: DriftEntry[] = [];
  const storedKeys = new Set<string>();
  for (const stored of store.tasks) {
    storedKeys.add(stored.key.toUpperCase());
    const existing = local.get(stored.key.toUpperCase());
    if (!existing) {
      entries.push({
        drift: "MISSING",
        key: stored.key,
        detail: "in the store but not on this board — import here",
      });
      continue;
    }
    for (const field of changedFields(existing, stored)) {
      entries.push({
        drift: "DRIFT",
        key: stored.key,
        detail: `${field}: board=${summarize(fieldValue(existing, field))} store=${summarize(fieldValue(stored, field))}`,
      });
    }
    const behind = missingComments(existing, stored).length;
    if (behind > 0) {
      entries.push({
        drift: "BEHIND",
        key: stored.key,
        detail: `${behind} note(s) in the store are not on this board — import here`,
      });
    }
    const ahead = extraComments(existing, stored).length;
    if (ahead > 0) {
      entries.push({
        drift: "AHEAD",
        key: stored.key,
        detail: `${ahead} note(s) on this board are not in the store — export from here`,
      });
    }
  }
  for (const task of [...board].sort(
    (left, right) => left.number - right.number,
  )) {
    if (storedKeys.has(task.key.toUpperCase())) continue;
    entries.push({
      drift: "UNTRACKED",
      key: task.key,
      detail: "on this board but not in the store — export from here",
    });
  }
  return entries;
}

/** Drift classes that only an export from this instance can resolve. */
export function needsExport(entry: DriftEntry): boolean {
  return entry.drift === "AHEAD" || entry.drift === "UNTRACKED";
}

function summarize(value: string): string {
  const oneLine = value.replace(/\s+/gu, " ").trim();
  return JSON.stringify(
    oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine,
  );
}
