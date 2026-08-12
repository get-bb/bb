import type Database from "better-sqlite3";
import { toStorageProjectVersionId } from "../../../../lib/store/index.js";
import { reqIdKey } from "../../../../lib/sync/registry.js";
import type { JsonValue } from "../../../../shared/contract.js";
import { jsonValueSchema } from "../../../../shared/contract.js";
import {
  requirementCardModelSchema,
  type RequirementCardModel,
  type RequirementEvidenceState,
  type RequirementYamlV1,
} from "./schema.js";
import { requirementSemanticSha256 } from "./adapter.js";

function isJsonRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cardModelToFields(model: RequirementCardModel): Record<string, JsonValue> {
  const parsed = jsonValueSchema.parse(model);
  if (!isJsonRecord(parsed)) throw new Error("Requirement card model must encode as an object.");
  return parsed;
}

export function cardModelFromFields(fields: Record<string, JsonValue>): RequirementCardModel {
  return requirementCardModelSchema.parse(fields);
}

interface RollupRow {
  total_checks: number;
  verified_checks: number;
  failed_checks: number;
  error_checks: number;
  inconclusive_checks: number;
  running_checks: number;
  pending_checks: number;
  skipped_checks: number;
}

interface ResultRow {
  tier: "static" | "emulation" | "hil" | "manual";
  status: string;
  fs_version_id: string | null;
}

interface SnapshotRow {
  content_hash: string;
}

function evidenceFromCounts(row: RollupRow | undefined): RequirementEvidenceState {
  if (!row || row.total_checks === 0) return "not_run";
  if (row.failed_checks > 0 || row.error_checks > 0) return "failed";
  if (row.verified_checks === row.total_checks) return "verified";
  if (
    row.verified_checks > 0 ||
    row.inconclusive_checks > 0 ||
    row.running_checks > 0 ||
    row.pending_checks > 0 ||
    row.skipped_checks > 0
  ) return "partial";
  return "not_run";
}

function evidenceFromResults(rows: readonly ResultRow[]): RequirementEvidenceState {
  if (rows.length === 0) return "not_run";
  if (rows.some((row) => row.status === "failed" || row.status === "error")) return "failed";
  if (rows.every((row) => row.status === "verified")) return "verified";
  return "partial";
}

const TIERS = ["static", "emulation", "hil", "manual"] as const;

export function loadRequirementCardModel(
  db: Database.Database,
  scope: { projectId: string; projectVersionId: string | null },
  requirement: RequirementYamlV1,
  sourceSha256: string | null,
): RequirementCardModel {
  const projectVersionId = toStorageProjectVersionId(scope.projectVersionId);
  const requirementKey = reqIdKey({ reqId: requirement.id });
  const generation = db
    .prepare<[string, string], { accepted_generation_id: string | null }>(
      `SELECT accepted_generation_id FROM sync_state
        WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'`,
    )
    .get(scope.projectId, projectVersionId)?.accepted_generation_id ?? null;

  let rollup: RollupRow | undefined;
  let results: ResultRow[] = [];
  let baseHash: string | null = null;
  if (generation) {
    rollup = db
      .prepare<[string, string, string, string], RollupRow>(
        `SELECT total_checks, verified_checks, failed_checks,
                error_checks, inconclusive_checks, running_checks, pending_checks, skipped_checks
           FROM requirement_rollup
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND requirement_key = ?`,
      )
      .get(scope.projectId, projectVersionId, generation, requirementKey);
    results = db
      .prepare<[string, string, string, string], ResultRow>(
        `SELECT tier, status, fs_version_id
           FROM verification_results
          WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
            AND requirement_key = ? AND is_latest = 1
          ORDER BY tier, result_id`,
      )
      .all(scope.projectId, projectVersionId, generation, requirementKey);
    baseHash = db
      .prepare<[string, string, string, string], SnapshotRow>(
        `SELECT content_hash FROM base_snapshot
          WHERE project_id = ? AND project_version_id = ? AND entity_kind = 'requirement'
            AND generation_id = ? AND entity_key = ?`,
      )
      .get(scope.projectId, projectVersionId, generation, requirementKey)?.content_hash ?? null;
  }

  const semanticHash = requirementSemanticSha256(requirement);
  const local = baseHash === null || baseHash !== semanticHash;
  const firmwareChanged =
    scope.projectVersionId !== null &&
    results.some((result) => result.fs_version_id !== scope.projectVersionId);
  const stale = results.length > 0 && (local || firmwareChanged);
  const tiers = TIERS.map((tier) => {
    const tierResults = results.filter((result) => result.tier === tier);
    const authoredCount = requirement.verification.filter((contract) => contract.tier === tier).length;
    return {
      tier,
      state: evidenceFromResults(tierResults),
      count: Math.max(authoredCount, tierResults.length),
    };
  });

  return {
    requirement,
    evidenceState: evidenceFromCounts(rollup),
    stale,
    local,
    tiers,
    sourceSha256,
  };
}
