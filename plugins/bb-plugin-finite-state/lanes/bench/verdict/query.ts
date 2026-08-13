import { defineRpcContract } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { reqIdKey } from "../../../lib/sync/registry.js";
import { validateRequirement } from "../../product-security/requirements/cards/validator.js";
import type { RequirementYamlV1 } from "../../product-security/requirements/cards/schema.js";
import {
  evaluateOtaVerdict,
  type MatrixTier,
  type VerdictAttestationInput,
  type VerdictCandidateInput,
  type VerdictRequirementInput,
  type VerdictResult,
} from "./evaluate.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/u;
const TIERS = ["static", "emulation", "hil", "manual"] as const;

const sha256Schema = z.string().regex(SHA256);
const identifierSchema = z.string().regex(IDENTIFIER);
const timestampSchema = z.string().datetime({ offset: true });
const matrixTierSchema = z.enum(TIERS);
const evidenceSchema = z.object({
  requirementId: identifierSchema,
  tier: matrixTierSchema,
  state: z.enum([
    "proven", "failed", "error", "unmapped", "not_run", "running",
    "skipped", "unsigned", "invalid_signature", "stale_digest",
  ]),
  required: z.boolean(),
  runId: identifierSchema.optional(),
  checkId: identifierSchema.optional(),
  resultId: identifierSchema.optional(),
  outcome: z.string().max(100).optional(),
  attestationId: identifierSchema.optional(),
  attestationVerified: z.boolean(),
  signatureVerified: z.boolean().optional(),
  subjectMatchesDigest: z.boolean().optional(),
  signerIdentity: z.string().max(2_000).optional(),
  evidenceDigest: sha256Schema.optional(),
  runStartedAt: timestampSchema.optional(),
  runFinishedAt: timestampSchema.optional(),
  resultExecutedAt: timestampSchema.optional(),
  attestationCreatedAt: timestampSchema.optional(),
}).strict();
const verdictResultSchema = z.object({
  pvId: identifierSchema,
  firmwareDigest: sha256Schema.nullable(),
  currentMountedDigest: sha256Schema.nullable(),
  verdict: z.enum(["SAFE_TO_OTA", "NOT_SAFE", "INCONCLUSIVE"]),
  stale: z.boolean(),
  required: z.number().int().nonnegative(),
  proven: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
  evidence: z.array(evidenceSchema).max(10_000),
  issues: z.array(z.object({
    code: z.enum(["MODEL_UNAVAILABLE", "MISSING_CURRENT_DIGEST"]),
    message: z.string().max(2_000),
  }).strict()).max(10),
  computedAt: timestampSchema,
}).strict();

/** Lane-local additive contract; the frozen summary RPC remains unchanged. */
export const otaVerdictRpcContract = defineRpcContract({
  benchOtaVerdictGet: {
    input: z.object({
      projectId: identifierSchema,
      pvId: identifierSchema,
      digest: sha256Schema.optional(),
    }).strict(),
    output: verdictResultSchema,
  },
});

export type OtaVerdictRpcContract = typeof otaVerdictRpcContract;

interface SyncRow {
  accepted_generation_id: string | null;
  last_pull: string | null;
  error: string | null;
  base_revision: number;
}

interface SnapshotRow {
  entity_key: string;
  payload: string;
}

interface MappingRow {
  requirement_key: string;
  check_id: string;
  code: string;
  suppressed: 0 | 1;
}

interface ResultRow {
  result_id: string;
  requirement_key: string;
  check_id: string | null;
  tier: string;
  status: string;
  outcome: string | null;
  run_id: string | null;
  run_status: string | null;
  firmware_digest: string | null;
  started_at: string | null;
  finished_at: string | null;
  executed_at: string | null;
  pulled_at: string;
  superseded_by: string | null;
}

interface AttestationRow {
  attestation_id: string;
  run_id: string;
  subject_digest: string;
  requirement_ids: string | null;
  check_ids: string | null;
  result_refs: string | null;
  signer_identity: string | null;
  signature_verified: 0 | 1;
  subject_matches_run: 0 | 1;
  verified: 0 | 1;
  created_at: string;
}

interface MountRow {
  artifact_hash: string | null;
  input_sha256: string | null;
}

interface QueryModel {
  available: boolean;
  requirements: VerdictRequirementInput[];
}

export interface VerdictDeps {
  db: Database.Database;
  projectId: string;
  now?: () => string;
}

function syncRow(
  db: Database.Database,
  projectId: string,
  pvId: string,
  kind: string,
): SyncRow | null {
  return db.prepare<[string, string, string], SyncRow>(
    `SELECT accepted_generation_id, last_pull, error, base_revision
       FROM sync_state
      WHERE project_id = ? AND project_version_id = ? AND entity_kind = ?`,
  ).get(projectId, toStorageProjectVersionId(pvId), kind) ?? null;
}

function parseStringArray(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function normalizeDigest(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.startsWith("sha256:") ? value.slice(7) : value;
  return SHA256.test(normalized) ? normalized : null;
}

function loadRequirementModel(
  db: Database.Database,
  projectId: string,
  pvId: string,
  evidenceGeneration: string | null,
): QueryModel {
  const requirementSync = syncRow(db, projectId, pvId, "requirement");
  if (!requirementSync?.accepted_generation_id) {
    return { available: false, requirements: [] };
  }
  const snapshots = db.prepare<[string, string, string], SnapshotRow>(
    `SELECT entity_key, payload
       FROM base_snapshot
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'requirement' AND generation_id = ?
      ORDER BY entity_key`,
  ).all(
    projectId,
    toStorageProjectVersionId(pvId),
    requirementSync.accepted_generation_id,
  );
  const parsed: RequirementYamlV1[] = [];
  let corrupt = snapshots.length === 0;
  for (const snapshot of snapshots) {
    try {
      const validated = validateRequirement(JSON.parse(snapshot.payload));
      if (!validated.success || snapshot.entity_key !== reqIdKey({ reqId: validated.data.id })) {
        corrupt = true;
        continue;
      }
      parsed.push(validated.data);
    } catch {
      corrupt = true;
    }
  }
  const mappings = evidenceGeneration === null
    ? []
    : db.prepare<[string, string, string], MappingRow>(
      `SELECT mapping.requirement_key, mapping.check_id, checks.code,
              mapping.suppressed
         FROM requirement_check_mappings mapping
         JOIN verification_checks checks
           ON checks.project_id = mapping.project_id
          AND checks.project_version_id = mapping.project_version_id
          AND checks.generation_id = mapping.generation_id
          AND checks.check_id = mapping.check_id
        WHERE mapping.project_id = ? AND mapping.project_version_id = ?
          AND mapping.generation_id = ?
        ORDER BY mapping.requirement_key, checks.code, mapping.check_id`,
    ).all(projectId, toStorageProjectVersionId(pvId), evidenceGeneration);
  const requirements = parsed.flatMap((requirement): VerdictRequirementInput[] => {
    const aliases = new Set([requirement.id, reqIdKey({ reqId: requirement.id })]);
    return requirement.verification.map((contract) => ({
      requirementId: requirement.id,
      tier: contract.tier,
      required: contract.required,
      mappedCheckIds: contract.check === null
        ? []
        : mappings
          .filter((mapping) =>
            aliases.has(mapping.requirement_key)
            && mapping.suppressed === 0
            && (mapping.code === contract.check || mapping.check_id === contract.check))
          .map((mapping) => mapping.check_id),
    }));
  });
  return { available: !corrupt && parsed.length > 0, requirements };
}

function loadAttestations(
  db: Database.Database,
  projectId: string,
  pvId: string,
  generation: string,
): Map<string, VerdictAttestationInput[]> {
  const rows = db.prepare<[string, string, string], AttestationRow>(
    `SELECT attestation_id, run_id, subject_digest, requirement_ids, check_ids,
            result_refs, signer_identity, signature_verified,
            subject_matches_run, verified, created_at
       FROM attestations
      WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
      ORDER BY created_at DESC, attestation_id DESC`,
  ).all(projectId, toStorageProjectVersionId(pvId), generation);
  const byRun = new Map<string, VerdictAttestationInput[]>();
  for (const row of rows) {
    const subjectDigest = normalizeDigest(row.subject_digest);
    if (subjectDigest === null) continue;
    const attestation: VerdictAttestationInput = {
      attestationId: row.attestation_id,
      signatureVerified: row.signature_verified === 1,
      subjectMatchesDigest: row.subject_matches_run === 1,
      verified: row.verified === 1,
      subjectDigest,
      requirementIds: parseStringArray(row.requirement_ids),
      checkIds: parseStringArray(row.check_ids),
      resultRefs: parseStringArray(row.result_refs),
      signerIdentity: row.signer_identity,
      createdAt: row.created_at,
    };
    const current = byRun.get(row.run_id) ?? [];
    current.push(attestation);
    byRun.set(row.run_id, current);
  }
  return byRun;
}

function requirementAliases(requirements: readonly VerdictRequirementInput[]): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const requirement of requirements) {
    aliases.set(requirement.requirementId, requirement.requirementId);
    aliases.set(reqIdKey({ reqId: requirement.requirementId }), requirement.requirementId);
  }
  return aliases;
}

function loadCandidates(
  db: Database.Database,
  projectId: string,
  pvId: string,
  generation: string | null,
  requirements: readonly VerdictRequirementInput[],
): VerdictCandidateInput[] {
  if (generation === null) return [];
  const aliases = requirementAliases(requirements);
  const attestations = loadAttestations(db, projectId, pvId, generation);
  const rows = db.prepare<[string, string, string], ResultRow>(
    `SELECT result.result_id, result.requirement_key, result.check_id,
            result.tier, result.status, result.outcome, result.run_id,
            run.status AS run_status, run.firmware_digest,
            run.started_at, run.finished_at, result.executed_at,
            result.pulled_at, result.superseded_by
       FROM verification_results result
       LEFT JOIN verification_runs run
         ON run.project_id = result.project_id
        AND run.project_version_id = result.project_version_id
        AND run.generation_id = result.generation_id
        AND run.run_id = result.run_id
      WHERE result.project_id = ? AND result.project_version_id = ?
        AND result.generation_id = ? AND result.mapping_state = 'mapped'
        AND result.is_latest = 1 AND result.superseded_by IS NULL
      ORDER BY result.executed_at DESC, result.result_id DESC`,
  ).all(projectId, toStorageProjectVersionId(pvId), generation);
  return rows.flatMap((row): VerdictCandidateInput[] => {
    const requirementId = aliases.get(row.requirement_key);
    if (!requirementId || !TIERS.includes(row.tier as MatrixTier)) return [];
    return [{
      resultId: row.result_id,
      requirementId,
      tier: row.tier as MatrixTier,
      mappingState: "mapped",
      runId: row.run_id,
      checkId: row.check_id,
      outcome: row.outcome,
      resultStatus: row.status,
      runStatus: row.run_status,
      firmwareDigest: normalizeDigest(row.firmware_digest),
      runStartedAt: row.started_at,
      runFinishedAt: row.finished_at,
      resultExecutedAt: row.executed_at,
      pulledAt: row.pulled_at,
      superseded: row.superseded_by !== null,
      attestations: row.run_id === null ? [] : (attestations.get(row.run_id) ?? []),
    }];
  });
}

function mountedDigest(
  db: Database.Database,
  projectId: string,
  pvId: string,
): string | null {
  const row = db.prepare<[string, string], MountRow>(
    `SELECT artifact_hash, input_sha256
       FROM firmware_mounts
      WHERE project_id = ? AND project_version_id = ?
      ORDER BY pulled_at DESC LIMIT 1`,
  ).get(projectId, toStorageProjectVersionId(pvId));
  return normalizeDigest(row?.artifact_hash ?? row?.input_sha256 ?? null);
}

export async function getOtaVerdict(
  deps: VerdictDeps,
  pvId: string,
  digest?: string,
): Promise<VerdictResult> {
  const evidenceSync = syncRow(deps.db, deps.projectId, pvId, "verificationRun");
  const generation = evidenceSync?.accepted_generation_id ?? null;
  const model = loadRequirementModel(deps.db, deps.projectId, pvId, generation);
  const currentMountedDigest = mountedDigest(deps.db, deps.projectId, pvId);
  const evaluatedDigest = digest ?? currentMountedDigest;
  return evaluateOtaVerdict({
    pvId,
    firmwareDigest: evaluatedDigest,
    currentMountedDigest,
    modelAvailable: model.available,
    requirements: model.requirements,
    candidates: loadCandidates(
      deps.db,
      deps.projectId,
      pvId,
      generation,
      model.requirements,
    ),
    computedAt: deps.now?.() ?? new Date().toISOString(),
  });
}

export interface FrozenVerdictProjection {
  projectId: string;
  projectVersionId: string;
  id: string;
  verdict: "green" | "amber" | "red";
  firmwareSha256: string;
  required: number;
  proven: number;
  evidenceIds: string[];
  reasons: string[];
  cache: {
    state: "fresh" | "stale" | "empty";
    asOf: string | null;
    message: string | null;
    acceptedGenerationId: string | null;
    baseRevision: number;
  };
}

export function projectFrozenVerdict(
  db: Database.Database,
  projectId: string,
  verdictId: string,
  result: VerdictResult,
): FrozenVerdictProjection {
  if (result.firmwareDigest === null) throw new Error("FIRMWARE_DIGEST_UNAVAILABLE");
  const cache = syncRow(db, projectId, result.pvId, "verificationRun");
  const blockers = result.evidence
    .filter((entry) => entry.required && entry.state !== "proven")
    .map((entry) => `${entry.requirementId}/${entry.tier}: ${entry.state}`);
  return {
    projectId,
    projectVersionId: result.pvId,
    id: verdictId,
    verdict: result.verdict === "SAFE_TO_OTA"
      ? "green"
      : result.verdict === "NOT_SAFE" ? "red" : "amber",
    firmwareSha256: result.firmwareDigest,
    required: result.required,
    proven: result.proven,
    evidenceIds: result.evidence.flatMap((entry) =>
      entry.resultId ? [entry.resultId] : []),
    reasons: [
      ...result.issues.map((issue) => `${issue.code}: ${issue.message}`),
      ...blockers,
    ],
    cache: {
      state: cache?.error ? "stale" : cache?.accepted_generation_id ? "fresh" : "empty",
      asOf: cache?.last_pull ?? null,
      message: cache?.error ?? null,
      acceptedGenerationId: cache?.accepted_generation_id ?? null,
      baseRevision: cache?.base_revision ?? 0,
    },
  };
}

export const BENCH_VERDICT_HANDLER_IMPLEMENTED = true as const;
