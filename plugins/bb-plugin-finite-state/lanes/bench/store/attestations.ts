import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getBenchCacheState, resolveRunLocation } from "./runs.js";
import type {
  BenchAttestationRow,
  BenchAttestationSummary,
  BenchEvidenceBundle,
  BenchPageQuery,
  Page,
  StoredRunLocation,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;

interface CountRow {
  count: number;
}

function decodeAttestationCursor(value: string): string {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (
    !decoded.startsWith("bench-attestation-") ||
    Buffer.from(decoded, "utf8").toString("base64url") !== value
  ) {
    throw new Error("Invalid bench attestation continuation");
  }
  return decoded;
}

function validateEnvelope(payload: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Bench attestation payload must be a JSON envelope");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Bench attestation payload must be a JSON envelope");
  }
}

export function upsertBenchAttestation(
  db: Database.Database,
  location: StoredRunLocation,
  bundle: BenchEvidenceBundle,
  pulledAt: string,
): number {
  const attestation = bundle.attestation;
  if (!attestation) return 0;
  if (!SHA256.test(attestation.subjectDigest)) {
    throw new Error("Bench attestation subjectDigest must be a lowercase sha256 digest");
  }
  validateEnvelope(attestation.payload);
  const runDigest = bundle.run.firmwareDigest ?? location.row?.firmware_digest ?? null;
  const subjectMatchesRun = runDigest !== null && attestation.subjectDigest === runDigest;
  const signatureVerified = attestation.verified;
  const verified = signatureVerified && subjectMatchesRun;
  const attestationId = `bench-attestation-${createHash("sha256")
    .update([bundle.run.runId, attestation.format, attestation.subjectDigest, attestation.payload].join("\0"))
    .digest("hex")}`;
  const write = db
    .prepare(
      `INSERT INTO attestations
         (project_id, project_version_id, generation_id, attestation_id, run_id,
          format, predicate_type, subject_digest, evidence_digest, verdict,
          requirement_ids, check_ids, result_refs, signer_identity, rekor_uuid,
          envelope_locator, payload, signature_verified, subject_matches_run,
          verified, created_at, pulled_at)
       VALUES
         (@projectId, @projectVersionId, @generationId, @attestationId, @runId,
          @format, NULL, @subjectDigest, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          NULL, @payload, @signatureVerified, @subjectMatchesRun, @verified,
          @createdAt, @pulledAt)
       ON CONFLICT (project_id, project_version_id, generation_id, attestation_id) DO UPDATE SET
         payload = excluded.payload,
         signature_verified = excluded.signature_verified,
         subject_matches_run = excluded.subject_matches_run,
         verified = excluded.verified,
         pulled_at = excluded.pulled_at
       WHERE attestations.payload IS NOT excluded.payload
          OR attestations.signature_verified IS NOT excluded.signature_verified
          OR attestations.subject_matches_run IS NOT excluded.subject_matches_run
          OR attestations.verified IS NOT excluded.verified`,
    )
    .run({
      projectId: location.projectId,
      projectVersionId: location.projectVersionId,
      generationId: location.generationId,
      attestationId,
      runId: bundle.run.runId,
      format: attestation.format,
      subjectDigest: attestation.subjectDigest,
      payload: attestation.payload,
      signatureVerified: signatureVerified ? 1 : 0,
      subjectMatchesRun: subjectMatchesRun ? 1 : 0,
      verified: verified ? 1 : 0,
      createdAt: pulledAt,
      pulledAt,
    });
  return write.changes;
}

function summarize(row: BenchAttestationRow): BenchAttestationSummary {
  return {
    attestationId: row.attestation_id,
    format: row.format,
    subjectDigest: row.subject_digest,
    signatureVerified: row.signature_verified === 1,
    subjectMatchesRun: row.subject_matches_run === 1,
    verified: row.verified === 1,
    createdAt: row.created_at,
    pulledAt: row.pulled_at,
  };
}

export function listBenchAttestations(
  db: Database.Database,
  query: BenchPageQuery,
): Page<BenchAttestationSummary> {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 200) {
    throw new Error("Bench attestation pageSize must be between 1 and 200");
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
  const after = query.continuation
    ? decodeAttestationCursor(query.continuation)
    : null;
  const rows = after
    ? db
        .prepare<[string, string, string, string, string, number], BenchAttestationRow>(
          `SELECT * FROM attestations
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
             AND run_id = ? AND attestation_id > ?
           ORDER BY attestation_id ASC LIMIT ?`,
        )
        .all(
          location.projectId,
          location.projectVersionId,
          location.generationId,
          query.runId,
          after,
          query.pageSize + 1,
        )
    : db
        .prepare<[string, string, string, string, number], BenchAttestationRow>(
          `SELECT * FROM attestations
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?
           ORDER BY attestation_id ASC LIMIT ?`,
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
      `SELECT COUNT(*) AS count FROM attestations
       WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?`,
    )
    .get(location.projectId, location.projectVersionId, location.generationId, query.runId)
    ?.count ?? 0;
  return {
    items: visible.map(summarize),
    total: count,
    next:
      rows.length > query.pageSize && visible.at(-1)
        ? Buffer.from(visible.at(-1)!.attestation_id, "utf8").toString("base64url")
        : null,
    cache: getBenchCacheState(db, query.projectId, query.pvId, query.now),
  };
}
