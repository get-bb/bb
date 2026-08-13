import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type Database from "better-sqlite3";
import SidecarDatabase from "better-sqlite3";
import { FirmwareCacheError, validatePvId } from "./cache/layout.js";
import { normalizeVirtualPath, resolveSafeNodePath } from "./cache/path-safety.js";

export type FirmwareStatusState =
  | "not_materialized"
  | "hashing"
  | "unpacking"
  | "validating"
  | "ingesting"
  | "ready"
  | "ready_with_gaps"
  | "metadata_only"
  | "stale"
  | "error";

export interface FirmwareStatusView {
  pvId: string;
  source: "standalone_unpack" | "api" | null;
  state: FirmwareStatusState;
  files: number;
  materializedFiles: number;
  errors: number;
  inputSha256: string | null;
  artifactHash: string | null;
  message?: string;
}

export interface FirmwareUiDeps {
  db: Database.Database;
  projectId: string;
}

interface FirmwareMountRow {
  project_id: string;
  project_version_id: string;
  generation_id: string;
  source: "standalone_unpack" | "api";
  state: FirmwareStatusState;
  input_sha256: string | null;
  artifact_hash: string | null;
  root_path: string;
  file_count: number;
  materialized_files: number;
  error_count: number;
  message: string | null;
  pulled_at: string;
}

interface PullRow {
  generation_id: string;
  status: "staging" | "accepted" | "superseded" | "failed" | "cancelled";
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface FirmwareNodeRow {
  path: string;
  kind: "file" | "directory" | "symlink";
  file_hash: string | null;
  size: number | null;
  mime_type: string | null;
  full_type: string | null;
  unix_mode: number | null;
  unix_uid: number | null;
  unix_gid: number | null;
  is_setuid: 0 | 1;
  is_setgid: 0 | 1;
  symlink_target: string | null;
  materialized: 0 | 1;
  errors: string | null;
  security_features?: string | null;
  security_features_json?: string | null;
}

interface PageInput {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, unknown>;
  firmwarePath?: string;
}

const emptyCache = {
  state: "empty" as const,
  asOf: null,
  message: null,
  acceptedGenerationId: null,
  baseRevision: 0,
};

function cacheFor(row: FirmwareMountRow | null) {
  if (!row) return emptyCache;
  const stale = row.state === "stale" || row.state === "error";
  return {
    state: stale ? "stale" as const : "fresh" as const,
    asOf: row.pulled_at,
    message: row.message,
    acceptedGenerationId: row.generation_id,
    baseRevision: 0,
  };
}

function latestMount(deps: FirmwareUiDeps, pvId: string): FirmwareMountRow | null {
  validatePvId(pvId);
  return (deps.db.prepare(`SELECT * FROM firmware_mounts
    WHERE project_id = ? AND project_version_id = ?
    ORDER BY pulled_at DESC, generation_id DESC LIMIT 1`).get(
      deps.projectId,
      pvId,
    ) as FirmwareMountRow | undefined) ?? null;
}

function latestPull(deps: FirmwareUiDeps, pvId: string): PullRow | null {
  return (deps.db.prepare(`SELECT generation_id, status, error, started_at, completed_at
    FROM pull_generation
    WHERE project_id = ? AND project_version_id = ?
      AND requested_kinds_json LIKE '%"firmware"%'
    ORDER BY started_at DESC, generation_id DESC LIMIT 1`).get(
      deps.projectId,
      pvId,
    ) as PullRow | undefined) ?? null;
}

export async function getFirmwareStatus(
  deps: FirmwareUiDeps,
  pvId: string,
): Promise<FirmwareStatusView> {
  const mount = latestMount(deps, pvId);
  const pull = latestPull(deps, pvId);
  if (pull?.status === "staging" && pull.generation_id !== mount?.generation_id) {
    return {
      pvId,
      source: null,
      state: "unpacking",
      files: mount?.file_count ?? 0,
      materializedFiles: mount?.materialized_files ?? 0,
      errors: mount?.error_count ?? 0,
      inputSha256: mount?.input_sha256 ?? null,
      artifactHash: mount?.artifact_hash ?? null,
      message: "Firmware materialization is running.",
    };
  }
  if (!mount) {
    const failed = pull?.status === "failed" || pull?.status === "cancelled";
    return {
      pvId,
      source: null,
      state: failed ? "error" : "not_materialized",
      files: 0,
      materializedFiles: 0,
      errors: failed ? 1 : 0,
      inputSha256: null,
      artifactHash: null,
      ...(pull?.error ? { message: pull.error } : {}),
    };
  }
  return {
    pvId,
    source: mount.source,
    state: mount.state,
    files: mount.file_count,
    materializedFiles: mount.materialized_files,
    errors: mount.error_count,
    inputSha256: mount.input_sha256,
    artifactHash: mount.artifact_hash,
    ...(mount.message ? { message: mount.message } : {}),
  };
}

function parseOffset(value: string | null): number {
  if (value === null) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown };
    if (Number.isSafeInteger(parsed.offset) && Number(parsed.offset) >= 0) return Number(parsed.offset);
  } catch {
    // Fall through to one stable public error.
  }
  throw new FirmwareCacheError("INVALID_CONTINUATION", "Firmware continuation is invalid.");
}

function nextOffset(offset: number, count: number, total: number): string | null {
  const next = offset + count;
  return next < total
    ? Buffer.from(JSON.stringify({ offset: next }), "utf8").toString("base64url")
    : null;
}

function requirePvId(input: PageInput): string {
  if (input.projectVersionId === null) {
    throw new FirmwareCacheError("INVALID_MOUNT_SCOPE", "Firmware operations require a project version.");
  }
  return validatePvId(input.projectVersionId);
}

function openSidecar(row: FirmwareMountRow): SidecarDatabase.Database {
  const path = join(dirname(row.root_path), "manifest.sqlite");
  const db = new SidecarDatabase(path, { readonly: true, fileMustExist: true });
  try {
    const check = db.prepare("PRAGMA quick_check").pluck().get();
    if (check !== "ok") throw new Error("SQLite quick_check failed");
    return db;
  } catch (error) {
    db.close();
    throw new FirmwareCacheError("MOUNT_INVALID", "The firmware sidecar is unavailable or corrupt.", { cause: error });
  }
}

export function listFirmwareMounts(deps: FirmwareUiDeps, input: PageInput) {
  const offset = parseOffset(input.continuation);
  const total = Number((deps.db.prepare(`SELECT COUNT(DISTINCT project_version_id) FROM firmware_mounts
    WHERE project_id = ?`).pluck().get(input.projectId) as number | bigint) ?? 0);
  const rows = deps.db.prepare(`SELECT mounts.* FROM firmware_mounts mounts
    WHERE mounts.project_id = ? AND mounts.generation_id = (
      SELECT candidate.generation_id FROM firmware_mounts candidate
      WHERE candidate.project_id = mounts.project_id
        AND candidate.project_version_id = mounts.project_version_id
      ORDER BY candidate.pulled_at DESC, candidate.generation_id DESC LIMIT 1
    )
    ORDER BY mounts.project_version_id LIMIT ? OFFSET ?`).all(
      input.projectId,
      input.pageSize,
      offset,
    ) as FirmwareMountRow[];
  return {
    items: rows.map((row) => ({
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      kind: "firmware-mount",
      key: row.project_version_id,
      label: row.project_version_id,
      fields: {
        source: row.source,
        state: row.state,
        files: row.file_count,
        materializedFiles: row.materialized_files,
        errors: row.error_count,
        inputSha256: row.input_sha256,
        artifactHash: row.artifact_hash,
      },
    })),
    total,
    next: nextOffset(offset, rows.length, total),
    cache: rows.length > 0 ? cacheFor(rows[0]!) : emptyCache,
  };
}

export async function getFirmwareStatusDetail(deps: FirmwareUiDeps, input: PageInput) {
  const pvId = requirePvId(input);
  const row = latestMount(deps, pvId);
  const status = await getFirmwareStatus(deps, pvId);
  return {
    projectId: input.projectId,
    projectVersionId: pvId,
    kind: "firmware-mount",
    key: pvId,
    label: pvId,
    fields: { ...status },
    links: [],
    cache: cacheFor(row),
  };
}

function errorList(value: string | null): string[] {
  if (value === null) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export function securityFeaturesFromRow(row: FirmwareNodeRow): Record<string, boolean | string> | null {
  const raw = row.security_features_json ?? row.security_features;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter((entry): entry is [string, boolean | string] =>
      typeof entry[1] === "boolean" || typeof entry[1] === "string");
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

export function listFirmwareTree(deps: FirmwareUiDeps, input: PageInput) {
  const pvId = requirePvId(input);
  const mount = latestMount(deps, pvId);
  if (!mount) return { items: [], total: 0, next: null, cache: emptyCache };
  const offset = parseOffset(input.continuation);
  const parent = input.firmwarePath ? normalizeVirtualPath(input.firmwarePath) : "/";
  const prefix = parent === "/" ? "/%" : `${parent}/%`;
  const sidecar = openSidecar(mount);
  try {
    const total = Number(sidecar.prepare("SELECT COUNT(*) FROM fs_node WHERE path LIKE ?").pluck().get(prefix));
    const rows = sidecar.prepare(`SELECT * FROM fs_node WHERE path LIKE ?
      ORDER BY path LIMIT ? OFFSET ?`).all(prefix, input.pageSize, offset) as FirmwareNodeRow[];
    return {
      items: rows.map((row) => ({
        projectId: input.projectId,
        projectVersionId: pvId,
        kind: `firmware-${row.kind}`,
        key: row.path.slice(1),
        label: row.path.split("/").at(-1) ?? row.path,
        fields: {
          firmwarePath: row.path.slice(1),
          nodeKind: row.kind,
          sha256: row.file_hash,
          size: row.size,
          mediaType: row.mime_type,
          fullType: row.full_type,
          materialized: row.materialized === 1,
          errors: errorList(row.errors),
        },
      })),
      total,
      next: nextOffset(offset, rows.length, total),
      cache: cacheFor(mount),
    };
  } finally {
    sidecar.close();
  }
}

function architectureFrom(bytes: Uint8Array | null, fullType: string | null): string | null {
  if (bytes && bytes.length >= 20 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    const little = bytes[5] === 1;
    const machine = little ? bytes[18]! | (bytes[19]! << 8) : (bytes[18]! << 8) | bytes[19]!;
    return ({ 3: "x86", 8: "MIPS", 20: "PowerPC", 40: "ARM", 62: "x86-64", 183: "AArch64", 243: "RISC-V" } as Record<number, string>)[machine] ?? `ELF machine ${machine}`;
  }
  return fullType?.match(/\b(?:x86-64|x86|aarch64|arm|mips|powerpc|risc-v)\b/iu)?.[0] ?? null;
}

export async function getFirmwareFile(deps: FirmwareUiDeps, input: PageInput & { firmwarePath: string; includePreview: boolean }) {
  const pvId = requirePvId(input);
  const mount = latestMount(deps, pvId);
  if (!mount) throw new FirmwareCacheError("MOUNT_MISSING", "Firmware has not been materialized.");
  const path = normalizeVirtualPath(input.firmwarePath);
  const sidecar = openSidecar(mount);
  let row: FirmwareNodeRow | undefined;
  try {
    row = sidecar.prepare("SELECT * FROM fs_node WHERE path = ?").get(path) as FirmwareNodeRow | undefined;
  } finally {
    sidecar.close();
  }
  if (!row || row.kind !== "file" || !row.file_hash) {
    throw new FirmwareCacheError("FIRMWARE_PATH_NOT_FOUND", "Firmware file metadata is unavailable.");
  }
  let preview: Uint8Array | null = null;
  if (input.includePreview && row.materialized === 1) {
    const filePath = await resolveSafeNodePath(mount.root_path, row.path);
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(256);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      preview = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  const securityFeatures = securityFeaturesFromRow(row);
  return {
    projectId: input.projectId,
    projectVersionId: pvId,
    firmwarePath: row.path.slice(1),
    fileSha256: row.file_hash,
    size: row.size,
    mediaType: row.mime_type ?? row.full_type,
    fields: {
      fullType: row.full_type,
      architecture: architectureFrom(preview, row.full_type),
      mode: row.unix_mode === null ? null : `0${row.unix_mode.toString(8)}`,
      uid: row.unix_uid,
      gid: row.unix_gid,
      setuid: row.is_setuid === 1,
      setgid: row.is_setgid === 1,
      securityFeatures,
      errors: errorList(row.errors),
    },
    previewHex: preview ? Buffer.from(preview).toString("hex") : null,
    previewBytes: preview?.byteLength ?? 0,
    materialized: row.materialized === 1,
    cache: cacheFor(mount),
  };
}
