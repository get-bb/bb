import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import {
  fromStorageProjectVersionId,
  toStorageProjectVersionId,
} from "../../../lib/store/index.js";
import type {
  BenchDeviceRecord,
  ClaimScope,
  DeviceCandidate,
  DeviceKind,
  DeviceTransport,
  FamilyStatus,
} from "./families.js";

export { BENCH_CHANGED_CHANNEL } from "./families.js";
export const DEFAULT_DEVICE_PAGE_SIZE = 50;
export const MAX_DEVICE_PAGE_SIZE = 200;

const REGISTRY_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS bench_registry_family (
     project_id TEXT NOT NULL,
     project_version_id TEXT NOT NULL,
     family_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     availability TEXT NOT NULL CHECK (availability IN ('available','unavailable')),
     reason TEXT,
     helper_id TEXT NOT NULL,
     helper_name TEXT NOT NULL,
     helper_source TEXT NOT NULL,
     helper_why TEXT NOT NULL,
     needs_configuration INTEGER NOT NULL CHECK (needs_configuration IN (0,1)),
     checked_at TEXT NOT NULL,
     PRIMARY KEY (project_id, project_version_id, family_id)
   )`,
  `CREATE TABLE IF NOT EXISTS bench_claim_event (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     device_id TEXT NOT NULL,
     holder TEXT NOT NULL,
     reason TEXT NOT NULL CHECK (reason IN ('expired','released')),
     occurred_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS bench_helper_install (
     proposal_token TEXT PRIMARY KEY,
     family_id TEXT NOT NULL,
     helper_id TEXT NOT NULL,
     helper_name TEXT NOT NULL,
     source TEXT NOT NULL,
     why TEXT NOT NULL,
     command_json TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('proposed','installing','installed','failed')),
     confirmed_by TEXT,
     message TEXT,
     proposed_at TEXT NOT NULL,
     completed_at TEXT
   )`,
] as const;

export function initializeRegistryStore(db: Database.Database): void {
  db.pragma("busy_timeout = 5000");
  db.transaction(() => {
    for (const statement of REGISTRY_MIGRATIONS) db.exec(statement);
  })();
}

export interface RegistryScope {
  projectId: string;
  projectVersionId: string | null;
}

interface BenchDeviceRow {
  project_id: string;
  project_version_id: string;
  device_id: string;
  kind: DeviceKind;
  make: string | null;
  model: string | null;
  connection: string | null;
  transport: DeviceTransport;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_scope: ClaimScope;
  last_seen: string;
  stale: 0 | 1;
}

interface CountRow { count: number }

interface CursorValue { kind: DeviceKind; deviceId: string }

function isDeviceKind(value: unknown): value is DeviceKind {
  return value === "probe" || value === "logic" || value === "power" ||
    value === "scope" || value === "serial";
}

export interface DevicePageQuery extends RegistryScope {
  pageSize?: number;
  cursor?: string | null;
  kinds?: readonly DeviceKind[];
  includeStale?: boolean;
  activeClaimCutoff?: string;
}

export interface DevicePage {
  items: BenchDeviceRecord[];
  total: number;
  cursor: string | null;
}

function clampPageSize(pageSize = DEFAULT_DEVICE_PAGE_SIZE): number {
  return Math.max(1, Math.min(MAX_DEVICE_PAGE_SIZE, Math.trunc(pageSize)));
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): CursorValue | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null) {
      const kind: unknown = Reflect.get(parsed, "kind");
      const deviceId: unknown = Reflect.get(parsed, "deviceId");
      if (isDeviceKind(kind) && typeof deviceId === "string") {
        return { kind, deviceId };
      }
    }
  } catch {
    // Converted to the stable public error below.
  }
  throw new Error("INVALID_DEVICE_CURSOR");
}

export function stableDeviceId(familyId: string, stableIdentity: string): string {
  const normalized = stableIdentity.trim().toLocaleLowerCase("en-US");
  const digest = createHash("sha256")
    .update(familyId)
    .update("\0")
    .update(normalized)
    .digest("hex")
    .slice(0, 32);
  return `${familyId}:${digest}`;
}

export function normalizedConnectionIdentity(connection: string): string {
  return connection.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function rowToRecord(row: BenchDeviceRow, activeClaimCutoff?: string): BenchDeviceRecord {
  if (row.connection === null) throw new Error(`DEVICE_CONNECTION_MISSING:${row.device_id}`);
  const claimIsActive = activeClaimCutoff === undefined ||
    (row.claimed_at !== null && row.claimed_at > activeClaimCutoff);
  return {
    projectId: row.project_id,
    projectVersionId: fromStorageProjectVersionId(row.project_version_id),
    deviceId: row.device_id,
    kind: row.kind,
    make: row.make,
    model: row.model,
    connection: row.connection,
    transport: row.transport,
    claimedBy: claimIsActive ? row.claimed_by : null,
    claimedAt: claimIsActive ? row.claimed_at : null,
    claimScope: row.claim_scope,
    lastSeen: row.last_seen,
    stale: row.stale === 1,
  };
}

export function upsertCandidate(
  db: Database.Database,
  scope: RegistryScope,
  familyId: string,
  kind: DeviceKind,
  candidate: DeviceCandidate,
  seenAt: string,
  claimScope: ClaimScope = "machine",
): BenchDeviceRecord {
  initializeRegistryStore(db);
  const deviceId = stableDeviceId(familyId, candidate.stableIdentity);
  const projectVersionId = toStorageProjectVersionId(scope.projectVersionId);
  db.prepare(
    `INSERT INTO bench_device (
       project_id, project_version_id, device_id, kind, make, model, connection,
       transport, claimed_by, claimed_at, claim_scope, last_seen
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
     ON CONFLICT(project_id, project_version_id, device_id) DO UPDATE SET
       kind = excluded.kind,
       make = excluded.make,
       model = excluded.model,
       connection = excluded.connection,
       transport = excluded.transport,
       last_seen = excluded.last_seen
     WHERE excluded.last_seen >= bench_device.last_seen`,
  ).run(
    scope.projectId,
    projectVersionId,
    deviceId,
    kind,
    candidate.make,
    candidate.model,
    candidate.connection,
    candidate.transport,
    claimScope,
    seenAt,
  );
  const record = getDevice(db, scope, deviceId);
  if (!record) throw new Error(`DEVICE_UPSERT_FAILED:${deviceId}`);
  return record;
}

export function recordFamilyStatus(
  db: Database.Database,
  scope: RegistryScope,
  status: FamilyStatus,
): void {
  initializeRegistryStore(db);
  db.prepare(
    `INSERT INTO bench_registry_family (
       project_id, project_version_id, family_id, kind, label, availability,
       reason, helper_id, helper_name, helper_source, helper_why,
       needs_configuration, checked_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, project_version_id, family_id) DO UPDATE SET
       kind = excluded.kind,
       label = excluded.label,
       availability = excluded.availability,
       reason = excluded.reason,
       helper_id = excluded.helper_id,
       helper_name = excluded.helper_name,
       helper_source = excluded.helper_source,
       helper_why = excluded.helper_why,
       needs_configuration = excluded.needs_configuration,
       checked_at = excluded.checked_at
     WHERE excluded.checked_at >= bench_registry_family.checked_at`,
  ).run(
    scope.projectId,
    toStorageProjectVersionId(scope.projectVersionId),
    status.familyId,
    status.kind,
    status.label,
    status.availability,
    status.reason,
    status.helper.id,
    status.helper.displayName,
    status.helper.source,
    status.helper.why,
    status.needsConfiguration ? 1 : 0,
    status.checkedAt,
  );
}

interface FamilyStatusRow {
  family_id: string;
  kind: DeviceKind;
  label: string;
  availability: "available" | "unavailable";
  reason: string | null;
  helper_id: string;
  helper_name: string;
  helper_source: string;
  helper_why: string;
  needs_configuration: 0 | 1;
  checked_at: string;
}

export function listFamilyStatuses(
  db: Database.Database,
  scope: RegistryScope,
): FamilyStatus[] {
  return db.prepare<[string, string], FamilyStatusRow>(
    `SELECT family_id, kind, label, availability, reason, helper_id,
            helper_name, helper_source, helper_why, needs_configuration, checked_at
       FROM bench_registry_family
      WHERE project_id = ? AND project_version_id = ?
      ORDER BY kind, family_id`,
  ).all(scope.projectId, toStorageProjectVersionId(scope.projectVersionId)).map((row) => ({
    familyId: row.family_id,
    kind: row.kind,
    label: row.label,
    availability: row.availability,
    reason: row.reason,
    helper: {
      id: row.helper_id,
      displayName: row.helper_name,
      source: row.helper_source,
      why: row.helper_why,
    },
    needsConfiguration: row.needs_configuration === 1,
    checkedAt: row.checked_at,
  }));
}

const STALE_SQL = `EXISTS (
  SELECT 1 FROM bench_registry_family f
   WHERE f.project_id = d.project_id
     AND f.project_version_id = d.project_version_id
     AND f.family_id = substr(d.device_id, 1, instr(d.device_id, ':') - 1)
     AND (f.availability != 'available' OR f.checked_at > d.last_seen)
)`;

export function listDevices(db: Database.Database, query: DevicePageQuery): DevicePage {
  const limit = clampPageSize(query.pageSize);
  const cursor = decodeCursor(query.cursor);
  const kinds = [...(query.kinds ?? [])];
  const where = ["d.project_id = ?", "d.project_version_id = ?"];
  const params: Array<string | number> = [
    query.projectId,
    toStorageProjectVersionId(query.projectVersionId),
  ];
  if (kinds.length > 0) {
    where.push(`d.kind IN (${kinds.map(() => "?").join(",")})`);
    params.push(...kinds);
  }
  if (query.includeStale === false) where.push(`NOT ${STALE_SQL}`);
  const count = db.prepare<(string | number)[], CountRow>(
    `SELECT count(*) AS count FROM bench_device d WHERE ${where.join(" AND ")}`,
  ).get(...params)?.count ?? 0;
  if (cursor) {
    where.push("(d.kind > ? OR (d.kind = ? AND d.device_id > ?))");
    params.push(cursor.kind, cursor.kind, cursor.deviceId);
  }
  const rows = db.prepare<(string | number)[], BenchDeviceRow>(
    `SELECT d.*, CASE WHEN ${STALE_SQL} THEN 1 ELSE 0 END AS stale
       FROM bench_device d
      WHERE ${where.join(" AND ")}
      ORDER BY d.kind, d.device_id
      LIMIT ?`,
  ).all(...params, limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => rowToRecord(row, query.activeClaimCutoff)),
    total: count,
    cursor: hasMore && last
      ? encodeCursor({ kind: last.kind, deviceId: last.device_id })
      : null,
  };
}

export function getDevice(
  db: Database.Database,
  scope: RegistryScope,
  deviceId: string,
): BenchDeviceRecord | null {
  const row = db.prepare<[string, string, string], BenchDeviceRow>(
    `SELECT d.*, CASE WHEN ${STALE_SQL} THEN 1 ELSE 0 END AS stale
       FROM bench_device d
      WHERE d.project_id = ? AND d.project_version_id = ? AND d.device_id = ?`,
  ).get(scope.projectId, toStorageProjectVersionId(scope.projectVersionId), deviceId);
  return row ? rowToRecord(row) : null;
}
