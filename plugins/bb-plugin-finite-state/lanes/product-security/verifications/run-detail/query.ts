import type Database from "better-sqlite3";
import { fromStorageProjectVersionId, PROJECT_LEVEL_VERSION_ID, toStorageProjectVersionId } from "../../../../lib/store/index.js";
import type { JsonValue } from "../../../../shared/contract.js";
import type { VerificationTier } from "../matrix/status.js";

export interface RunDetailScope {
  projectId: string;
  projectVersionId: string | null;
  requirementId: string;
  tier: VerificationTier;
}

export interface DetailPageInput extends RunDetailScope {
  pageSize: number;
  continuation: string | null;
}

interface ScopeRow { project_version_id: string; accepted_generation_id: string; base_revision: number; last_pull: string | null; error: string | null }
interface CountRow { count: number }
interface ResultRow {
  result_id: string; run_id: string | null; check_id: string | null; status: string;
  outcome: string | null; confidence: string | null; evidence_summary: string | null;
  executed_at: string | null; executed_by: string | null; failure_reason: string | null;
  remediation_suggestion: string | null; fs_version_id: string | null; fs_version_name: string | null;
  is_latest: number; superseded_by: string | null; mapping_state: string;
}
interface CheckRow {
  check_id: string; code: string; name: string; check_type: string; category: string | null;
  description: string | null; pass_criteria: string | null; fail_criteria: string | null;
  input_description: string | null; is_required: number; coverage_level: string | null; suppressed: number;
}
interface RunRow {
  run_id: string; status: string; firmware_digest: string | null; job_id: string | null;
  started_at: string | null; finished_at: string | null; target: string | null; log_locator: string | null;
}
interface ArtifactRow { artifact_id: string; run_id: string; name: string; kind: string; media_type: string | null; sha256: string | null; bytes: number | null; created_at: string | null }
interface AttestationRow {
  attestation_id: string; run_id: string; subject_digest: string; evidence_digest: string | null;
  signer_identity: string | null; payload: string; signature_verified: number; subject_matches_run: number;
  verified: number; created_at: string;
}

function acceptedScope(db: Database.Database, scope: RunDetailScope): ScopeRow | null {
  if (scope.projectVersionId !== null) {
    return db.prepare<[string, string], ScopeRow>(
      `SELECT project_version_id, accepted_generation_id, base_revision, last_pull, error
         FROM sync_state WHERE project_id = ? AND project_version_id = ?
          AND entity_kind = 'requirement' AND accepted_generation_id IS NOT NULL`,
    ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId)) ?? null;
  }
  return db.prepare<[string, string], ScopeRow>(
    `SELECT project_version_id, accepted_generation_id, base_revision, last_pull, error
       FROM sync_state WHERE project_id = ? AND project_version_id <> ?
        AND entity_kind = 'requirement' AND accepted_generation_id IS NOT NULL
       ORDER BY last_pull DESC, project_version_id DESC LIMIT 1`,
  ).get(scope.projectId, PROJECT_LEVEL_VERSION_ID) ?? null;
}

function cache(row: ScopeRow | null) {
  if (!row) return { state: "empty" as const, asOf: null, message: "No accepted verification evidence is available.", acceptedGenerationId: null, baseRevision: 0 };
  return {
    state: row.error ? "stale" as const : "fresh" as const,
    asOf: row.last_pull,
    message: row.error ? "The latest refresh failed; showing the last accepted verification evidence." : null,
    acceptedGenerationId: row.accepted_generation_id,
    baseRevision: row.base_revision,
  };
}

function decodeCursor(value: string | null): { at: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("shape");
    const at = Reflect.get(parsed, "at");
    const id = Reflect.get(parsed, "id");
    if (typeof at !== "string" || typeof id !== "string") throw new Error("shape");
    return { at, id };
  } catch { throw new Error("Verification history continuation token is invalid"); }
}

function encodeCursor(row: ResultRow): string {
  return Buffer.from(JSON.stringify({ at: row.executed_at ?? "", id: row.result_id }), "utf8").toString("base64url");
}

function signature(payload: string): string {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      for (const key of ["signature", "sig", "rekor_signature"]) {
        const value = Reflect.get(parsed, key);
        if (typeof value === "string") return value;
      }
    }
  } catch { /* malformed cached envelopes remain visibly unverified */ }
  return "unavailable";
}

function resultFields(row: ResultRow): Record<string, JsonValue> {
  return {
    id: row.result_id, runId: row.run_id, checkId: row.check_id, status: row.status,
    outcome: row.outcome, confidence: row.confidence, evidenceSummary: row.evidence_summary,
    executedAt: row.executed_at, executedBy: row.executed_by, failureReason: row.failure_reason,
    remediationSuggestion: row.remediation_suggestion, firmwareVersionId: row.fs_version_id,
    firmwareVersionName: row.fs_version_name, isLatest: row.is_latest === 1,
    supersededBy: row.superseded_by, mappingState: row.mapping_state,
  };
}

export function queryResultHistory(db: Database.Database, input: DetailPageInput) {
  const accepted = acceptedScope(db, input);
  const cacheState = cache(accepted);
  if (!accepted) return { items: [], total: 0, next: null, cache: cacheState };
  const cursor = decodeCursor(input.continuation);
  const storageVersion = accepted.project_version_id;
  const params = [input.projectId, storageVersion, accepted.accepted_generation_id, input.requirementId, input.tier] as const;
  const rows = db.prepare<unknown[], ResultRow>(
    `SELECT result_id, run_id, check_id, status, outcome, confidence, evidence_summary,
            executed_at, executed_by, failure_reason, remediation_suggestion, fs_version_id,
            fs_version_name, is_latest, superseded_by, mapping_state
       FROM verification_results
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND requirement_key = ? AND tier = ?
        AND (? IS NULL OR COALESCE(executed_at, '') < ?
          OR (COALESCE(executed_at, '') = ? AND result_id > ?))
      ORDER BY COALESCE(executed_at, '') DESC, result_id ASC LIMIT ?`,
  ).all(...params, cursor?.at ?? null, cursor?.at ?? "", cursor?.at ?? "", cursor?.id ?? "", input.pageSize + 1);
  const visible = rows.slice(0, input.pageSize);
  const total = db.prepare<unknown[], CountRow>(
    `SELECT COUNT(*) AS count FROM verification_results
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
        AND requirement_key = ? AND tier = ?`,
  ).get(...params)?.count ?? 0;
  return {
    items: visible.map((row) => ({ projectId: input.projectId, projectVersionId: fromStorageProjectVersionId(storageVersion), kind: "verification-result", key: row.result_id, label: `${row.status} · ${row.executed_at ?? "time unknown"}`, fields: resultFields(row) })),
    total,
    next: rows.length > input.pageSize && visible.at(-1) ? encodeCursor(visible.at(-1)!) : null,
    cache: cacheState,
  };
}

export function queryRunDetail(db: Database.Database, scope: RunDetailScope, requestedRunId?: string) {
  const accepted = acceptedScope(db, scope);
  const cacheState = cache(accepted);
  if (!accepted) throw new Error("VERIFICATION_DETAIL_EMPTY");
  const storageVersion = accepted.project_version_id;
  const generation = accepted.accepted_generation_id;
  const run = requestedRunId
    ? db.prepare<unknown[], RunRow>(`SELECT run_id, status, firmware_digest, job_id, started_at, finished_at, target, log_locator FROM verification_runs WHERE project_id=? AND project_version_id=? AND generation_id=? AND run_id=? LIMIT 1`).get(scope.projectId, storageVersion, generation, requestedRunId)
    : db.prepare<unknown[], RunRow>(`SELECT DISTINCT r.run_id, r.status, r.firmware_digest, r.job_id, r.started_at, r.finished_at, r.target, r.log_locator FROM verification_runs r JOIN verification_results vr ON vr.project_id=r.project_id AND vr.project_version_id=r.project_version_id AND vr.generation_id=r.generation_id AND vr.run_id=r.run_id WHERE vr.project_id=? AND vr.project_version_id=? AND vr.generation_id=? AND vr.requirement_key=? AND vr.tier=? ORDER BY COALESCE(r.started_at,'') DESC, r.run_id LIMIT 1`).get(scope.projectId, storageVersion, generation, scope.requirementId, scope.tier);
  const checks = db.prepare<unknown[], CheckRow>(
    `SELECT vc.check_id, vc.code, vc.name, vc.check_type, vc.category, vc.description,
            vc.pass_criteria, vc.fail_criteria, vc.input_description, rcm.is_required,
            rcm.coverage_level, rcm.suppressed
       FROM requirement_check_mappings rcm JOIN verification_checks vc
         ON vc.project_id=rcm.project_id AND vc.project_version_id=rcm.project_version_id
        AND vc.generation_id=rcm.generation_id AND vc.check_id=rcm.check_id
      WHERE rcm.project_id=? AND rcm.project_version_id=? AND rcm.generation_id=?
        AND rcm.requirement_key=? ORDER BY vc.code, vc.check_id`,
  ).all(scope.projectId, storageVersion, generation, scope.requirementId);
  const history = queryResultHistory(db, { ...scope, pageSize: 50, continuation: null });
  const artifacts = run ? db.prepare<unknown[], ArtifactRow>(`SELECT artifact_id, run_id, name, kind, media_type, sha256, bytes, created_at FROM verification_artifacts WHERE project_id=? AND project_version_id=? AND generation_id=? AND run_id=? ORDER BY COALESCE(created_at,'') DESC, artifact_id LIMIT 50`).all(scope.projectId, storageVersion, generation, run.run_id) : [];
  const attestations = run ? db.prepare<unknown[], AttestationRow>(`SELECT attestation_id, run_id, subject_digest, evidence_digest, signer_identity, payload, signature_verified, subject_matches_run, verified, created_at FROM attestations WHERE project_id=? AND project_version_id=? AND generation_id=? AND run_id=? ORDER BY created_at DESC, attestation_id LIMIT 50`).all(scope.projectId, storageVersion, generation, run.run_id) : [];
  const firmware = run?.firmware_digest ?? null;
  return {
    projectId: scope.projectId, projectVersionId: fromStorageProjectVersionId(storageVersion), kind: "verification-run-detail", key: run?.run_id ?? `${scope.requirementId}:${scope.tier}`, label: `${scope.requirementId} · ${scope.tier}`,
    fields: {
      requirementId: scope.requirementId, tier: scope.tier, run: run ? { id: run.run_id, status: run.status, firmwareDigest: firmware, jobId: run.job_id, startedAt: run.started_at, finishedAt: run.finished_at, target: run.target, logAvailable: run.log_locator !== null } : null,
      checks: checks.map((row) => ({ id: row.check_id, code: row.code, name: row.name, type: row.check_type, category: row.category, description: row.description, passCriteria: row.pass_criteria, failCriteria: row.fail_criteria, inputDescription: row.input_description, required: row.is_required === 1, coverageLevel: row.coverage_level, suppressed: row.suppressed === 1 })),
      history: history.items.map((item) => item.fields), historyTotal: history.total, historyNext: history.next,
      artifacts: artifacts.map((row) => ({ id: row.artifact_id, runId: row.run_id, name: row.name, kind: row.kind, mediaType: row.media_type, sha256: row.sha256, bytes: row.bytes, createdAt: row.created_at })),
      attestations: attestations.map((row) => {
        const bound = firmware !== null && row.subject_digest === firmware && row.subject_matches_run === 1;
        const verification = row.signature_verified !== 1 ? "unverified" : row.verified === 1 && bound ? "valid" : "invalid";
        return { id: row.attestation_id, runId: row.run_id, firmwareDigest: row.subject_digest, evidenceDigest: row.evidence_digest ?? "unavailable", signer: row.signer_identity ?? "unknown signer", signature: signature(row.payload), signedAt: row.created_at, verification, boundToCurrentFirmware: bound };
      }),
      manualAttestationAvailable: false,
      manualAttestationMessage: "Recording upstream verification evidence is unavailable pending an owner ruling on the verified write contract.",
      taraConcurrency: "Head-only group fencing is enforced by the sync pusher. Assurance Studio exposes no verified public checkpoint route.",
    },
    links: [], cache: cacheState,
  };
}
