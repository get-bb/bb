import { dirname, join, resolve } from "node:path";
import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";

import { createComment, publishTasksChanged, type TasksApiStore } from "../api";
import type { Comment, Project } from "../db";
import { TASKS_PAGE_MAX_LIMIT } from "../shared/pagination";
import {
  buildSyncStore,
  checkDrift,
  needsExport,
  planImport,
  type BoardTask,
  type DriftEntry,
  type ImportAction,
} from "../sync/plan";
import {
  commentHash,
  parseSyncStore,
  renderTaskMarkdown,
  serializeSyncStore,
  type SyncComment,
} from "../sync/store-file";
import {
  assertAllowed,
  CliError,
  option,
  parseArgs,
  requirePositionals,
} from "./args";

export const SYNC_HELP = `Usage:
  bb tasks sync export [--project <prefix-or-id>] [--store <path>] [--machine <id-or-name>] [--json]
  bb tasks sync import [--project <prefix-or-id>] [--store <path>] [--apply] [--force] [--machine <id-or-name>] [--json]
  bb tasks sync check  [--project <prefix-or-id>] [--store <path>] [--machine <id-or-name>] [--json]

Git is the transport and each board stays canonical: export on the instance
where the work happened, commit the store, pull it elsewhere, import there.

export writes the store and one <KEY>.md per task beside it, and refuses to
write an empty board over an existing record. import is a dry run until
--apply; it creates missing tasks, updates changed fields, and appends notes
the local board has not seen, matching notes by body so a repeat run is a
no-op. It refuses a field update when the local task changed after the export
and reports it; --force overwrites instead. check reports drift and exits 2
when it finds any, so it can run as a scheduled automation.

The store path comes from --store or the project's configured
--sync-store; a relative path resolves against the invoking directory. A
project with --sync-role mirror imports only: export refuses, and check
reports local edits that cannot travel back.`;

/** Column-aligned report rows, with no header line. */
function alignedRows(
  rows: readonly (readonly string[])[],
  emptyMessage: string,
): string {
  if (rows.length === 0) return emptyMessage;
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, index) =>
          index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0),
        )
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/** Author recorded on the local audit trail an import leaves behind. */
const SYNC_AUTHOR_NAME = "sync";
const DRIFT_EXIT_CODE = 2;

export interface SyncCliDeps {
  resolveProject(address: string | undefined): Promise<Project>;
  resolveHostId(machine: string | undefined): Promise<string | undefined>;
  /** Resolves to null when the file does not exist. */
  readText(hostId: string | undefined, path: string): Promise<string | null>;
  writeText(
    hostId: string | undefined,
    path: string,
    text: string,
  ): Promise<void>;
  updateTask(input: {
    taskId: string;
    title: string;
    description: string;
    status: BoardTask["status"];
    priority: BoardTask["priority"];
    dueDate: string | null;
    authorName: string;
  }): Promise<void>;
}

/**
 * A comment belongs to the shared record only when the plugin did not write it
 * itself. `systemEvent` is the structural marker for a plugin audit row, so
 * this never has to match on the rendered body: propagating audit rows made
 * both boards drift permanently, because each import generated fresh ones on
 * the far side.
 */
function isSyncableComment(comment: Comment): boolean {
  return comment.systemEvent === null && comment.kind !== "system";
}

function toSyncComment(comment: Comment): SyncComment {
  return {
    hash: commentHash(comment.body),
    kind: comment.kind === "agent" ? "agent" : "user",
    authorName: comment.authorName,
    createdAt: comment.createdAt,
    body: comment.body,
  };
}

function readBoard(store: TasksApiStore, projectId: string): BoardTask[] {
  const tasks: BoardTask[] = [];
  let cursor: string | undefined;
  do {
    const page = store.tasks.listTasksPage({
      projectId,
      limit: TASKS_PAGE_MAX_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    for (const task of page.tasks) {
      tasks.push({
        id: task.id,
        key: task.key,
        number: task.number,
        title: task.title,
        status: task.status,
        priority: task.priority,
        description: task.description,
        dueDate: task.dueDate,
        updatedAt: task.updatedAt,
        comments: store.tasks
          .listComments(task.id)
          .filter(isSyncableComment)
          .map(toSyncComment),
      });
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return tasks.sort((left, right) => left.number - right.number);
}

function storePath(
  project: Project,
  explicit: string | undefined,
  cwd: string,
): string {
  const configured = explicit ?? project.syncStorePath;
  if (!configured) {
    throw new CliError(
      `project ${project.prefix} has no sync store; pass --store <path> or set it with bb tasks project update ${project.prefix} --sync-store <path>`,
    );
  }
  return resolve(cwd, configured);
}

async function loadStore(
  deps: SyncCliDeps,
  hostId: string | undefined,
  path: string,
): Promise<ReturnType<typeof parseSyncStore>> {
  const text = await deps.readText(hostId, path);
  if (text === null) {
    throw new CliError(
      `no sync store at ${path} — run bb tasks sync export on the instance that holds the record, then pull it here`,
    );
  }
  return parseSyncStore(text);
}

async function runExportMode(
  store: TasksApiStore,
  deps: SyncCliDeps,
  project: Project,
  path: string,
  hostId: string | undefined,
  json: boolean,
): Promise<string> {
  if (project.syncRole === "mirror") {
    throw new CliError(
      `project ${project.prefix} is a sync mirror and imports only; run bb tasks sync check to report local edits, or set bb tasks project update ${project.prefix} --sync-role source`,
    );
  }
  const board = readBoard(store, project.id);
  // Without this guard, an export on a fresh instance replaces the record for
  // every instance with an empty file.
  if (board.length === 0) {
    throw new CliError(
      `project ${project.prefix} has no tasks on this board — refusing to overwrite ${path} with an empty store`,
    );
  }
  const record = buildSyncStore(project, board, new Date().toISOString());
  await deps.writeText(hostId, path, serializeSyncStore(record));
  const directory = dirname(path);
  const fileName = path.slice(directory.length + 1) || "the sync store";
  for (const task of record.tasks) {
    await deps.writeText(
      hostId,
      join(directory, `${task.key}.md`),
      renderTaskMarkdown(task, fileName),
    );
  }
  const notes = record.tasks.reduce(
    (total, task) => total + task.comments.length,
    0,
  );
  return json
    ? JSON.stringify({
        mode: "export",
        storePath: path,
        project: project.prefix,
        tasks: record.tasks.length,
        notes,
        generatedAt: record.generatedAt,
      })
    : `Exported ${record.tasks.length} task(s) and ${notes} note(s) to ${path}`;
}

function describeAction(action: ImportAction, applied: boolean): string[] {
  switch (action.kind) {
    case "create":
      return [
        applied ? "+" : "would",
        "CREATE",
        action.key,
        `${action.task.title} (${action.task.comments.length} note(s))`,
      ];
    case "update":
      return [
        applied ? "~" : "would",
        "UPDATE",
        action.key,
        `fields: ${action.fields.join(",")}`,
      ];
    case "comment":
      return [
        applied ? "+" : "would",
        "NOTE",
        action.key,
        action.comment.body.trim().split("\n")[0] ?? "",
      ];
    case "conflict":
      return [
        "!",
        "CONFLICT",
        action.key,
        `fields: ${action.fields.join(",")} — this board changed at ${action.boardUpdatedAt}, after the store's ${action.storeUpdatedAt}; rerun with --force to overwrite`,
      ];
  }
}

async function applyAction(
  bb: BbPluginApi,
  store: TasksApiStore,
  deps: SyncCliDeps,
  project: Project,
  action: ImportAction,
): Promise<void> {
  switch (action.kind) {
    case "create": {
      // The number comes from the store so the task keeps the same key on
      // every instance; a store keyed by AGT-5 is useless if importing it
      // creates AGT-1 here.
      const created = store.tasks.createTask({
        projectId: project.id,
        number: action.task.number,
        title: action.task.title,
        description: action.task.description,
        status: action.task.status,
        priority: action.task.priority,
        dueDate: action.task.dueDate,
      });
      publishTasksChanged(bb, created.id, project.id);
      for (const comment of action.task.comments) {
        await appendComment(bb, store, created.id, comment);
      }
      return;
    }
    case "update": {
      await deps.updateTask({
        taskId: action.taskId,
        title: action.task.title,
        description: action.task.description,
        status: action.task.status,
        priority: action.task.priority,
        dueDate: action.task.dueDate,
        authorName: SYNC_AUTHOR_NAME,
      });
      return;
    }
    case "comment": {
      await appendComment(bb, store, action.taskId, action.comment);
      return;
    }
    case "conflict":
      return;
  }
}

async function appendComment(
  bb: BbPluginApi,
  store: TasksApiStore,
  taskId: string,
  comment: SyncComment,
): Promise<void> {
  await createComment(bb, store, {
    taskId,
    kind: comment.kind,
    authorName: comment.authorName.trim() || SYNC_AUTHOR_NAME,
    presetName: null,
    // Thread ids are per instance, so an imported agent note carries none.
    threadId: null,
    body: comment.body,
    notify: false,
  });
}

async function runImportMode(
  bb: BbPluginApi,
  store: TasksApiStore,
  deps: SyncCliDeps,
  project: Project,
  path: string,
  hostId: string | undefined,
  options: { apply: boolean; force: boolean; json: boolean },
): Promise<string | PluginCliResult> {
  const record = await loadStore(deps, hostId, path);
  if (record.project.prefix.toUpperCase() !== project.prefix.toUpperCase()) {
    throw new CliError(
      `${path} holds project ${record.project.prefix}, not ${project.prefix}`,
    );
  }
  const actions = planImport(record, readBoard(store, project.id), {
    overwriteNewerBoardEdits: options.force,
  });
  if (options.apply) {
    // Applied one action at a time rather than in one transaction: each write
    // is individually atomic, and import is idempotent, so a failure part way
    // through is fixed by running it again rather than by a rollback.
    for (const action of actions) {
      await applyAction(bb, store, deps, project, action);
    }
  }
  const conflicts = actions.filter(
    (action) => action.kind === "conflict",
  ).length;
  const changes = actions.length - conflicts;
  const summary = options.apply
    ? `${changes} change(s) applied`
    : `${changes} change(s) pending — rerun with --apply`;
  const conflictNote =
    conflicts === 0
      ? ""
      : `\n${conflicts} conflict(s) refused; the local edit is newer and cannot be reconciled automatically`;
  const stdout = options.json
    ? JSON.stringify({
        mode: "import",
        storePath: path,
        project: project.prefix,
        applied: options.apply,
        changes,
        conflicts,
        actions: actions.map((action) => ({
          kind: action.kind,
          key: action.key,
          ...(action.kind === "update" || action.kind === "conflict"
            ? { fields: action.fields }
            : {}),
        })),
      })
    : [
        alignedRows(
          actions.map((action) => describeAction(action, options.apply)),
          "no changes",
        ),
        `${summary}${conflictNote}`,
      ].join("\n");
  return conflicts === 0
    ? stdout
    : { exitCode: DRIFT_EXIT_CODE, stdout, stderr: "" };
}

async function runCheckMode(
  store: TasksApiStore,
  deps: SyncCliDeps,
  project: Project,
  path: string,
  hostId: string | undefined,
  json: boolean,
): Promise<string | PluginCliResult> {
  const record = await loadStore(deps, hostId, path);
  const entries = checkDrift(record, readBoard(store, project.id));
  const isMirror = project.syncRole === "mirror";
  const detail = (entry: DriftEntry): string =>
    isMirror && needsExport(entry)
      ? `${entry.detail} (this instance is a sync mirror, so the edit cannot travel back)`
      : entry.detail;
  const unsyncable = isMirror ? entries.filter(needsExport).length : 0;
  const stdout = json
    ? JSON.stringify({
        mode: "check",
        storePath: path,
        project: project.prefix,
        syncRole: project.syncRole,
        generatedAt: record.generatedAt,
        drift: entries.length,
        unsyncableLocalEdits: unsyncable,
        entries: entries.map((entry) => ({
          drift: entry.drift,
          key: entry.key,
          detail: detail(entry),
        })),
      })
    : [
        alignedRows(
          entries.map((entry) => [entry.drift, entry.key, detail(entry)]),
          "no drift",
        ),
        `drift: ${entries.length} (store generated ${record.generatedAt})`,
        ...(unsyncable > 0
          ? [
              `${unsyncable} local edit(s) cannot be exported from this mirror; make the change on the source instance`,
            ]
          : []),
      ].join("\n");
  return entries.length === 0
    ? stdout
    : { exitCode: DRIFT_EXIT_CODE, stdout, stderr: "" };
}

export async function runSync(
  bb: BbPluginApi,
  store: TasksApiStore,
  deps: SyncCliDeps,
  argv: string[],
  cwd: string,
): Promise<string | PluginCliResult> {
  const [mode, ...rest] = argv;
  if (!mode || mode === "--help") return SYNC_HELP;
  if (mode !== "export" && mode !== "import" && mode !== "check") {
    throw new CliError(`unknown sync mode: ${mode}; run bb tasks sync --help`);
  }
  const args = parseArgs(rest);
  if (args.flags.has("help")) return SYNC_HELP;
  assertAllowed(args, ["project", "store", "machine"], ["apply", "force"]);
  requirePositionals(args, 0, `bb tasks sync ${mode} [options] [--json]`);
  if (
    mode !== "import" &&
    (args.flags.has("apply") || args.flags.has("force"))
  ) {
    throw new CliError("--apply and --force apply to bb tasks sync import");
  }
  const project = await deps.resolveProject(option(args, "project"));
  const path = storePath(project, option(args, "store"), cwd);
  const hostId = await deps.resolveHostId(option(args, "machine"));
  const json = args.flags.has("json");

  if (mode === "export") {
    return runExportMode(store, deps, project, path, hostId, json);
  }
  if (mode === "import") {
    return runImportMode(bb, store, deps, project, path, hostId, {
      apply: args.flags.has("apply"),
      force: args.flags.has("force"),
      json,
    });
  }
  return runCheckMode(store, deps, project, path, hostId, json);
}
