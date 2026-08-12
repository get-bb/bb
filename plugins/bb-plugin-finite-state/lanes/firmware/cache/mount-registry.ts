import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname } from "node:path";
import type Database from "better-sqlite3";
import {
  FirmwareManifest,
  type FirmwareMount,
  getMountReadiness,
  type MountReadiness,
  type MountSource,
  verifyMountIntegrity,
} from "./manifest.js";
import { assertFirmwareCacheIgnored, FirmwareCacheError, validatePvId } from "./layout.js";

export interface FirmwareMountScope {
  projectId: string;
  projectVersionId: string;
  generationId: string;
}

export interface CommitFirmwareMountInput {
  scope: FirmwareMountScope;
  manifest: FirmwareManifest;
  mount: FirmwareMount;
  scanId: string | null;
  adminBytesOk: boolean | null;
  pulledAt: string;
}

interface RegistryRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  source: MountSource;
  state: string;
  scan_id: string | null;
  input_sha256: string | null;
  artifact_hash: string | null;
  root_path: string;
  file_count: number;
  materialized_files: number;
  error_count: number;
  admin_bytes_ok: 0 | 1 | null;
  message: string | null;
  materialized_at: string | null;
  pulled_at: string;
}

function stateForReadiness(readiness: MountReadiness): RegistryRow["state"] {
  switch (readiness) {
    case "missing":
      return "not_materialized";
    case "metadata_only":
      return "metadata_only";
    case "partial":
      return "ready_with_gaps";
    case "fully_materialized":
      return "ready";
    case "stale":
      return "stale";
    case "invalid":
      return "error";
  }
}

function assertScope(scope: FirmwareMountScope): void {
  for (const [name, value] of Object.entries(scope)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new FirmwareCacheError("INVALID_MOUNT_SCOPE", `Missing ${name} in firmware mount scope.`);
    }
  }
  validatePvId(scope.projectVersionId);
}

export function commitFirmwareMount(db: Database.Database, input: CommitFirmwareMountInput): void {
  assertScope(input.scope);
  const meta = input.manifest.readMeta();
  if (!meta || meta.pvId !== input.scope.projectVersionId || meta.pvId !== input.mount.pvId) {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "The shared registry scope does not match the sidecar project-version id.",
    );
  }
  if (
    input.mount.source !== meta.source ||
    input.mount.inputSha256 !== meta.inputSha256 ||
    input.mount.artifactHash !== meta.artifactHash ||
    input.scanId !== meta.scanId
  ) {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "The mount summary does not match sidecar provenance.",
    );
  }
  verifyMountIntegrity(input.manifest);
  const readiness = getMountReadiness(input.manifest);
  if (readiness === "missing" || readiness === "invalid") {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "An absent or invalid sidecar cannot advance the shared firmware registry.",
    );
  }
  if (realpathSync(input.mount.manifestPath) !== realpathSync(input.manifest.path)) {
    throw new FirmwareCacheError("INCOHERENT_FIRMWARE_MOUNT", "Mount and sidecar paths do not match.");
  }
  const rootStat = lstatSync(input.mount.rootfsPath);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new FirmwareCacheError("INCOHERENT_FIRMWARE_MOUNT", "The mount rootfs is not a real directory.");
  }
  const cacheRoot = dirname(dirname(input.mount.rootfsPath));
  if (basename(cacheRoot) !== ".fs-firmware") {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "The rootfs is outside the firmware cache layout.",
    );
  }
  assertFirmwareCacheIgnored(dirname(cacheRoot));
  if (realpathSync(dirname(input.mount.rootfsPath)) !== realpathSync(dirname(input.manifest.path))) {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "The rootfs and sidecar are not in the same version mount.",
    );
  }
  const counts = input.manifest.counts();
  if (
    input.mount.nodeCount !== counts.nodes ||
    input.mount.hydratedCount !== counts.hydrated ||
    input.mount.readiness !== readiness
  ) {
    throw new FirmwareCacheError(
      "INCOHERENT_FIRMWARE_MOUNT",
      "The mount summary counts or readiness do not match the sidecar.",
    );
  }
  const errorCount = counts.errors + meta.unpackErrors.length + input.mount.errors.length;
  const message = [...meta.unpackErrors, ...input.mount.errors].slice(0, 20).join("\n") || null;

  db.transaction(() => {
    db.prepare(`INSERT INTO firmware_mounts (
      project_id, project_version_id, generation_id, source, state, scan_id,
      input_sha256, artifact_hash, root_path, file_count, materialized_files,
      error_count, admin_bytes_ok, message, materialized_at, pulled_at
    ) VALUES (
      @projectId, @projectVersionId, @generationId, @source, @state, @scanId,
      @inputSha256, @artifactHash, @rootPath, @fileCount, @materializedFiles,
      @errorCount, @adminBytesOk, @message, @materializedAt, @pulledAt
    ) ON CONFLICT(project_id, project_version_id, generation_id) DO UPDATE SET
      source=excluded.source, state=excluded.state, scan_id=excluded.scan_id,
      input_sha256=excluded.input_sha256, artifact_hash=excluded.artifact_hash,
      root_path=excluded.root_path, file_count=excluded.file_count,
      materialized_files=excluded.materialized_files, error_count=excluded.error_count,
      admin_bytes_ok=excluded.admin_bytes_ok, message=excluded.message,
      materialized_at=excluded.materialized_at, pulled_at=excluded.pulled_at`).run({
      ...input.scope,
      source: meta.source,
      state: stateForReadiness(readiness),
      scanId: input.scanId,
      inputSha256: meta.inputSha256,
      artifactHash: meta.artifactHash,
      rootPath: realpathSync(input.mount.rootfsPath),
      fileCount: counts.files,
      materializedFiles: counts.hydrated,
      errorCount,
      adminBytesOk: input.adminBytesOk === null ? null : input.adminBytesOk ? 1 : 0,
      message,
      materializedAt: meta.materializedAt,
      pulledAt: input.pulledAt,
    });
  })();
}

export interface RegisteredFirmwareMount {
  scope: FirmwareMountScope;
  source: MountSource;
  state: string;
  rootPath: string;
  fileCount: number;
  materializedFiles: number;
  errorCount: number;
  pulledAt: string;
}

export function getRegisteredFirmwareMount(
  db: Database.Database,
  scope: FirmwareMountScope,
): RegisteredFirmwareMount | null {
  assertScope(scope);
  const row = db.prepare(`SELECT * FROM firmware_mounts
    WHERE project_id = ? AND project_version_id = ? AND generation_id = ?`).get(
    scope.projectId,
    scope.projectVersionId,
    scope.generationId,
  ) as RegistryRow | undefined;
  if (!row) return null;
  return {
    scope: {
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      generationId: row.generation_id,
    },
    source: row.source,
    state: row.state,
    rootPath: row.root_path,
    fileCount: row.file_count,
    materializedFiles: row.materialized_files,
    errorCount: row.error_count,
    pulledAt: row.pulled_at,
  };
}
