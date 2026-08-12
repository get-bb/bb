import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { VerificationCheckRow } from "../../../lib/store/index.js";
import { resultStatusForOutcome } from "./mappers.js";
import {
  getBenchCacheState,
  resolveRunLocation,
  serializeBenchRaw,
  upsertBenchRun,
} from "./runs.js";
import { upsertBenchArtifacts } from "./artifacts.js";
import { upsertBenchAttestation } from "./attestations.js";
import type {
  BenchEvidenceBundle,
  BenchPageQuery,
  BenchResultInput,
  BenchResultOutcome,
  BenchResultRow,
  BenchResultSummary,
  Page,
  StoredRunLocation,
} from "./types.js";

interface MappingRow {
  requirement_key: string;
}

interface CountRow {
  count: number;
}

interface IdCursor {
  id: string;
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}-${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function decodeCursor(value: string): IdCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid bench result continuation");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("id" in parsed) ||
    typeof parsed.id !== "string"
  ) {
    throw new Error("Invalid bench result continuation");
  }
  return { id: parsed.id };
}

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ id }), "utf8").toString("base64url");
}

function validateResult(result: BenchResultInput): void {
  if (!result.requirementId || !result.checkId) {
    throw new Error("Bench result requirementId and checkId must be non-empty");
  }
  if (result.evidenceSummary !== null && result.evidenceSummary.length > 20_000) {
    throw new Error("Bench result evidenceSummary is too large");
  }
  resultStatusForOutcome(result.outcome);
}

function upsertBenchResults(
  db: Database.Database,
  location: StoredRunLocation,
  bundle: BenchEvidenceBundle,
  pulledAt: string,
): number {
  let changes = 0;
  for (const result of bundle.results) {
    validateResult(result);
    const knownCheck = db
      .prepare<[string, string, string, string], VerificationCheckRow>(
        `SELECT * FROM verification_checks
         WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND check_id = ?`,
      )
      .get(
        location.projectId,
        location.projectVersionId,
        location.generationId,
        result.checkId,
      );
    const mapping = knownCheck
      ? db
          .prepare<[string, string, string, string, string], MappingRow>(
            `SELECT requirement_key FROM requirement_check_mappings
             WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
               AND requirement_key = ? AND check_id = ? AND suppressed = 0`,
          )
          .get(
            location.projectId,
            location.projectVersionId,
            location.generationId,
            result.requirementId,
            result.checkId,
          )
      : undefined;
    const mapped = mapping !== undefined;
    const resultId = stableId("bench-result", [
      bundle.run.runId,
      result.requirementId,
      result.checkId,
    ]);
    const existingResult = db
      .prepare<[string, string, string, string], BenchResultRow>(
        `SELECT * FROM verification_results
         WHERE project_id = ? AND project_version_id = ?
           AND generation_id = ? AND result_id = ?`,
      )
      .get(
        location.projectId,
        location.projectVersionId,
        location.generationId,
        resultId,
      );
    if (mapped && !existingResult) {
      const superseded = db
        .prepare(
          `UPDATE verification_results
           SET is_latest = 0, superseded_by = @resultId
           WHERE project_id = @projectId
             AND project_version_id = @projectVersionId
             AND generation_id = @generationId
             AND requirement_key = @requirementKey
             AND check_id = @checkId
             AND is_latest = 1
             AND result_id <> @resultId`,
        )
        .run({
          projectId: location.projectId,
          projectVersionId: location.projectVersionId,
          generationId: location.generationId,
          requirementKey: result.requirementId,
          checkId: result.checkId,
          resultId,
        });
      changes += superseded.changes;
    }
    const raw = serializeBenchRaw({
      reportedRequirementId: result.requirementId,
      reportedCheckId: result.checkId,
      outcome: result.outcome,
      mappingState: mapped ? "mapped" : "unmapped",
    });
    const write = db
      .prepare(
        `INSERT INTO verification_results
           (project_id, project_version_id, generation_id, result_id, run_id,
            requirement_key, check_id, tier, status, outcome, confidence,
            evidence_summary, result_data, measured, executed_at, executed_by,
            failure_reason, remediation_suggestion, fs_version_id,
            fs_version_name, is_latest, superseded_by, sla_status,
            mapping_state, raw, pulled_at)
         VALUES
           (@projectId, @projectVersionId, @generationId, @resultId, @runId,
            @requirementKey, @checkId, @tier, @status, @outcome, NULL,
            @evidenceSummary, NULL, NULL, @executedAt, NULL, NULL, NULL, NULL,
            NULL, @isLatest, NULL, NULL, @mappingState, @raw, @pulledAt)
         ON CONFLICT (project_id, project_version_id, generation_id, result_id) DO UPDATE SET
           requirement_key = excluded.requirement_key,
           check_id = excluded.check_id,
           tier = excluded.tier,
           status = excluded.status,
           outcome = excluded.outcome,
           evidence_summary = excluded.evidence_summary,
           executed_at = excluded.executed_at,
           mapping_state = excluded.mapping_state,
           raw = excluded.raw,
           pulled_at = excluded.pulled_at
         WHERE verification_results.requirement_key IS NOT excluded.requirement_key
            OR verification_results.check_id IS NOT excluded.check_id
            OR verification_results.tier IS NOT excluded.tier
            OR verification_results.status IS NOT excluded.status
            OR verification_results.outcome IS NOT excluded.outcome
            OR verification_results.evidence_summary IS NOT excluded.evidence_summary
            OR verification_results.executed_at IS NOT excluded.executed_at
            OR verification_results.mapping_state IS NOT excluded.mapping_state
            OR verification_results.raw IS NOT excluded.raw`,
      )
      .run({
        projectId: location.projectId,
        projectVersionId: location.projectVersionId,
        generationId: location.generationId,
        resultId,
        runId: bundle.run.runId,
        requirementKey: mapped ? result.requirementId : null,
        checkId: knownCheck ? result.checkId : null,
        tier: bundle.run.matrixTier,
        status: resultStatusForOutcome(result.outcome),
        outcome: result.outcome,
        evidenceSummary: result.evidenceSummary,
        executedAt: bundle.run.finishedAt ?? bundle.run.startedAt,
        mappingState: mapped ? "mapped" : "unmapped",
        isLatest: mapped ? 1 : 0,
        raw,
        pulledAt,
      });
    changes += write.changes;
  }
  return changes;
}

export function storeEvidenceCheckpointWithResult(
  db: Database.Database,
  bundle: BenchEvidenceBundle,
  now = new Date().toISOString(),
): { changed: boolean; runId: string; status: BenchEvidenceBundle["run"]["status"] } {
  const checkpoint = db.transaction(() => {
    const location = resolveRunLocation(db, bundle.run);
    let changes = upsertBenchRun(db, location, bundle.run, now);
    changes += upsertBenchResults(db, location, bundle, now);
    changes += upsertBenchArtifacts(db, location, bundle, now);
    changes += upsertBenchAttestation(db, location, bundle, now);
    const status = db
      .prepare<[string, string, string, string], { status: BenchEvidenceBundle["run"]["status"] }>(
        `SELECT status FROM verification_runs
         WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?`,
      )
      .get(location.projectId, location.projectVersionId, location.generationId, bundle.run.runId)
      ?.status;
    if (!status) throw new Error(`Bench run ${bundle.run.runId} was not stored`);
    return { changes, status };
  });
  const result = checkpoint();
  return { changed: result.changes > 0, runId: bundle.run.runId, status: result.status };
}

export function storeEvidenceCheckpoint(
  db: Database.Database,
  bundle: BenchEvidenceBundle,
): void {
  storeEvidenceCheckpointWithResult(db, bundle);
}

function parseReportedIds(raw: string): {
  reportedRequirementId: string;
  reportedCheckId: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reportedRequirementId: "unknown", reportedCheckId: "unknown" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { reportedRequirementId: "unknown", reportedCheckId: "unknown" };
  }
  const requirement =
    "reportedRequirementId" in parsed && typeof parsed.reportedRequirementId === "string"
      ? parsed.reportedRequirementId
      : "unknown";
  const check =
    "reportedCheckId" in parsed && typeof parsed.reportedCheckId === "string"
      ? parsed.reportedCheckId
      : "unknown";
  return { reportedRequirementId: requirement, reportedCheckId: check };
}

function normalizeOutcome(value: string | null): BenchResultOutcome {
  switch (value) {
    case "pass":
    case "fail":
    case "error":
    case "skipped":
      return value;
    default:
      throw new Error(`Stored bench result has invalid outcome: ${String(value)}`);
  }
}

function summarize(row: BenchResultRow): BenchResultSummary {
  const reported = parseReportedIds(row.raw);
  return {
    resultId: row.result_id,
    requirementId: row.requirement_key,
    checkId: row.check_id,
    reportedRequirementId: reported.reportedRequirementId,
    reportedCheckId: reported.reportedCheckId,
    mapped: row.mapping_state === "mapped",
    outcome: normalizeOutcome(row.outcome),
    evidenceSummary: row.evidence_summary,
    pulledAt: row.pulled_at,
  };
}

export function listBenchResults(
  db: Database.Database,
  query: BenchPageQuery,
): Page<BenchResultSummary> {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 200) {
    throw new Error("Bench result pageSize must be between 1 and 200");
  }
  const location = resolveRunLocation(db, {
    runId: query.runId,
    projectId: query.projectId,
    pvId: query.pvId,
    tier: "tier0",
    matrixTier: "static",
    target: null,
    status: "queued",
    firmwareDigest: null,
    jobId: null,
    startedAt: null,
    finishedAt: null,
    raw: {},
  });
  const cursor = query.continuation === null ? null : decodeCursor(query.continuation);
  const rows = cursor
    ? db
        .prepare<[string, string, string, string, string, number], BenchResultRow>(
          `SELECT * FROM verification_results
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
             AND run_id = ? AND result_id > ?
           ORDER BY result_id ASC LIMIT ?`,
        )
        .all(
          location.projectId,
          location.projectVersionId,
          location.generationId,
          query.runId,
          cursor.id,
          query.pageSize + 1,
        )
    : db
        .prepare<[string, string, string, string, number], BenchResultRow>(
          `SELECT * FROM verification_results
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?
           ORDER BY result_id ASC LIMIT ?`,
        )
        .all(
          location.projectId,
          location.projectVersionId,
          location.generationId,
          query.runId,
          query.pageSize + 1,
        );
  const visible = rows.slice(0, query.pageSize);
  const count = db
    .prepare<[string, string, string, string], CountRow>(
      `SELECT COUNT(*) AS count FROM verification_results
       WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?`,
    )
    .get(location.projectId, location.projectVersionId, location.generationId, query.runId)
    ?.count ?? 0;
  return {
    items: visible.map(summarize),
    total: count,
    next:
      rows.length > query.pageSize && visible.at(-1)
        ? encodeCursor(visible.at(-1)!.result_id)
        : null,
    cache: getBenchCacheState(db, query.projectId, query.pvId, query.now),
  };
}
