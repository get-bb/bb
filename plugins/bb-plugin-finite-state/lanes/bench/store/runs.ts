import type Database from "better-sqlite3";
import {
  fromStorageProjectVersionId,
  toStorageProjectVersionId,
} from "../../../lib/store/index.js";
import { matrixTierForBenchTier } from "./mappers.js";
import type {
  BenchCacheState,
  BenchRunDetail,
  BenchRunLookup,
  BenchRunQuery,
  BenchRunRecord,
  BenchRunRow,
  BenchRunSummary,
  Page,
  StoredRunLocation,
} from "./types.js";

const FRESH_FOR_MS = 5 * 60 * 1_000;
const SHA256 = /^[a-f0-9]{64}$/u;
export const BENCH_EVIDENCE_ENTITY_KIND = "verificationRun" as const;

interface AcceptedGenerationRow {
  generation_id: string;
  base_revision: number;
}

interface CacheRow {
  synced_at: string | null;
}

interface CountRow {
  count: number;
}

interface RunCursor {
  at: string;
  runId: string;
}

function encodeCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): RunCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid bench run continuation");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("at" in parsed) ||
    !("runId" in parsed) ||
    typeof parsed.at !== "string" ||
    typeof parsed.runId !== "string"
  ) {
    throw new Error("Invalid bench run continuation");
  }
  return { at: parsed.at, runId: parsed.runId };
}

function validateRun(run: BenchRunRecord): void {
  if (!run.runId || !run.projectId)
    throw new Error("Bench run identifiers must be non-empty");
  if (run.pvId === "")
    throw new Error("Bench run pvId must be non-empty or null");
  if (run.matrixTier !== matrixTierForBenchTier(run.tier)) {
    throw new Error(
      `Bench tier ${run.tier} must use matrix tier ${matrixTierForBenchTier(run.tier)}`,
    );
  }
  if (run.firmwareDigest !== null && !SHA256.test(run.firmwareDigest)) {
    throw new Error(
      "Bench run firmwareDigest must be a lowercase sha256 digest",
    );
  }
  if (run.kind !== undefined && !run.kind)
    throw new Error("Bench run kind must be non-empty");
  if (
    run.durationMs !== undefined &&
    run.durationMs !== null &&
    (!Number.isSafeInteger(run.durationMs) || run.durationMs < 0)
  ) {
    throw new Error("Bench run durationMs must be a non-negative safe integer");
  }
  if (
    run.logLocator !== undefined &&
    run.logLocator !== null &&
    (run.logLocator.startsWith("/") ||
      /^[A-Za-z]:/u.test(run.logLocator) ||
      run.logLocator.includes("\\") ||
      run.logLocator.split("/").some((segment) => segment === ".."))
  ) {
    throw new Error("Bench run logLocator must be a safe logical locator");
  }
}

export function serializeBenchRaw(raw: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    throw new Error("Bench raw payload must be JSON-serializable");
  }
  if (serialized === undefined)
    throw new Error("Bench raw payload must be JSON-serializable");
  return serialized;
}

export function getAcceptedBenchGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
): AcceptedGenerationRow {
  const accepted = findAcceptedBenchGeneration(db, projectId, projectVersionId);
  if (!accepted) {
    throw new Error(
      "Bench evidence requires an accepted verificationRun generation",
    );
  }
  return accepted;
}

function findAcceptedBenchGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
): AcceptedGenerationRow | undefined {
  return db
    .prepare<[string, string, string], AcceptedGenerationRow>(
      `SELECT s.accepted_generation_id AS generation_id, s.base_revision
       FROM sync_state s
       JOIN pull_generation g
         ON g.project_id = s.project_id
        AND g.project_version_id = s.project_version_id
        AND g.generation_id = s.accepted_generation_id
       WHERE s.project_id = ? AND s.project_version_id = ?
         AND s.entity_kind = ? AND s.accepted_generation_id IS NOT NULL
         AND g.status = 'accepted'`,
    )
    .get(projectId, projectVersionId, BENCH_EVIDENCE_ENTITY_KIND);
}

function findAcceptedRequirementGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
): AcceptedGenerationRow | undefined {
  return db
    .prepare<[string, string], AcceptedGenerationRow>(
      `SELECT s.accepted_generation_id AS generation_id, s.base_revision
       FROM sync_state s
       JOIN pull_generation g
         ON g.project_id = s.project_id
        AND g.project_version_id = s.project_version_id
        AND g.generation_id = s.accepted_generation_id
       WHERE s.project_id = ? AND s.project_version_id = ?
         AND s.entity_kind = 'requirement'
         AND s.accepted_generation_id IS NOT NULL
         AND g.status = 'accepted'`,
    )
    .get(projectId, projectVersionId);
}

/**
 * Opens the local bench evidence generation for a requirement-pulled version.
 * Remote requirement source remains in its own accepted generation; locally
 * produced verification evidence gets an independent durable publication
 * fence before the first attempt id is minted.
 */
export function ensureAcceptedBenchGeneration(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  createGenerationId: () => string,
  now = new Date().toISOString(),
): AcceptedGenerationRow {
  const existing = findAcceptedBenchGeneration(db, projectId, projectVersionId);
  if (existing) return existing;

  const create = db.transaction(() => {
    const concurrent = findAcceptedBenchGeneration(
      db,
      projectId,
      projectVersionId,
    );
    if (concurrent) return concurrent;

    const requirement = findAcceptedRequirementGeneration(
      db,
      projectId,
      projectVersionId,
    );
    if (!requirement) {
      throw new Error(
        "Bench evidence requires an accepted verificationRun generation; pull requirement through Sync first",
      );
    }

    const generationId = `bench-evidence-${createGenerationId()}`;
    db.prepare(
      `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES (?, ?, ?, 'accepted',
               '{"source":"local_bench_evidence","kinds":["verificationRun"]}',
               ?, ?, ?)`,
    ).run(projectId, projectVersionId, generationId, now, now, now);
    db.prepare(
      `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull, error)
       VALUES (?, ?, 'verificationRun', ?, 1, ?, NULL)
       ON CONFLICT (project_id, project_version_id, entity_kind) DO UPDATE SET
         accepted_generation_id = excluded.accepted_generation_id,
         base_revision = sync_state.base_revision + 1,
         last_pull = excluded.last_pull,
         error = NULL`,
    ).run(projectId, projectVersionId, generationId, now);
    return getAcceptedBenchGeneration(db, projectId, projectVersionId);
  });
  return create.immediate();
}

export function resolveRunLocation(
  db: Database.Database,
  run: BenchRunRecord,
): StoredRunLocation {
  validateRun(run);
  const projectVersionId = toStorageProjectVersionId(run.pvId);
  const accepted = getAcceptedBenchGeneration(
    db,
    run.projectId,
    projectVersionId,
  );
  const historicalRows = db
    .prepare<[string, string, string], BenchRunRow>(
      `SELECT * FROM verification_runs
       WHERE project_id = ? AND project_version_id = ? AND run_id = ?
       ORDER BY generation_id`,
    )
    .all(run.projectId, projectVersionId, run.runId);
  for (const historical of historicalRows) {
    if (
      historical.firmware_digest !== null &&
      run.firmwareDigest !== null &&
      historical.firmware_digest !== run.firmwareDigest
    ) {
      throw new Error(`Bench run ${run.runId} firmware digest is immutable`);
    }
  }
  const existing =
    db
      .prepare<[string, string, string, string], BenchRunRow>(
        `SELECT * FROM verification_runs
       WHERE project_id = ? AND project_version_id = ?
         AND generation_id = ? AND run_id = ?`,
      )
      .get(
        run.projectId,
        projectVersionId,
        accepted.generation_id,
        run.runId,
      ) ?? null;
  return {
    projectId: run.projectId,
    projectVersionId,
    generationId: accepted.generation_id,
    row: existing,
  };
}

export function upsertBenchRun(
  db: Database.Database,
  location: StoredRunLocation,
  run: BenchRunRecord,
  syncedAt: string,
): number {
  validateRun(run);
  const raw = serializeBenchRaw(run.raw);
  const firmwareDigest =
    run.firmwareDigest ?? location.row?.firmware_digest ?? null;
  const terminalStatuses = new Set(["completed", "failed", "timeout"]);
  const existingStatus = location.row?.status;
  const status =
    existingStatus && terminalStatuses.has(existingStatus)
      ? existingStatus
      : existingStatus === "running" && run.status === "queued"
        ? existingStatus
        : run.status;
  const kind = run.kind ?? location.row?.kind ?? "bench";
  const trigger =
    run.trigger === undefined ? (location.row?.trigger ?? null) : run.trigger;
  const hostId =
    run.hostId === undefined ? (location.row?.host_id ?? null) : run.hostId;
  const threadId =
    run.threadId === undefined
      ? (location.row?.thread_id ?? null)
      : run.threadId;
  const config =
    run.config === undefined
      ? (location.row?.config ?? null)
      : run.config === null
        ? null
        : serializeBenchRaw(run.config);
  const durationMs =
    run.durationMs === undefined
      ? (location.row?.duration_ms ?? null)
      : run.durationMs;
  const logLocator =
    run.logLocator === undefined
      ? (location.row?.log_locator ?? null)
      : run.logLocator;
  const logCursor =
    run.logCursor === undefined
      ? (location.row?.log_cursor ?? null)
      : run.logCursor;
  const result = db
    .prepare(
      `INSERT INTO verification_runs
         (project_id, project_version_id, generation_id, run_id, tier, matrix_col,
          kind, trigger, host_id, thread_id, target, config, status, started_at,
          finished_at, duration_ms, firmware_digest, job_id, log_locator,
          log_cursor, raw, synced_at)
       VALUES
         (@projectId, @projectVersionId, @generationId, @runId, @tier, @matrixTier,
          @kind, @trigger, @hostId, @threadId, @target, @config, @status, @startedAt,
          @finishedAt, @durationMs, @firmwareDigest, @jobId, @logLocator,
          @logCursor, @raw, @syncedAt)
       ON CONFLICT (project_id, project_version_id, generation_id, run_id) DO UPDATE SET
         tier = excluded.tier,
         matrix_col = excluded.matrix_col,
         kind = excluded.kind,
         trigger = excluded.trigger,
         host_id = excluded.host_id,
         thread_id = excluded.thread_id,
         target = excluded.target,
         config = excluded.config,
         status = excluded.status,
         started_at = COALESCE(verification_runs.started_at, excluded.started_at),
         finished_at = COALESCE(excluded.finished_at, verification_runs.finished_at),
         duration_ms = COALESCE(excluded.duration_ms, verification_runs.duration_ms),
         firmware_digest = COALESCE(verification_runs.firmware_digest, excluded.firmware_digest),
         job_id = COALESCE(excluded.job_id, verification_runs.job_id),
         log_locator = COALESCE(excluded.log_locator, verification_runs.log_locator),
         log_cursor = COALESCE(excluded.log_cursor, verification_runs.log_cursor),
         raw = excluded.raw,
         synced_at = excluded.synced_at
       WHERE verification_runs.tier IS NOT excluded.tier
          OR verification_runs.matrix_col IS NOT excluded.matrix_col
          OR verification_runs.kind IS NOT excluded.kind
          OR verification_runs.trigger IS NOT excluded.trigger
          OR verification_runs.host_id IS NOT excluded.host_id
          OR verification_runs.thread_id IS NOT excluded.thread_id
          OR verification_runs.target IS NOT excluded.target
          OR verification_runs.config IS NOT excluded.config
          OR verification_runs.status IS NOT excluded.status
          OR verification_runs.started_at IS NOT COALESCE(verification_runs.started_at, excluded.started_at)
          OR verification_runs.finished_at IS NOT COALESCE(excluded.finished_at, verification_runs.finished_at)
          OR verification_runs.duration_ms IS NOT COALESCE(excluded.duration_ms, verification_runs.duration_ms)
          OR verification_runs.firmware_digest IS NOT COALESCE(verification_runs.firmware_digest, excluded.firmware_digest)
          OR verification_runs.job_id IS NOT COALESCE(excluded.job_id, verification_runs.job_id)
          OR verification_runs.log_locator IS NOT COALESCE(excluded.log_locator, verification_runs.log_locator)
          OR verification_runs.log_cursor IS NOT COALESCE(excluded.log_cursor, verification_runs.log_cursor)
          OR verification_runs.raw IS NOT excluded.raw`,
    )
    .run({
      projectId: location.projectId,
      projectVersionId: location.projectVersionId,
      generationId: location.generationId,
      runId: run.runId,
      tier: run.tier,
      matrixTier: run.matrixTier,
      kind,
      trigger,
      hostId,
      threadId,
      target: run.target,
      config,
      status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs,
      firmwareDigest,
      jobId: run.jobId,
      logLocator,
      logCursor,
      raw,
      syncedAt,
    });
  return result.changes;
}

function summarizeRun(row: BenchRunRow): BenchRunSummary {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    pvId: fromStorageProjectVersionId(row.project_version_id),
    tier: row.tier,
    matrixTier: row.matrix_col,
    status: row.status,
    target: row.target,
    firmwareDigest: row.firmware_digest,
    jobId: row.job_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    syncedAt: row.synced_at,
  };
}

export function getBenchCacheState(
  db: Database.Database,
  projectId: string,
  pvId: string | null,
  now = new Date().toISOString(),
): BenchCacheState {
  const projectVersionId = toStorageProjectVersionId(pvId);
  const accepted = findAcceptedBenchGeneration(db, projectId, projectVersionId);
  if (!accepted) {
    const requirement = findAcceptedRequirementGeneration(
      db,
      projectId,
      projectVersionId,
    );
    if (requirement) {
      return {
        state: "empty",
        asOf: null,
        message:
          "No bench runs exist yet. Start the first run for this cached requirement version.",
        acceptedGenerationId: null,
        baseRevision: requirement.base_revision,
      };
    }
    throw new Error(
      "Bench evidence requires an accepted verificationRun generation",
    );
  }
  const row = db
    .prepare<[string, string, string], CacheRow>(
      `SELECT MAX(r.synced_at) AS synced_at
       FROM verification_runs r
       WHERE r.project_id = ? AND r.project_version_id = ? AND r.generation_id = ?`,
    )
    .get(projectId, projectVersionId, accepted.generation_id);
  const asOf = row?.synced_at ?? null;
  if (asOf === null) {
    return {
      state: "empty",
      asOf: null,
      message: "No bench evidence is cached for this scope.",
      acceptedGenerationId: accepted.generation_id,
      baseRevision: accepted.base_revision,
    };
  }
  const age = Date.parse(now) - Date.parse(asOf);
  const fresh = Number.isFinite(age) && age >= 0 && age <= FRESH_FOR_MS;
  return {
    state: fresh ? "fresh" : "stale",
    asOf,
    message: fresh
      ? null
      : "Bench evidence is older than the freshness window.",
    acceptedGenerationId: accepted.generation_id,
    baseRevision: accepted.base_revision,
  };
}

export function listBenchRuns(
  db: Database.Database,
  query: BenchRunQuery,
): Page<BenchRunSummary> {
  if (
    !Number.isInteger(query.pageSize) ||
    query.pageSize < 1 ||
    query.pageSize > 200
  ) {
    throw new Error("Bench run pageSize must be between 1 and 200");
  }
  const projectVersionId = toStorageProjectVersionId(query.pvId);
  const accepted = findAcceptedBenchGeneration(
    db,
    query.projectId,
    projectVersionId,
  );
  if (!accepted) {
    return {
      items: [],
      total: 0,
      next: null,
      cache: getBenchCacheState(db, query.projectId, query.pvId, query.now),
    };
  }
  const cursor =
    query.continuation === null ? null : decodeCursor(query.continuation);
  const rows = cursor
    ? db
        .prepare<
          [string, string, string, string, string, string, number],
          BenchRunRow
        >(
          `SELECT * FROM verification_runs
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
             AND (COALESCE(started_at, synced_at) < ?
               OR (COALESCE(started_at, synced_at) = ? AND run_id < ?))
           ORDER BY COALESCE(started_at, synced_at) DESC, run_id DESC
           LIMIT ?`,
        )
        .all(
          query.projectId,
          projectVersionId,
          accepted.generation_id,
          cursor.at,
          cursor.at,
          cursor.runId,
          query.pageSize + 1,
        )
    : db
        .prepare<[string, string, string, number], BenchRunRow>(
          `SELECT * FROM verification_runs
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
           ORDER BY COALESCE(started_at, synced_at) DESC, run_id DESC
           LIMIT ?`,
        )
        .all(
          query.projectId,
          projectVersionId,
          accepted.generation_id,
          query.pageSize + 1,
        );
  const hasMore = rows.length > query.pageSize;
  const visible = rows.slice(0, query.pageSize);
  const last = visible.at(-1);
  const count =
    db
      .prepare<[string, string, string], CountRow>(
        `SELECT COUNT(*) AS count FROM verification_runs
       WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`,
      )
      .get(query.projectId, projectVersionId, accepted.generation_id)?.count ??
    0;
  return {
    items: visible.map(summarizeRun),
    total: count,
    next:
      hasMore && last
        ? encodeCursor({
            at: last.started_at ?? last.synced_at,
            runId: last.run_id,
          })
        : null,
    cache: getBenchCacheState(db, query.projectId, query.pvId, query.now),
  };
}

function getScopedBenchRun(
  db: Database.Database,
  lookup: BenchRunLookup,
): BenchRunDetail | null {
  const projectVersionId = toStorageProjectVersionId(lookup.pvId);
  const accepted = getAcceptedBenchGeneration(
    db,
    lookup.projectId,
    projectVersionId,
  );
  const row = db
    .prepare<[string, string, string, string], BenchRunRow>(
      `SELECT * FROM verification_runs
       WHERE project_id = ? AND project_version_id = ?
         AND generation_id = ? AND run_id = ?`,
    )
    .get(
      lookup.projectId,
      projectVersionId,
      accepted.generation_id,
      lookup.runId,
    );
  return row
    ? {
        run: summarizeRun(row),
        cache: getBenchCacheState(
          db,
          lookup.projectId,
          lookup.pvId,
          lookup.now,
        ),
      }
    : null;
}

export function getBenchRun(
  db: Database.Database,
  runId: string,
): BenchRunDetail | null;
export function getBenchRun(
  db: Database.Database,
  lookup: BenchRunLookup,
): BenchRunDetail | null;
export function getBenchRun(
  db: Database.Database,
  runIdOrLookup: string | BenchRunLookup,
): BenchRunDetail | null {
  if (typeof runIdOrLookup !== "string")
    return getScopedBenchRun(db, runIdOrLookup);
  const rows = db
    .prepare<[string, string], BenchRunRow>(
      `SELECT r.* FROM verification_runs r
       JOIN sync_state s
         ON s.project_id = r.project_id
        AND s.project_version_id = r.project_version_id
        AND s.accepted_generation_id = r.generation_id
        AND s.entity_kind = ?
       JOIN pull_generation g
         ON g.project_id = r.project_id
        AND g.project_version_id = r.project_version_id
        AND g.generation_id = r.generation_id
        AND g.status = 'accepted'
       WHERE r.run_id = ?
       ORDER BY r.synced_at DESC LIMIT 2`,
    )
    .all(BENCH_EVIDENCE_ENTITY_KIND, runIdOrLookup);
  if (rows.length > 1)
    throw new Error(`Bench run ${runIdOrLookup} is ambiguous without scope`);
  const row = rows[0];
  if (!row) return null;
  const pvId = fromStorageProjectVersionId(row.project_version_id);
  return {
    run: summarizeRun(row),
    cache: getBenchCacheState(db, row.project_id, pvId),
  };
}
