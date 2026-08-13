import type Database from "better-sqlite3";
import type { BenchDeviceRecord, ClaimScope } from "./families.js";
import {
  getDevice,
  initializeRegistryStore,
  type RegistryScope,
} from "./store.js";

export const DEFAULT_CLAIM_TTL_MS = 15 * 60 * 1000;

export type DeviceClaimErrorCode =
  | "DEVICE_NOT_FOUND"
  | "DEVICE_CLAIMED"
  | "DEVICE_NOT_HELD"
  | "CLAIM_EXPIRED"
  | "CLAIM_DEVICE_MISMATCH"
  | "CLAIM_SCOPE_NOT_IMPLEMENTED";

export class DeviceClaimError extends Error {
  constructor(
    readonly code: DeviceClaimErrorCode,
    message: string,
    readonly holder: string | null = null,
  ) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.name = "DeviceClaimError";
  }
}

export interface ClaimOptions {
  now?: Date;
  ttlMs?: number;
  scope?: RegistryScope;
  claimScope?: ClaimScope;
}

/**
 * A caller-held reference to a machine-scoped registry claim.
 *
 * This is an identity reference, not an authorization token. Consumers must
 * call {@link verifyDeviceClaim} immediately before device I/O; WP-90 owns any
 * future unforgeable grant scheme.
 */
export interface DeviceClaim {
  readonly deviceId: string;
  readonly holder: string;
  readonly scope: ClaimScope;
  readonly expiresAt: string;
}

export interface ClaimResult {
  outcome: "claimed" | "released" | "already_free";
  device: BenchDeviceRecord;
  expiredHolders: string[];
}

interface ClaimRow {
  project_id: string;
  project_version_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_scope: ClaimScope;
}

interface HolderRow { claimed_by: string }
interface EventRow {
  device_id: string;
  holder: string;
  reason: "expired" | "released";
  occurred_at: string;
}

interface VerificationRow {
  claimed_by: string | null;
  claimed_at: string | null;
  claim_scope: ClaimScope;
  active: 0 | 1;
}

function nowIso(options: ClaimOptions): string {
  return (options.now ?? new Date()).toISOString();
}

function expirationCutoff(options: ClaimOptions): string {
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
  return new Date(now.getTime() - ttlMs).toISOString();
}

/**
 * Verifies current claim state without refreshing, expiring, or otherwise
 * mutating registry rows. Expiry remains an arbitration/sweeper write concern;
 * this read path computes liveness in SQLite.
 */
export function verifyDeviceClaim(
  db: Database.Database,
  claim: DeviceClaim,
  expectedDeviceId: string,
  options: Pick<ClaimOptions, "now" | "ttlMs"> = {},
): void {
  if (claim.deviceId !== expectedDeviceId) {
    throw new DeviceClaimError(
      "CLAIM_DEVICE_MISMATCH",
      `Claim for ${claim.deviceId} cannot open ${expectedDeviceId}.`,
      claim.holder,
    );
  }
  if (claim.scope !== "machine") {
    throw new DeviceClaimError(
      "CLAIM_SCOPE_NOT_IMPLEMENTED",
      "Only machine-scoped device claims are implemented in v1.",
      claim.holder,
    );
  }
  const now = options.now ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
  const rows = db.prepare<[number, string, string], VerificationRow>(
    `SELECT claimed_by, claimed_at, claim_scope,
            CASE
              WHEN claimed_at IS NOT NULL
               AND julianday(claimed_at) + (? / 86400000.0) > julianday(?)
              THEN 1 ELSE 0
            END AS active
       FROM bench_device
      WHERE device_id = ?
      ORDER BY project_id, project_version_id`,
  ).all(ttlMs, now.toISOString(), expectedDeviceId);
  if (rows.length === 0) {
    throw new DeviceClaimError(
      "DEVICE_NOT_FOUND",
      `Device ${expectedDeviceId} was not found.`,
    );
  }
  if (rows.some((row) => row.claim_scope !== "machine")) {
    throw new DeviceClaimError(
      "CLAIM_SCOPE_NOT_IMPLEMENTED",
      "Only machine-scoped device claims are implemented in v1.",
      claim.holder,
    );
  }
  const held = rows.find((row) => row.claimed_by === claim.holder);
  if (!held) {
    const activeHolder = rows.find((row) => row.claimed_by !== null)?.claimed_by ?? null;
    throw new DeviceClaimError(
      "DEVICE_NOT_HELD",
      activeHolder === null
        ? `Device ${expectedDeviceId} is not currently held.`
        : `Device ${expectedDeviceId} is held by ${activeHolder}, not ${claim.holder}.`,
      activeHolder,
    );
  }
  if (held.claimed_at === null || held.active !== 1) {
    throw new DeviceClaimError(
      "CLAIM_EXPIRED",
      `Claim for ${expectedDeviceId} held by ${claim.holder} has expired.`,
      claim.holder,
    );
  }
  const actualExpiresAt = new Date(
    new Date(held.claimed_at).getTime() + ttlMs,
  ).toISOString();
  if (claim.expiresAt !== actualExpiresAt) {
    throw new DeviceClaimError(
      "CLAIM_EXPIRED",
      `Claim expiry for ${expectedDeviceId} does not match current registry state.`,
      claim.holder,
    );
  }
}

function matchingRows(
  db: Database.Database,
  deviceId: string,
  scope: RegistryScope | undefined,
): ClaimRow[] {
  if (scope) {
    return db.prepare<[string, string | null, string], ClaimRow>(
      `SELECT project_id, project_version_id, claimed_by, claimed_at, claim_scope
         FROM bench_device
        WHERE project_id = ?
          AND project_version_id = coalesce(?, '@project')
          AND device_id = ?`,
    ).all(scope.projectId, scope.projectVersionId, deviceId);
  }
  return db.prepare<[string], ClaimRow>(
    `SELECT project_id, project_version_id, claimed_by, claimed_at, claim_scope
       FROM bench_device WHERE device_id = ?`,
  ).all(deviceId);
}

function arbitrationRows(db: Database.Database, deviceId: string): ClaimRow[] {
  return db.prepare<[string], ClaimRow>(
    `SELECT project_id, project_version_id, claimed_by, claimed_at, claim_scope
       FROM bench_device
      WHERE device_id = ? AND claim_scope = 'machine'`,
  ).all(deviceId);
}

function expireClaimInTransaction(
  db: Database.Database,
  deviceId: string,
  options: ClaimOptions,
): string[] {
  const expired = db.prepare<[string, string], HolderRow>(
    `SELECT DISTINCT claimed_by
       FROM bench_device
      WHERE device_id = ?
        AND claim_scope = 'machine'
        AND claimed_by IS NOT NULL
        AND claimed_at <= ?`,
  ).all(deviceId, expirationCutoff(options));
  if (expired.length === 0) return [];
  const at = nowIso(options);
  const insertEvent = db.prepare(
    `INSERT INTO bench_claim_event (device_id, holder, reason, occurred_at)
     VALUES (?, ?, 'expired', ?)`,
  );
  for (const row of expired) insertEvent.run(deviceId, row.claimed_by, at);
  db.prepare(
    `UPDATE bench_device SET claimed_by = NULL, claimed_at = NULL
      WHERE device_id = ? AND claim_scope = 'machine' AND claimed_at <= ?`,
  ).run(deviceId, expirationCutoff(options));
  return expired.map((row) => row.claimed_by);
}

function resolveResultDevice(
  db: Database.Database,
  deviceId: string,
  options: ClaimOptions,
): BenchDeviceRecord {
  if (options.scope) {
    const scoped = getDevice(db, options.scope, deviceId);
    if (scoped) return scoped;
  }
  const row = db.prepare<[string], { project_id: string; project_version_id: string }>(
    `SELECT project_id, project_version_id FROM bench_device
      WHERE device_id = ? ORDER BY project_id, project_version_id LIMIT 1`,
  ).get(deviceId);
  if (!row) throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
  const device = getDevice(db, {
    projectId: row.project_id,
    projectVersionId: row.project_version_id === "@project" ? null : row.project_version_id,
  }, deviceId);
  if (!device) throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
  return device;
}

export function claimDevice(
  db: Database.Database,
  deviceId: string,
  holder: string,
  options: ClaimOptions = {},
): ClaimResult {
  initializeRegistryStore(db);
  const transaction = db.transaction((): ClaimResult => {
    const scopedRows = matchingRows(db, deviceId, options.scope);
    if (scopedRows.length === 0) {
      throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
    }
    const claimScope = options.claimScope ?? scopedRows[0]!.claim_scope;
    if (claimScope !== "machine" || scopedRows.some((row) => row.claim_scope !== "machine")) {
      throw new DeviceClaimError(
        "CLAIM_SCOPE_NOT_IMPLEMENTED",
        "CLAIM_SCOPE_NOT_IMPLEMENTED: fleet-wide arbitration is represented but is not implemented in v1.",
      );
    }
    const expiredHolders = expireClaimInTransaction(db, deviceId, options);
    const activeHolder = arbitrationRows(db, deviceId)
      .find((row) => row.claimed_by !== null)?.claimed_by ?? null;
    if (activeHolder !== null) {
      throw new DeviceClaimError(
        "DEVICE_CLAIMED",
        `Device ${deviceId} is claimed by ${activeHolder}.`,
        activeHolder,
      );
    }
    const changed = db.prepare(
      `UPDATE bench_device SET claimed_by = ?, claimed_at = ?
        WHERE device_id = ? AND claim_scope = 'machine' AND claimed_by IS NULL`,
    ).run(holder, nowIso(options), deviceId).changes;
    if (changed === 0) {
      throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
    }
    return {
      outcome: "claimed",
      device: resolveResultDevice(db, deviceId, options),
      expiredHolders,
    };
  });
  return transaction.immediate();
}

export function refreshClaim(
  db: Database.Database,
  deviceId: string,
  holder: string,
  options: ClaimOptions = {},
): void {
  initializeRegistryStore(db);
  db.transaction(() => {
    const rows = matchingRows(db, deviceId, options.scope);
    if (rows.length === 0) {
      throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
    }
    expireClaimInTransaction(db, deviceId, options);
    const activeHolder = arbitrationRows(db, deviceId)
      .find((row) => row.claimed_by !== null)?.claimed_by ?? null;
    if (activeHolder !== holder) {
      throw new DeviceClaimError(
        "DEVICE_NOT_HELD",
        activeHolder === null
          ? `Device ${deviceId} is not currently held.`
          : `Device ${deviceId} is held by ${activeHolder}, not ${holder}.`,
        activeHolder,
      );
    }
    db.prepare(
      `UPDATE bench_device SET claimed_at = ?
        WHERE device_id = ? AND claim_scope = 'machine' AND claimed_by = ?`,
    ).run(nowIso(options), deviceId, holder);
  }).immediate();
}

export function releaseDevice(
  db: Database.Database,
  deviceId: string,
  holder: string,
  options: ClaimOptions = {},
): ClaimResult {
  initializeRegistryStore(db);
  const transaction = db.transaction((): ClaimResult => {
    const rows = matchingRows(db, deviceId, options.scope);
    if (rows.length === 0) {
      throw new DeviceClaimError("DEVICE_NOT_FOUND", `Device ${deviceId} was not found.`);
    }
    const expiredHolders = expireClaimInTransaction(db, deviceId, options);
    const activeHolder = arbitrationRows(db, deviceId)
      .find((row) => row.claimed_by !== null)?.claimed_by ?? null;
    if (activeHolder === null) {
      return {
        outcome: "already_free",
        device: resolveResultDevice(db, deviceId, options),
        expiredHolders,
      };
    }
    if (activeHolder !== holder) {
      throw new DeviceClaimError(
        "DEVICE_NOT_HELD",
        `Device ${deviceId} is held by ${activeHolder}, not ${holder}.`,
        activeHolder,
      );
    }
    const at = nowIso(options);
    db.prepare(
      `UPDATE bench_device SET claimed_by = NULL, claimed_at = NULL
        WHERE device_id = ? AND claim_scope = 'machine' AND claimed_by = ?`,
    ).run(deviceId, holder);
    db.prepare(
      `INSERT INTO bench_claim_event (device_id, holder, reason, occurred_at)
       VALUES (?, ?, 'released', ?)`,
    ).run(deviceId, holder, at);
    return {
      outcome: "released",
      device: resolveResultDevice(db, deviceId, options),
      expiredHolders,
    };
  });
  return transaction.immediate();
}

export function listClaimEvents(
  db: Database.Database,
  deviceId: string,
): EventRow[] {
  initializeRegistryStore(db);
  return db.prepare<[string], EventRow>(
    `SELECT device_id, holder, reason, occurred_at
       FROM bench_claim_event WHERE device_id = ? ORDER BY id`,
  ).all(deviceId);
}

export function expireClaims(
  db: Database.Database,
  options: Omit<ClaimOptions, "scope" | "claimScope"> = {},
): string[] {
  initializeRegistryStore(db);
  return db.transaction(() => {
    const devices = db.prepare<[string], { device_id: string }>(
      `SELECT DISTINCT device_id FROM bench_device
        WHERE claim_scope = 'machine' AND claimed_by IS NOT NULL AND claimed_at <= ?`,
    ).all(expirationCutoff(options));
    const expired: string[] = [];
    for (const device of devices) {
      if (expireClaimInTransaction(db, device.device_id, options).length > 0) {
        expired.push(device.device_id);
      }
    }
    return expired;
  }).immediate();
}
