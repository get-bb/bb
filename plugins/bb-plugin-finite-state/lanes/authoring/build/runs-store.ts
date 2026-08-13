import { appendFile, stat } from "node:fs/promises";
import type Database from "better-sqlite3";
import { fromStorageProjectVersionId } from "../../../lib/store/index.js";

export type BuildRunKind = "build" | "flash";
export type BuildRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface BuildRunRecord {
  runId: string;
  kind: BuildRunKind;
  target: string | null;
  toolchain: string | null;
  status: BuildRunStatus;
  artifact: string | null;
  digest: string | null;
  logPath: string;
  startedAt: string;
}

export interface ScopedBuildRunRecord extends BuildRunRecord {
  projectId: string;
  projectVersionId: string | null;
}

export interface BuildRunScope {
  projectId: string;
  projectVersionId: string;
}

export interface BuildRunChangedHint {
  runId: string;
  status: BuildRunStatus;
  logBytes: number;
}

export interface BuildRunStore {
  db: Database.Database;
  publish(hint: BuildRunChangedHint): void;
}

export interface NewBuildRun extends BuildRunScope {
  runId: string;
  kind: BuildRunKind;
  target: string | null;
  toolchain: string | null;
  artifact: string | null;
  digest: string | null;
  logPath: string;
  startedAt: string;
}

export interface RunHistoryQuery extends BuildRunScope {
  pageSize: number;
  cursor: string | null;
  kinds: readonly (BuildRunKind | "probe")[];
  statuses: readonly BuildRunStatus[];
}

export interface RunHistoryPage {
  items: ScopedBuildRunRecord[];
  total: number;
  cursor: string | null;
}

interface BuildRunRow {
  project_id: string;
  project_version_id: string;
  run_id: string;
  kind: string;
  target: string | null;
  toolchain: string | null;
  status: string;
  artifact: string | null;
  digest: string | null;
  log_path: string | null;
  started_at: string;
}

interface CountRow {
  count: number;
}

interface HistoryCursor {
  startedAt: string;
  runId: string;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const STATUSES = new Set<BuildRunStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

function isBuildRunKind(value: string): value is BuildRunKind {
  return value === "build" || value === "flash";
}

function isBuildRunStatus(value: string): value is BuildRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function mapRow(row: BuildRunRow): ScopedBuildRunRecord {
  if (!isBuildRunKind(row.kind) || !isBuildRunStatus(row.status)) {
    throw new Error(`Invalid persisted build run ${row.run_id}`);
  }
  if (row.log_path === null || row.log_path.length === 0) {
    throw new Error(`Build run ${row.run_id} has no log path`);
  }
  if (row.digest !== null && !SHA256.test(row.digest)) {
    throw new Error(`Build run ${row.run_id} has an invalid digest`);
  }
  return {
    projectId: row.project_id,
    projectVersionId: fromStorageProjectVersionId(row.project_version_id),
    runId: row.run_id,
    kind: row.kind,
    target: row.target,
    toolchain: row.toolchain,
    status: row.status,
    artifact: row.artifact,
    digest: row.digest,
    logPath: row.log_path,
    startedAt: row.started_at,
  };
}

async function logBytes(logPath: string): Promise<number> {
  try {
    return (await stat(logPath)).size;
  } catch {
    return 0;
  }
}

async function publishCommitted(
  store: BuildRunStore,
  record: BuildRunRecord,
): Promise<void> {
  store.publish({
    runId: record.runId,
    status: record.status,
    logBytes: await logBytes(record.logPath),
  });
}

function scopedRow(
  db: Database.Database,
  scope: BuildRunScope,
  runId: string,
): BuildRunRow | undefined {
  return db
    .prepare<[string, string, string], BuildRunRow>(
      `SELECT project_id, project_version_id, run_id, kind, target, toolchain,
              status, artifact, digest, log_path, started_at
         FROM build_run
        WHERE project_id = ? AND project_version_id = ? AND run_id = ?`,
    )
    .get(scope.projectId, scope.projectVersionId, runId);
}

export function getBuildRun(
  db: Database.Database,
  scope: BuildRunScope,
  runId: string,
): ScopedBuildRunRecord | null {
  if (!RUN_ID.test(runId)) return null;
  const row = scopedRow(db, scope, runId);
  return row ? mapRow(row) : null;
}

export async function createBuildRun(
  store: BuildRunStore,
  input: NewBuildRun,
): Promise<ScopedBuildRunRecord> {
  if (!RUN_ID.test(input.runId)) throw new Error("Invalid build run id");
  if (
    !TIMESTAMP.test(input.startedAt) ||
    new Date(input.startedAt).toISOString() !== input.startedAt
  ) {
    throw new Error("Build run startedAt must be a canonical UTC timestamp");
  }
  if (input.digest !== null && !SHA256.test(input.digest)) {
    throw new Error("Build run digest must be a lowercase sha256");
  }
  store.db.transaction(() => {
    store.db
      .prepare(
        `INSERT INTO build_run
           (project_id, project_version_id, run_id, kind, target, toolchain,
            status, artifact, digest, log_path, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      )
      .run(
        input.projectId,
        input.projectVersionId,
        input.runId,
        input.kind,
        input.target,
        input.toolchain,
        input.artifact,
        input.digest,
        input.logPath,
        input.startedAt,
      );
  })();
  const record = getBuildRun(store.db, input, input.runId);
  if (!record) throw new Error("Build run insert did not persist");
  await publishCommitted(store, record);
  return record;
}

const ALLOWED_TRANSITIONS: Record<BuildRunStatus, readonly BuildRunStatus[]> = {
  queued: ["running", "failed", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export async function transitionBuildRun(
  store: BuildRunStore,
  scope: BuildRunScope,
  runId: string,
  status: BuildRunStatus,
  evidence: { artifact: string | null; digest: string | null },
): Promise<ScopedBuildRunRecord> {
  if (evidence.digest !== null && !SHA256.test(evidence.digest)) {
    throw new Error("Build run digest must be a lowercase sha256");
  }
  store.db.transaction(() => {
    const row = scopedRow(store.db, scope, runId);
    if (!row) throw new Error(`Unknown build run ${runId}`);
    if (!isBuildRunStatus(row.status)) throw new Error(`Invalid build run status ${row.status}`);
    if (!ALLOWED_TRANSITIONS[row.status].includes(status)) {
      throw new Error(`Invalid build run transition ${row.status} -> ${status}`);
    }
    if (row.digest !== null && evidence.digest !== null && row.digest !== evidence.digest) {
      throw new Error(`Build run ${runId} digest is immutable`);
    }
    const artifact = evidence.artifact ?? row.artifact;
    const digest = evidence.digest ?? row.digest;
    const result = store.db
      .prepare(
        `UPDATE build_run
            SET status = ?, artifact = ?, digest = ?
          WHERE project_id = ? AND project_version_id = ? AND run_id = ?
            AND status = ?`,
      )
      .run(
        status,
        artifact,
        digest,
        scope.projectId,
        scope.projectVersionId,
        runId,
        row.status,
      );
    if (result.changes !== 1) throw new Error(`Concurrent build run transition for ${runId}`);
  })();
  const record = getBuildRun(store.db, scope, runId);
  if (!record) throw new Error(`Unknown build run ${runId}`);
  await publishCommitted(store, record);
  return record;
}

function encodeCursor(row: ScopedBuildRunRecord): string {
  const value: HistoryCursor = { startedAt: row.startedAt, runId: row.runId };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string): HistoryCursor {
  let parsed: unknown;
  try {
    const text = Buffer.from(value, "base64url").toString("utf8");
    if (Buffer.from(text, "utf8").toString("base64url") !== value) throw new Error();
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid build run cursor");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error("Invalid build run cursor");
  }
  const startedAt = Reflect.get(parsed, "startedAt");
  const runId = Reflect.get(parsed, "runId");
  if (
    typeof startedAt !== "string" ||
    typeof runId !== "string" ||
    !RUN_ID.test(runId)
  ) {
    throw new Error("Invalid build run cursor");
  }
  return {
    startedAt,
    runId,
  };
}

function filterClause(query: RunHistoryQuery): { sql: string; values: string[] } {
  if (
    query.kinds.some(
      (kind) => kind !== "build" && kind !== "flash" && kind !== "probe",
    )
  ) {
    throw new Error("Invalid build run kind filter");
  }
  if (query.statuses.some((status) => !STATUSES.has(status))) {
    throw new Error("Invalid build run status filter");
  }
  const clauses = ["project_id = ?", "project_version_id = ?"];
  const values = [query.projectId, query.projectVersionId];
  if (query.kinds.length > 0) {
    const supportedKinds = query.kinds.filter(
      (kind): kind is BuildRunKind => kind === "build" || kind === "flash",
    );
    if (supportedKinds.length === 0) {
      clauses.push("0 = 1");
    } else {
      clauses.push(`kind IN (${supportedKinds.map(() => "?").join(",")})`);
      values.push(...supportedKinds);
    }
  }
  if (query.statuses.length > 0) {
    clauses.push(`status IN (${query.statuses.map(() => "?").join(",")})`);
    values.push(...query.statuses);
  }
  return { sql: clauses.join(" AND "), values };
}

export function listBuildRuns(
  db: Database.Database,
  query: RunHistoryQuery,
): RunHistoryPage {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 200) {
    throw new Error("Build run pageSize must be between 1 and 200");
  }
  const filter = filterClause(query);
  const cursor = query.cursor === null ? null : decodeCursor(query.cursor);
  const cursorSql = cursor
    ? " AND (started_at < ? OR (started_at = ? AND run_id < ?))"
    : "";
  const values: Array<string | number> = [...filter.values];
  if (cursor) values.push(cursor.startedAt, cursor.startedAt, cursor.runId);
  values.push(query.pageSize + 1);
  const rows = db
    .prepare<Array<string | number>, BuildRunRow>(
      `SELECT project_id, project_version_id, run_id, kind, target, toolchain,
              status, artifact, digest, log_path, started_at
         FROM build_run
        WHERE ${filter.sql}${cursorSql}
        ORDER BY started_at DESC, run_id DESC
        LIMIT ?`,
    )
    .all(...values);
  const visible = rows.slice(0, query.pageSize).map(mapRow);
  const total = db
    .prepare<string[], CountRow>(
      `SELECT COUNT(*) AS count FROM build_run WHERE ${filter.sql}`,
    )
    .get(...filter.values)?.count ?? 0;
  return {
    items: visible,
    total,
    cursor:
      rows.length > query.pageSize && visible.at(-1)
        ? encodeCursor(visible.at(-1)!)
        : null,
  };
}

export function latestSuccessfulBuild(
  db: Database.Database,
  scope: BuildRunScope,
  target: string | null,
): ScopedBuildRunRecord | null {
  const row = target === null
    ? db
        .prepare<[string, string], BuildRunRow>(
          `SELECT project_id, project_version_id, run_id, kind, target, toolchain,
                  status, artifact, digest, log_path, started_at
             FROM build_run
            WHERE project_id = ? AND project_version_id = ?
              AND kind = 'build' AND status = 'succeeded'
            ORDER BY started_at DESC, run_id DESC LIMIT 1`,
        )
        .get(scope.projectId, scope.projectVersionId)
    : db
        .prepare<[string, string, string], BuildRunRow>(
          `SELECT project_id, project_version_id, run_id, kind, target, toolchain,
                  status, artifact, digest, log_path, started_at
             FROM build_run
            WHERE project_id = ? AND project_version_id = ? AND target = ?
              AND kind = 'build' AND status = 'succeeded'
            ORDER BY started_at DESC, run_id DESC LIMIT 1`,
        )
        .get(scope.projectId, scope.projectVersionId, target);
  return row ? mapRow(row) : null;
}

export async function recoverOrphanedBuildRuns(
  store: BuildRunStore,
): Promise<number> {
  const rows = store.db
    .prepare<[], BuildRunRow>(
      `SELECT project_id, project_version_id, run_id, kind, target, toolchain,
              status, artifact, digest, log_path, started_at
         FROM build_run WHERE status IN ('queued','running')`,
    )
    .all();
  if (rows.length === 0) return 0;
  await Promise.all(
    rows.map(async (row) => {
      if (row.log_path === null) return;
      try {
        await appendFile(
          row.log_path,
          `\n[finite-state] orphaned: plugin restarted while the job was ${row.status}\n`,
          "utf8",
        );
      } catch {
        // Status recovery is authoritative even if a stale log path disappeared.
      }
    }),
  );
  store.db.transaction(() => {
    for (const row of rows) {
      store.db
        .prepare(
          `UPDATE build_run SET status = 'failed'
            WHERE project_id = ? AND project_version_id = ? AND run_id = ?
              AND status = ?`,
        )
        .run(row.project_id, row.project_version_id, row.run_id, row.status);
    }
  })();
  for (const row of rows) {
    const recovered = getBuildRun(
      store.db,
      { projectId: row.project_id, projectVersionId: row.project_version_id },
      row.run_id,
    );
    if (recovered) await publishCommitted(store, recovered);
  }
  return rows.length;
}
