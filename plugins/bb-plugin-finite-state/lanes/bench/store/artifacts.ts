import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getBenchCacheState, resolveRunLocation } from "./runs.js";
import type {
  BenchArtifactInput,
  BenchArtifactRow,
  BenchArtifactSummary,
  BenchEvidenceBundle,
  BenchPageQuery,
  Page,
  StoredRunLocation,
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:/u;
const CONTROL = /[\u0000-\u001f\u007f]/u;

interface CountRow {
  count: number;
}

function decodeArtifactCursor(value: string): string {
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  if (
    !decoded.startsWith("bench-artifact-") ||
    Buffer.from(decoded, "utf8").toString("base64url") !== value
  ) {
    throw new Error("Invalid bench artifact continuation");
  }
  return decoded;
}

function stableArtifactId(runId: string, artifact: BenchArtifactInput): string {
  const digest = createHash("sha256")
    .update([runId, artifact.name, artifact.kind, artifact.locator].join("\0"))
    .digest("hex");
  return `bench-artifact-${digest}`;
}

export function validateLogicalArtifactLocator(locator: string): string {
  if (
    locator.length < 1 ||
    locator.length > 1_024 ||
    locator.startsWith("/") ||
    locator.startsWith("~") ||
    WINDOWS_ABSOLUTE.test(locator) ||
    locator.includes("\\") ||
    locator.includes("%") ||
    locator.includes("?") ||
    locator.includes("#") ||
    CONTROL.test(locator)
  ) {
    throw new Error("Artifact locator must be a safe logical relative path");
  }
  const segments = locator.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    segments[0]?.includes(":")
  ) {
    throw new Error("Artifact locator must be a safe logical relative path");
  }
  return locator;
}

function validateArtifact(artifact: BenchArtifactInput): void {
  if (!artifact.name || !artifact.kind) {
    throw new Error("Bench artifact name and kind must be non-empty");
  }
  validateLogicalArtifactLocator(artifact.locator);
  if (artifact.sha256 !== null && !SHA256.test(artifact.sha256)) {
    throw new Error("Bench artifact sha256 must be a lowercase sha256 digest");
  }
  if (artifact.bytes !== null && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)) {
    throw new Error("Bench artifact bytes must be a non-negative safe integer");
  }
}

export function upsertBenchArtifacts(
  db: Database.Database,
  location: StoredRunLocation,
  bundle: BenchEvidenceBundle,
  pulledAt: string,
): number {
  let changes = 0;
  for (const artifact of bundle.artifacts) {
    validateArtifact(artifact);
    const write = db
      .prepare(
        `INSERT INTO verification_artifacts
           (project_id, project_version_id, generation_id, artifact_id, run_id,
            result_id, name, kind, locator, media_type, sha256, bytes,
            created_at, pulled_at)
         VALUES
           (@projectId, @projectVersionId, @generationId, @artifactId, @runId,
            NULL, @name, @kind, @locator, NULL, @sha256, @bytes, NULL, @pulledAt)
         ON CONFLICT (project_id, project_version_id, generation_id, artifact_id) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           locator = excluded.locator,
           sha256 = excluded.sha256,
           bytes = excluded.bytes,
           pulled_at = excluded.pulled_at
         WHERE verification_artifacts.name IS NOT excluded.name
            OR verification_artifacts.kind IS NOT excluded.kind
            OR verification_artifacts.locator IS NOT excluded.locator
            OR verification_artifacts.sha256 IS NOT excluded.sha256
            OR verification_artifacts.bytes IS NOT excluded.bytes`,
      )
      .run({
        projectId: location.projectId,
        projectVersionId: location.projectVersionId,
        generationId: location.generationId,
        artifactId: stableArtifactId(bundle.run.runId, artifact),
        runId: bundle.run.runId,
        name: artifact.name,
        kind: artifact.kind,
        locator: artifact.locator,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        pulledAt,
      });
    changes += write.changes;
  }
  return changes;
}

function summarize(row: BenchArtifactRow): BenchArtifactSummary {
  return {
    artifactId: row.artifact_id,
    name: row.name,
    kind: row.kind,
    locator: validateLogicalArtifactLocator(row.locator),
    sha256: row.sha256,
    bytes: row.bytes,
    createdAt: row.created_at,
    pulledAt: row.pulled_at,
  };
}

export function listBenchArtifacts(
  db: Database.Database,
  query: BenchPageQuery,
): Page<BenchArtifactSummary> {
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 200) {
    throw new Error("Bench artifact pageSize must be between 1 and 200");
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
    ? decodeArtifactCursor(query.continuation)
    : null;
  const rows = after
    ? db
        .prepare<[string, string, string, string, string, number], BenchArtifactRow>(
          `SELECT * FROM verification_artifacts
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ?
             AND run_id = ? AND artifact_id > ?
           ORDER BY artifact_id ASC LIMIT ?`,
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
        .prepare<[string, string, string, string, number], BenchArtifactRow>(
          `SELECT * FROM verification_artifacts
           WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?
           ORDER BY artifact_id ASC LIMIT ?`,
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
      `SELECT COUNT(*) AS count FROM verification_artifacts
       WHERE project_id = ? AND project_version_id = ? AND generation_id = ? AND run_id = ?`,
    )
    .get(location.projectId, location.projectVersionId, location.generationId, query.runId)
    ?.count ?? 0;
  return {
    items: visible.map(summarize),
    total: count,
    next:
      rows.length > query.pageSize && visible.at(-1)
        ? Buffer.from(visible.at(-1)!.artifact_id, "utf8").toString("base64url")
        : null,
    cache: getBenchCacheState(db, query.projectId, query.pvId, query.now),
  };
}
