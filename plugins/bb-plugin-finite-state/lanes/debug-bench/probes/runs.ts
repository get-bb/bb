import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";

export type ProbeOutcome = "confirmed" | "refuted" | "inconclusive";

export interface ProbeRunRecord {
  runId: string;
  scriptPath: string;
  deviceIds: string[];
  hypothesis: string;
  outcome: ProbeOutcome;
  artifacts: string[];
  startedAt: string;
  finishedAt: string | null;
}

export interface ProbeRunScope {
  projectId: string;
  projectVersionId: string | null;
}

export interface ProbeRunStart extends ProbeRunScope {
  runId: string;
  scriptPath: string;
  deviceIds: readonly string[];
  hypothesis: string;
  startedAt: string;
}

interface ProbeRunRow {
  run_id: string;
  script_path: string;
  devices: string;
  hypothesis: string | null;
  outcome: ProbeOutcome | null;
  artifacts: string | null;
  started_at: string;
  finished_at: string | null;
}

export function startProbeRun(db: Database.Database, input: ProbeRunStart): void {
  db.prepare(
    `INSERT INTO probe_run (
       project_id, project_version_id, run_id, script_path, devices,
       hypothesis, outcome, artifacts, started_at, finished_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, '[]', ?, NULL)`,
  ).run(
    input.projectId,
    toStorageProjectVersionId(input.projectVersionId),
    input.runId,
    input.scriptPath,
    JSON.stringify([...input.deviceIds]),
    input.hypothesis,
    input.startedAt,
  );
}

export function finishProbeRun(
  db: Database.Database,
  scope: ProbeRunScope,
  runId: string,
  outcome: ProbeOutcome,
  artifacts: readonly string[],
  finishedAt: string,
): ProbeRunRecord {
  const changed = db.prepare(
    `UPDATE probe_run SET outcome = ?, artifacts = ?, finished_at = ?
      WHERE project_id = ? AND project_version_id = ? AND run_id = ? AND finished_at IS NULL`,
  ).run(
    outcome,
    JSON.stringify([...artifacts]),
    finishedAt,
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    runId,
  ).changes;
  if (changed !== 1) throw new Error(`PROBE_RUN_NOT_RUNNING:${runId}`);
  const row = db.prepare<[string, string, string], ProbeRunRow>(
    `SELECT run_id, script_path, devices, hypothesis, outcome, artifacts, started_at, finished_at
       FROM probe_run WHERE project_id = ? AND project_version_id = ? AND run_id = ?`,
  ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), runId);
  if (!row || row.outcome === null) throw new Error(`PROBE_RUN_NOT_FOUND:${runId}`);
  return {
    runId: row.run_id,
    scriptPath: row.script_path,
    deviceIds: parseStringArray(row.devices),
    hypothesis: row.hypothesis ?? "",
    outcome: row.outcome,
    artifacts: parseStringArray(row.artifacts ?? "[]"),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function parseStringArray(json: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return []; }
  return Array.isArray(parsed) && parsed.every((value) => typeof value === "string") ? parsed : [];
}

interface DevelopmentRunsInput extends ProbeRunScope {
  pageSize: number;
  cursor: string | null;
  kinds?: readonly ("build" | "flash" | "probe")[];
  statuses?: readonly ("queued" | "running" | "succeeded" | "failed" | "cancelled")[];
}

interface DevelopmentRunRow {
  project_id: string;
  project_version_id: string;
  run_id: string;
  kind: "build" | "flash" | "probe";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  target: string | null;
  artifact: string | null;
  digest: string | null;
  started_at: string;
  finished_at: string | null;
}

interface RunCursor { startedAt: string; runId: string; kind: DevelopmentRunRow["kind"] }

function decodeCursor(value: string | null): RunCursor | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const startedAt = Reflect.get(parsed, "startedAt");
      const runId = Reflect.get(parsed, "runId");
      const kind = Reflect.get(parsed, "kind");
      if (typeof startedAt === "string" && typeof runId === "string" &&
        (kind === "build" || kind === "flash" || kind === "probe")) return { startedAt, runId, kind };
    }
  } catch { /* stable error below */ }
  throw new Error("INVALID_BENCH_RUN_CURSOR");
}

function encodeCursor(value: RunCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function listBenchDevelopmentRuns(db: Database.Database, input: DevelopmentRunsInput) {
  const cursor = decodeCursor(input.cursor);
  const kinds = [...(input.kinds ?? ["build", "flash", "probe"])] as DevelopmentRunRow["kind"][];
  const statuses = [...(input.statuses ?? ["queued", "running", "succeeded", "failed", "cancelled"])] as DevelopmentRunRow["status"][];
  if (kinds.length === 0 || statuses.length === 0) return { items: [], total: 0, cursor: null };
  const scope = [input.projectId, toStorageProjectVersionId(input.projectVersionId)];
  const union = `WITH development_runs AS (
    SELECT project_id, project_version_id, run_id, kind,
           CASE WHEN status IN ('queued','running','succeeded','failed','cancelled') THEN status ELSE 'failed' END AS status,
           target, artifact, digest, started_at, NULL AS finished_at
      FROM build_run
    UNION ALL
    SELECT project_id, project_version_id, run_id, 'probe' AS kind,
           CASE WHEN finished_at IS NULL THEN 'running' ELSE 'succeeded' END AS status,
           hypothesis AS target,
           json_extract(COALESCE(artifacts, '[]'), '$[0]') AS artifact,
           NULL AS digest, started_at, finished_at
      FROM probe_run
  )`;
  const where = [
    "project_id = ?",
    "project_version_id = ?",
    `kind IN (${kinds.map(() => "?").join(",")})`,
    `status IN (${statuses.map(() => "?").join(",")})`,
  ];
  const params: Array<string | number> = [...scope, ...kinds, ...statuses];
  if (cursor) {
    where.push("(started_at < ? OR (started_at = ? AND (kind > ? OR (kind = ? AND run_id < ?))))");
    params.push(cursor.startedAt, cursor.startedAt, cursor.kind, cursor.kind, cursor.runId);
  }
  const rows = db.prepare<(string | number)[], DevelopmentRunRow>(
    `${union} SELECT * FROM development_runs WHERE ${where.join(" AND ")}
      ORDER BY started_at DESC, kind, run_id DESC LIMIT ?`,
  ).all(...params, input.pageSize + 1);
  const count = db.prepare<(string | number)[], { count: number }>(
    `${union} SELECT count(*) AS count FROM development_runs WHERE ${where.slice(0, 4).join(" AND ")}`,
  ).get(...scope, ...kinds, ...statuses)?.count ?? 0;
  const visible = rows.slice(0, input.pageSize);
  const last = visible.at(-1);
  return {
    items: visible.map((row) => ({
      projectId: row.project_id,
      projectVersionId: input.projectVersionId,
      runId: row.run_id,
      kind: row.kind,
      status: row.status,
      target: row.target,
      artifact: row.artifact,
      digest: row.digest,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    })),
    total: count,
    cursor: rows.length > input.pageSize && last
      ? encodeCursor({ startedAt: last.started_at, runId: last.run_id, kind: last.kind })
      : null,
  };
}
