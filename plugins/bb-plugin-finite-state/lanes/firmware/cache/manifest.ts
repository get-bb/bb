import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
  assertFirmwareCacheIgnored,
  FirmwareCacheError,
  manifestPath,
  mountRoot,
  validatePvId,
} from "./layout.js";
import { MANIFEST_MIGRATIONS } from "./manifest-schema.js";
import {
  inspectRegularFileEvidenceSync,
  normalizeVirtualPath,
  type RegularFileEvidence,
  verifyRegularFileIntegritySync,
} from "./path-safety.js";

export type MountSource = "standalone_unpack" | "api";
export type MountReadiness =
  | "missing"
  | "metadata_only"
  | "partial"
  | "fully_materialized"
  | "stale"
  | "invalid";

export interface FirmwareNode {
  path: string;
  kind: "file" | "directory" | "symlink";
  fileHash: string | null;
  size: number | null;
  mimeType: string | null;
  fullType: string | null;
  unixMode: number | null;
  unixUid?: number | null;
  unixGid?: number | null;
  isSetuid?: boolean;
  isSetgid?: boolean;
  symlinkTarget: string | null;
  materialized: boolean;
  errors: string[];
}

export interface FirmwareMount {
  pvId: string;
  source: MountSource;
  rootfsPath: string;
  manifestPath: string;
  inputSha256: string | null;
  artifactHash: string | null;
  readiness: MountReadiness;
  nodeCount: number;
  hydratedCount: number;
  errors: string[];
}

export interface FirmwareManifestMeta {
  pvId: string;
  scanId: string | null;
  inputSha256: string | null;
  source: MountSource;
  artifactHash: string | null;
  fullyMaterialized: boolean;
  materializedAt: string | null;
  nodeCount: number;
  hydratedCount: number;
  adminBytesOk: boolean | null;
  unpackErrors: string[];
  stale: boolean;
}

export type FirmwarePageMeta = Omit<FirmwareManifestMeta, "nodeCount" | "hydratedCount">;

interface MetaRow {
  key: string;
  value: string;
}

interface NodeRow {
  path: string;
  kind: FirmwareNode["kind"];
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
  verified_dev: string | null;
  verified_ino: string | null;
  verified_size: number | null;
  verified_mtime_ns: string | null;
  verified_ctime_ns: string | null;
}

interface IntegrityRow {
  path: string;
  file_hash: string | null;
  size: number | null;
  verified_dev: string | null;
  verified_ino: string | null;
  verified_size: number | null;
  verified_mtime_ns: string | null;
  verified_ctime_ns: string | null;
}

export interface FirmwareIntegrityVerification {
  verifiedFiles: number;
}

const INVALID_NODE_PREFIX = "/.__fs_invalid__";

const META_KEYS = {
  pvId: "pv_id",
  scanId: "scan_id",
  inputSha256: "input_sha256",
  source: "source",
  artifactHash: "artifact_hash",
  fullyMaterialized: "fully_materialized",
  materializedAt: "materialized_at",
  nodeCount: "node_count",
  hydratedCount: "hydrated_count",
  adminBytesOk: "admin_bytes_ok",
  unpackErrors: "unpack_errors",
  stale: "stale",
} as const;

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new FirmwareCacheError("MOUNT_INVALID", `Invalid ${label} JSON in manifest.`, {
      cause: error,
    });
  }
}

function serializeNode(node: FirmwareNode): NodeRow {
  const path = normalizeVirtualPath(node.path);
  if (path === INVALID_NODE_PREFIX || path.startsWith(`${INVALID_NODE_PREFIX}/`)) {
    throw new FirmwareCacheError(
      "UNSAFE_FIRMWARE_PATH",
      "The reserved invalid-node namespace cannot be supplied by firmware input.",
    );
  }
  if (node.kind === "file") {
    if (node.symlinkTarget !== null) {
      throw new FirmwareCacheError("INVALID_MANIFEST_NODE", "Regular files cannot have symlink targets.");
    }
    if (node.materialized && !/^[a-f0-9]{64}$/u.test(node.fileHash ?? "")) {
      throw new FirmwareCacheError(
        "INVALID_MANIFEST_NODE",
        "A materialized regular file requires a verified SHA-256 digest.",
      );
    }
    if (node.fileHash !== null && !/^[a-f0-9]{64}$/u.test(node.fileHash)) {
      throw new FirmwareCacheError(
        "INVALID_MANIFEST_NODE",
        "Regular-file hashes must be lowercase SHA-256 digests.",
      );
    }
  } else if (node.fileHash !== null || node.materialized || node.size !== null) {
    throw new FirmwareCacheError(
      "INVALID_MANIFEST_NODE",
      "Directories and symlinks cannot claim regular-file bytes.",
    );
  }
  if (node.kind === "symlink" && node.symlinkTarget === null) {
    throw new FirmwareCacheError("INVALID_MANIFEST_NODE", "Symlink nodes require a target.");
  }
  if (!Number.isInteger(node.size ?? 0) || (node.size ?? 0) < 0) {
    throw new FirmwareCacheError("INVALID_MANIFEST_NODE", "Firmware node sizes must be nonnegative integers.");
  }

  return {
    path,
    kind: node.kind,
    file_hash: node.kind === "file" ? node.fileHash : null,
    size: node.kind === "file" ? node.size : null,
    mime_type: node.mimeType,
    full_type: node.fullType,
    unix_mode: node.unixMode,
    unix_uid: node.unixUid ?? null,
    unix_gid: node.unixGid ?? null,
    is_setuid: node.isSetuid ? 1 : 0,
    is_setgid: node.isSetgid ? 1 : 0,
    symlink_target: node.kind === "symlink" ? node.symlinkTarget : null,
    materialized: node.kind === "file" && node.materialized ? 1 : 0,
    errors: JSON.stringify(node.errors),
    verified_dev: null,
    verified_ino: null,
    verified_size: null,
    verified_mtime_ns: null,
    verified_ctime_ns: null,
  };
}

function invalidPathRow(node: FirmwareNode, error: FirmwareCacheError): NodeRow {
  const digest = createHash("sha256")
    .update(node.path)
    .update("\0")
    .update(node.kind)
    .digest("hex");
  return {
    path: `${INVALID_NODE_PREFIX}/${digest}`,
    kind: "file",
    file_hash: null,
    size: null,
    mime_type: node.mimeType,
    full_type: node.fullType,
    unix_mode: node.unixMode,
    unix_uid: node.unixUid ?? null,
    unix_gid: node.unixGid ?? null,
    is_setuid: 0,
    is_setgid: 0,
    symlink_target: null,
    materialized: 0,
    errors: JSON.stringify([
      ...node.errors,
      `${error.code}: ${error.message} Source path: ${JSON.stringify(node.path)}`,
    ]),
    verified_dev: null,
    verified_ino: null,
    verified_size: null,
    verified_mtime_ns: null,
    verified_ctime_ns: null,
  };
}

function serializeIngestedNode(node: FirmwareNode): NodeRow {
  try {
    return serializeNode(node);
  } catch (error) {
    if (error instanceof FirmwareCacheError && error.code === "UNSAFE_FIRMWARE_PATH") {
      return invalidPathRow(node, error);
    }
    throw error;
  }
}

function deserializeNode(row: NodeRow): FirmwareNode {
  const errors = row.errors === null ? [] : parseJson<string[]>(row.errors, `errors for ${row.path}`);
  if (!Array.isArray(errors) || errors.some((error) => typeof error !== "string")) {
    throw new FirmwareCacheError("MOUNT_INVALID", `Invalid errors for ${row.path}.`);
  }
  return {
    path: row.path,
    kind: row.kind,
    fileHash: row.file_hash,
    size: row.size,
    mimeType: row.mime_type,
    fullType: row.full_type,
    unixMode: row.unix_mode,
    unixUid: row.unix_uid,
    unixGid: row.unix_gid,
    isSetuid: row.is_setuid === 1,
    isSetgid: row.is_setgid === 1,
    symlinkTarget: row.symlink_target,
    materialized: row.materialized === 1,
    errors,
  };
}

export class FirmwareManifest {
  readonly path: string;
  readonly existedAtOpen: boolean;
  readonly invalidReason: string | null;
  readonly #db: Database.Database | null;

  constructor(path: string, existedAtOpen: boolean, db: Database.Database | null, invalidReason: string | null) {
    this.path = path;
    this.existedAtOpen = existedAtOpen;
    this.#db = db;
    this.invalidReason = invalidReason;
  }

  get database(): Database.Database {
    if (!this.#db || this.invalidReason) {
      throw new FirmwareCacheError("MOUNT_INVALID", this.invalidReason ?? "Manifest is unavailable.");
    }
    return this.#db;
  }

  close(): void {
    this.#db?.close();
  }

  readMeta(): FirmwareManifestMeta | null {
    if (!this.#db || this.invalidReason) return null;
    const rows = this.#db.prepare("SELECT key, value FROM fs_meta").all() as MetaRow[];
    if (rows.length === 0) return null;
    const values = new Map(rows.map((row) => [row.key, row.value]));
    const get = (key: string): unknown => {
      const value = values.get(key);
      if (value === undefined) throw new FirmwareCacheError("MOUNT_INVALID", `Missing manifest metadata: ${key}.`);
      return parseJson<unknown>(value, key);
    };
    const meta = {
      pvId: get(META_KEYS.pvId),
      scanId: get(META_KEYS.scanId),
      inputSha256: get(META_KEYS.inputSha256),
      source: get(META_KEYS.source),
      artifactHash: get(META_KEYS.artifactHash),
      fullyMaterialized: get(META_KEYS.fullyMaterialized),
      materializedAt: get(META_KEYS.materializedAt),
      nodeCount: get(META_KEYS.nodeCount),
      hydratedCount: get(META_KEYS.hydratedCount),
      adminBytesOk: get(META_KEYS.adminBytesOk),
      unpackErrors: get(META_KEYS.unpackErrors),
      stale: values.has(META_KEYS.stale) ? get(META_KEYS.stale) : false,
    };
    if (
      typeof meta.pvId !== "string" ||
      (meta.source !== "standalone_unpack" && meta.source !== "api") ||
      typeof meta.fullyMaterialized !== "boolean" ||
      typeof meta.nodeCount !== "number" ||
      !Number.isInteger(meta.nodeCount) ||
      meta.nodeCount < 0 ||
      typeof meta.hydratedCount !== "number" ||
      !Number.isInteger(meta.hydratedCount) ||
      meta.hydratedCount < 0 ||
      meta.hydratedCount > meta.nodeCount ||
      (meta.scanId !== null && typeof meta.scanId !== "string") ||
      (meta.inputSha256 !== null &&
        (typeof meta.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(meta.inputSha256))) ||
      (meta.artifactHash !== null && typeof meta.artifactHash !== "string") ||
      (meta.materializedAt !== null && typeof meta.materializedAt !== "string") ||
      (meta.adminBytesOk !== null && typeof meta.adminBytesOk !== "boolean") ||
      !Array.isArray(meta.unpackErrors) ||
      meta.unpackErrors.some((error) => typeof error !== "string") ||
      typeof meta.stale !== "boolean"
    ) {
      throw new FirmwareCacheError("MOUNT_INVALID", "Manifest metadata has invalid types.");
    }
    return meta as FirmwareManifestMeta;
  }

  writeMeta(meta: FirmwareManifestMeta): void {
    validatePvId(meta.pvId);
    if (meta.hydratedCount > meta.nodeCount || meta.nodeCount < 0 || meta.hydratedCount < 0) {
      throw new FirmwareCacheError("INVALID_MANIFEST_META", "Manifest counts are inconsistent.");
    }
    if (meta.inputSha256 !== null && !/^[a-f0-9]{64}$/u.test(meta.inputSha256)) {
      throw new FirmwareCacheError("INVALID_MANIFEST_META", "Input digest must be lowercase SHA-256.");
    }
    const entries = Object.entries(META_KEYS).map(([property, key]) => [
      key,
      JSON.stringify(meta[property as keyof FirmwareManifestMeta]),
    ] as const);
    const insert = this.database.prepare(
      "INSERT INTO fs_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    this.database.transaction(() => {
      for (const [key, value] of entries) insert.run(key, value);
    })();
  }

  upsertNodes(nodes: readonly FirmwareNode[]): void {
    const rows = nodes.map(serializeIngestedNode);
    const statement = this.database.prepare(`INSERT INTO fs_node (
      path, kind, file_hash, size, mime_type, full_type, unix_mode, unix_uid, unix_gid,
      is_setuid, is_setgid, symlink_target, materialized, errors,
      verified_dev, verified_ino, verified_size, verified_mtime_ns, verified_ctime_ns
    ) VALUES (
      @path, @kind, @file_hash, @size, @mime_type, @full_type, @unix_mode, @unix_uid, @unix_gid,
      @is_setuid, @is_setgid, @symlink_target, @materialized, @errors,
      @verified_dev, @verified_ino, @verified_size, @verified_mtime_ns, @verified_ctime_ns
    ) ON CONFLICT(path) DO UPDATE SET
      kind=excluded.kind, file_hash=excluded.file_hash, size=excluded.size,
      mime_type=excluded.mime_type, full_type=excluded.full_type, unix_mode=excluded.unix_mode,
      unix_uid=excluded.unix_uid, unix_gid=excluded.unix_gid, is_setuid=excluded.is_setuid,
      is_setgid=excluded.is_setgid, symlink_target=excluded.symlink_target,
      materialized=excluded.materialized, errors=excluded.errors,
      verified_dev=NULL, verified_ino=NULL, verified_size=NULL,
      verified_mtime_ns=NULL, verified_ctime_ns=NULL`);
    this.database.transaction(() => {
      for (const row of rows) statement.run(row);
    })();
  }

  replaceNodes(nodes: readonly FirmwareNode[], meta: FirmwareManifestMeta): void {
    const rows = nodes.map(serializeIngestedNode);
    const paths = new Set(rows.map((row) => row.path));
    if (paths.size !== rows.length) {
      throw new FirmwareCacheError("INVALID_MANIFEST_NODE", "A manifest batch contains duplicate paths.");
    }
    const fileCount = rows.filter((row) => row.kind === "file").length;
    const hydratedCount = rows.filter((row) => row.kind === "file" && row.materialized === 1).length;
    if (meta.nodeCount !== rows.length || meta.hydratedCount !== hydratedCount) {
      throw new FirmwareCacheError("INVALID_MANIFEST_META", "Manifest metadata does not match the node batch.");
    }
    if (meta.fullyMaterialized && hydratedCount !== fileCount) {
      throw new FirmwareCacheError(
        "INVALID_MANIFEST_META",
        "A fully materialized manifest must hydrate every regular file.",
      );
    }
    this.database.transaction(() => {
      this.database.prepare("DELETE FROM fs_node").run();
      this.upsertNodes(nodes);
      this.writeMeta(meta);
    })();
  }

  ingestPage(nodes: readonly FirmwareNode[], pageMeta: FirmwarePageMeta): void {
    this.database.transaction(() => {
      this.upsertNodes(nodes);
      const counts = this.counts();
      if (pageMeta.fullyMaterialized && counts.hydrated !== counts.files) {
        throw new FirmwareCacheError(
          "INVALID_MANIFEST_META",
          "A completed paged ingest must hydrate every regular file.",
        );
      }
      this.writeMeta({
        ...pageMeta,
        nodeCount: counts.nodes,
        hydratedCount: counts.hydrated,
      });
    })();
  }

  getNode(path: string): FirmwareNode | null {
    const row = this.database
      .prepare("SELECT * FROM fs_node WHERE path = ?")
      .get(normalizeVirtualPath(path)) as NodeRow | undefined;
    return row ? deserializeNode(row) : null;
  }

  listNodes(): FirmwareNode[] {
    return (this.database.prepare("SELECT * FROM fs_node ORDER BY path").all() as NodeRow[]).map(
      deserializeNode,
    );
  }

  counts(): { nodes: number; files: number; hydrated: number; errors: number } {
    const row = this.database.prepare(`SELECT
      COUNT(*) AS nodes,
      SUM(CASE WHEN kind = 'file' THEN 1 ELSE 0 END) AS files,
      SUM(CASE WHEN kind = 'file' AND materialized = 1 THEN 1 ELSE 0 END) AS hydrated,
      SUM(CASE WHEN errors IS NOT NULL AND errors <> '[]' THEN 1 ELSE 0 END) AS errors
      FROM fs_node`).get() as { nodes: number; files: number | null; hydrated: number | null; errors: number | null };
    return {
      nodes: row.nodes,
      files: row.files ?? 0,
      hydrated: row.hydrated ?? 0,
      errors: row.errors ?? 0,
    };
  }

  integrityRows(): IntegrityRow[] {
    return this.database
      .prepare(`SELECT path, file_hash, size, verified_dev, verified_ino, verified_size,
        verified_mtime_ns, verified_ctime_ns
        FROM fs_node WHERE kind = 'file' AND materialized = 1 ORDER BY path`)
      .all() as IntegrityRow[];
  }

  replaceIntegrityEvidence(evidence: ReadonlyMap<string, RegularFileEvidence>): void {
    const clear = this.database.prepare(`UPDATE fs_node SET
      verified_dev = NULL, verified_ino = NULL, verified_size = NULL,
      verified_mtime_ns = NULL, verified_ctime_ns = NULL
      WHERE kind = 'file' AND materialized = 1`);
    const update = this.database.prepare(`UPDATE fs_node SET
      verified_dev = @device, verified_ino = @inode, verified_size = @size,
      verified_mtime_ns = @mtimeNs, verified_ctime_ns = @ctimeNs
      WHERE path = @path AND kind = 'file' AND materialized = 1`);
    this.database.transaction(() => {
      clear.run();
      for (const [path, item] of evidence) update.run({ path, ...item });
    })();
  }

  markIntegrityFailure(path: string): void {
    this.replaceIntegrityEvidence(new Map());
    this.database
      .prepare(`UPDATE fs_node SET
        verified_dev = '', verified_ino = '', verified_size = -1,
        verified_mtime_ns = '', verified_ctime_ns = ''
        WHERE path = ? AND kind = 'file' AND materialized = 1`)
      .run(path);
  }
}

function migrateManifest(db: Database.Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS _fs_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT id FROM _fs_migrations").all() as Array<{ id: number }>).map((row) => row.id),
  );
  const apply = db.transaction(() => {
    for (const [id, migration] of MANIFEST_MIGRATIONS.entries()) {
      if (applied.has(id)) continue;
      db.exec(migration);
      db.prepare("INSERT INTO _fs_migrations(id, applied_at) VALUES (?, ?)").run(
        id,
        new Date().toISOString(),
      );
    }
  });
  apply();
}

export function openManifest(worktreeRoot: string, pvId: string): FirmwareManifest {
  const root = assertFirmwareCacheIgnored(worktreeRoot);
  const safePvId = validatePvId(pvId);
  const path = manifestPath(root, safePvId);
  const existedAtOpen = existsSync(path);
  mkdirSync(mountRoot(root, safePvId), { recursive: true, mode: 0o700 });
  let db: Database.Database | null = null;
  try {
    db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    migrateManifest(db);
    const check = db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (check.quick_check !== "ok") {
      throw new FirmwareCacheError("MOUNT_INVALID", `SQLite quick_check failed: ${check.quick_check}`);
    }
    return new FirmwareManifest(path, existedAtOpen, db, null);
  } catch (error) {
    db?.close();
    return new FirmwareManifest(
      path,
      existedAtOpen,
      null,
      error instanceof Error ? error.message : "Manifest could not be opened.",
    );
  }
}

function evidenceState(manifest: FirmwareManifest): "current" | "missing" | "stale" {
  const rootfs = join(dirname(manifest.path), "rootfs");
  let missing = false;
  for (const row of manifest.integrityRows()) {
    const current = inspectRegularFileEvidenceSync(rootfs, row.path, row.size);
    if (!current) return "stale";
    if (
      row.verified_dev === null ||
      row.verified_ino === null ||
      row.verified_size === null ||
      row.verified_mtime_ns === null ||
      row.verified_ctime_ns === null
    ) {
      missing = true;
      continue;
    }
    if (
      current.device !== row.verified_dev ||
      current.inode !== row.verified_ino ||
      current.size !== row.verified_size ||
      current.mtimeNs !== row.verified_mtime_ns ||
      current.ctimeNs !== row.verified_ctime_ns
    ) {
      return "stale";
    }
  }
  return missing ? "missing" : "current";
}

export function verifyMountIntegrity(manifest: FirmwareManifest): FirmwareIntegrityVerification {
  const rootfs = join(dirname(manifest.path), "rootfs");
  const evidence = new Map<string, RegularFileEvidence>();
  for (const row of manifest.integrityRows()) {
    if (!row.file_hash) {
      manifest.markIntegrityFailure(row.path);
      throw new FirmwareCacheError(
        "INCOHERENT_FIRMWARE_MOUNT",
        `Materialized file has no digest: ${row.path}`,
      );
    }
    const verified = verifyRegularFileIntegritySync(rootfs, row.path, row.file_hash, row.size);
    if (!verified) {
      manifest.markIntegrityFailure(row.path);
      throw new FirmwareCacheError(
        "INCOHERENT_FIRMWARE_MOUNT",
        `Materialized bytes do not match the sidecar: ${row.path}`,
      );
    }
    evidence.set(row.path, verified);
  }
  manifest.replaceIntegrityEvidence(evidence);
  return { verifiedFiles: evidence.size };
}

export function getMountReadiness(manifest: FirmwareManifest): MountReadiness {
  if (manifest.invalidReason) return "invalid";
  try {
    const meta = manifest.readMeta();
    if (!meta) return "missing";
    if (meta.stale) return "stale";
    const counts = manifest.counts();
    if (
      meta.nodeCount !== counts.nodes ||
      meta.hydratedCount !== counts.hydrated ||
      counts.hydrated > counts.files
    ) {
      return "invalid";
    }
    const hasErrors = meta.unpackErrors.length > 0 || counts.errors > 0;
    const integrity = evidenceState(manifest);
    if (integrity === "stale") return "invalid";
    if (
      meta.fullyMaterialized &&
      integrity === "current" &&
      counts.hydrated === counts.files &&
      !hasErrors &&
      meta.adminBytesOk !== false
    ) {
      return "fully_materialized";
    }
    if (counts.hydrated === 0) return "metadata_only";
    return "partial";
  } catch {
    return "invalid";
  }
}
