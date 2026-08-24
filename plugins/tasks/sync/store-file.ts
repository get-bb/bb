import { createHash } from "node:crypto";
import { z } from "zod";

import { TASK_PRIORITIES, TASK_STATUSES } from "../shared/contract";

/**
 * On-disk format of a project's sync store. It is a tracked file in a git
 * repository, and git is the transport: export on the instance where the work
 * happened, commit, pull elsewhere, import there. The board stays canonical on
 * each instance; this file is the convergence point between them.
 */
export const SYNC_STORE_VERSION = 1;

/**
 * A comment as the store carries it. `hash` is derived from the trimmed body
 * and is the only identity sync uses: comment ids are per instance, so
 * matching on them duplicates every note on every import. Hashing the body
 * makes import idempotent and append-only.
 *
 * Only `user` and `agent` comments travel. The plugin's own audit rows carry a
 * non-null `systemEvent` and stay on the instance that produced them.
 */
const syncCommentSchema = z
  .object({
    hash: z.string().min(1),
    kind: z.enum(["user", "agent"]),
    authorName: z.string().min(1),
    createdAt: z.string().min(1),
    body: z.string(),
  })
  .strict();

const syncTaskSchema = z
  .object({
    key: z.string().min(1),
    number: z.number().int().positive(),
    title: z.string(),
    status: z.enum(TASK_STATUSES),
    priority: z.enum(TASK_PRIORITIES),
    description: z.string(),
    dueDate: z.string().nullable(),
    /**
     * `updatedAt` from the exporting board. Import compares it against the
     * local task's `updatedAt` to detect a local edit made after the export,
     * which it refuses instead of overwriting.
     */
    updatedAt: z.string().min(1),
    comments: z.array(syncCommentSchema),
  })
  .strict();

export const syncStoreSchema = z
  .object({
    version: z.literal(SYNC_STORE_VERSION),
    generatedAt: z.string().min(1),
    project: z
      .object({ prefix: z.string().min(1), name: z.string().min(1) })
      .strict(),
    tasks: z.array(syncTaskSchema),
  })
  .strict();

export type SyncStore = z.infer<typeof syncStoreSchema>;
export type SyncTask = z.infer<typeof syncTaskSchema>;
export type SyncComment = z.infer<typeof syncCommentSchema>;

/** Stable identity of a comment body, shared by every instance. */
export function commentHash(body: string): string {
  return createHash("sha256")
    .update(body.trim(), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** The synced task fields, in the order reports list them. */
export const SYNCED_TASK_FIELDS = [
  "title",
  "status",
  "priority",
  "description",
  "dueDate",
] as const;

export type SyncedTaskField = (typeof SYNCED_TASK_FIELDS)[number];

export function parseSyncStore(text: string): SyncStore {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`sync store is not valid JSON: ${message}`);
  }
  const result = syncStoreSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `sync store does not match version ${SYNC_STORE_VERSION}: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return result.data;
}

export function serializeSyncStore(store: SyncStore): string {
  return `${JSON.stringify(store, null, 1)}\n`;
}

/**
 * Human-readable rendering of one task, written next to the JSON store so the
 * record is reviewable in a pull request. It is generated output: the board is
 * the source of truth and hand edits are lost on the next export.
 */
export function renderTaskMarkdown(
  task: SyncTask,
  storeFileName: string,
): string {
  const lines = [
    `# ${task.key} — ${task.title}`,
    "",
    "| | |",
    "| --- | --- |",
    `| Status | \`${task.status}\` |`,
    `| Priority | ${task.priority} |`,
    `| Due | ${task.dueDate ?? "-"} |`,
    `| Notes | ${task.comments.length} |`,
    "",
    `> Generated from \`${storeFileName}\` by \`bb tasks sync export\`. Edit the`,
    "> board, then export again. Do not hand-edit this file.",
    "",
    "---",
    "",
    task.description.trim() || "_(no description)_",
  ];
  if (task.comments.length > 0) {
    lines.push("", "---", "", "## Working record", "");
    for (const [index, comment] of task.comments.entries()) {
      lines.push(
        `### Note ${index + 1} — ${comment.authorName}`,
        "",
        comment.body.trim(),
        "",
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
