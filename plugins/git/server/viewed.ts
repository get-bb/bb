import {
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  GIT_VIEWED_MAX_PATHS,
  gitViewedFileSchema,
  type GitViewedFile,
  type WorkspaceDiffTarget,
} from "../contract.js";
import { requireGitEnvironment } from "./reads.js";

export interface GitViewed {
  list(
    environmentId: string,
    target: WorkspaceDiffTarget,
    paths: string[] | undefined,
  ): Promise<{ files: GitViewedFile[] }>;
  mark(
    environmentId: string,
    target: WorkspaceDiffTarget,
    path: string,
    revision: string,
  ): Promise<{ ok: true }>;
  clear(
    environmentId: string,
    target: WorkspaceDiffTarget,
    path: string | undefined,
  ): Promise<{ ok: true }>;
}

export const VIEWED_MARKS_FROM_CORE_KEY = "viewedMarksFromCore";

const VIEWED_MIGRATIONS = [
  `CREATE TABLE viewed_files (
    environment_id TEXT NOT NULL,
    target_key TEXT NOT NULL,
    path TEXT NOT NULL,
    revision TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (environment_id, target_key, path)
  ) WITHOUT ROWID`,
];

const coreMarksSchema = z.array(
  z.object({
    environmentId: z.string(),
    targetKey: z.string(),
    path: z.string(),
    revision: z.string(),
    updatedAt: z.number(),
  }),
);

function targetKey(target: WorkspaceDiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "uncommitted";
    case "branch_committed":
    case "all":
      return `${target.type}:${target.mergeBaseBranch}`;
    case "commit":
      return `commit:${target.sha.toLowerCase()}`;
  }
}

export function createGitViewed(
  bb: BbPluginApi,
  changed: (environmentId: string) => void,
): GitViewed {
  const db = bb.storage.database();
  bb.storage.migrate(db, VIEWED_MIGRATIONS);
  const insert = db.prepare(
    `INSERT INTO viewed_files (environment_id, target_key, path, revision, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (environment_id, target_key, path)
     DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
  );

  async function importCoreMarks(): Promise<void> {
    const stored = await bb.storage.kv.get(VIEWED_MARKS_FROM_CORE_KEY);
    if (stored === undefined) return;
    const marks = coreMarksSchema.parse(stored);
    db.transaction(() => {
      for (const mark of marks) {
        insert.run(
          mark.environmentId,
          mark.targetKey,
          mark.path,
          mark.revision,
          mark.updatedAt,
        );
      }
    })();
    await bb.storage.kv.delete(VIEWED_MARKS_FROM_CORE_KEY);
  }

  async function forgetDeletedEnvironments(): Promise<void> {
    const marked = z
      .array(z.string())
      .parse(
        db
          .prepare("SELECT DISTINCT environment_id FROM viewed_files")
          .pluck()
          .all(),
      );
    if (marked.length === 0) return;
    const [listed, destroyed] = await Promise.all([
      bb.sdk.environments.list(),
      bb.sdk.environments.list({ status: "destroyed" }),
    ]);
    const existing = new Set(
      [...listed, ...destroyed].map((environment) => environment.id),
    );
    const remove = db.prepare(
      "DELETE FROM viewed_files WHERE environment_id = ?",
    );
    for (const id of marked) if (!existing.has(id)) remove.run(id);
  }

  const ready = importCoreMarks().catch((error: unknown) =>
    bb.log.warn(`Could not import Viewed marks: ${String(error)}`),
  );
  void ready
    .then(forgetDeletedEnvironments)
    .catch((error: unknown) =>
      bb.log.warn(`Could not forget deleted environments' Viewed marks: ${String(error)}`),
    );

  async function scopeKey(
    environmentId: string,
    target: WorkspaceDiffTarget,
  ): Promise<string> {
    await ready;
    await requireGitEnvironment(bb, environmentId);
    return targetKey(target);
  }

  return {
    async list(environmentId, target, paths) {
      if (paths !== undefined && paths.length > GIT_VIEWED_MAX_PATHS) {
        throw new experimental_PluginRpcRefusal({
          code: "invalid",
          message: `At most ${GIT_VIEWED_MAX_PATHS} paths can be listed at once.`,
        });
      }
      const key = await scopeKey(environmentId, target);
      if (paths?.length === 0) return { files: [] };
      const filter =
        paths === undefined
          ? ""
          : ` AND path IN (SELECT value FROM json_each(?))`;
      const rows = db
        .prepare(
          `SELECT path, revision FROM viewed_files
           WHERE environment_id = ? AND target_key = ?${filter}
           ORDER BY path`,
        )
        .all(
          environmentId,
          key,
          ...(paths === undefined ? [] : [JSON.stringify(paths)]),
        );
      return { files: z.array(gitViewedFileSchema).parse(rows) };
    },
    async mark(environmentId, target, path, revision) {
      const key = await scopeKey(environmentId, target);
      insert.run(environmentId, key, path, revision, Date.now());
      changed(environmentId);
      return { ok: true };
    },
    async clear(environmentId, target, path) {
      const key = await scopeKey(environmentId, target);
      db.prepare(
        `DELETE FROM viewed_files
         WHERE environment_id = ? AND target_key = ?${path === undefined ? "" : " AND path = ?"}`,
      ).run(environmentId, key, ...(path === undefined ? [] : [path]));
      changed(environmentId);
      return { ok: true };
    },
  };
}
