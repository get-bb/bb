import type Database from "better-sqlite3";
import {
  claimDevice,
  DEFAULT_CLAIM_TTL_MS,
  releaseDevice,
  verifyDeviceClaim,
  type DeviceClaim,
} from "../registry/claims.js";
import { BENCH_CHANGED_CHANNEL } from "../registry/families.js";

export const DEFAULT_DEBUG_MODE_TTL_MS = 10 * 60 * 1000;

export interface GatingDeps {
  db: Database.Database;
  sessionId: string;
  now?(): Date;
  debugModeTtlMs?: number;
  claimTtlMs?: number;
  publish?(channel: typeof BENCH_CHANGED_CHANNEL, payload: unknown): void;
}

export interface ToolExecutionCtx {
  threadId: string;
  turnId: string | null;
}

export interface DebugModeState {
  threadId: string;
  enteredAt: string;
  claims: DeviceClaim[];
  expiresAt: string;
}

export type DebugModeErrorCode = "DEBUG_MODE_REQUIRED" | "DEBUG_MODE_EXPIRED";

export class DebugModeError extends Error {
  readonly instruction = "Enter debug mode and claim the required devices before using instrument tools.";

  constructor(readonly code: DebugModeErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "DebugModeError";
  }
}

interface DebugModeRow {
  thread_id: string;
  entered_at: string;
  claims_json: string;
  expires_at: string;
}

const initialized = new WeakSet<Database.Database>();

function initialize(db: Database.Database): void {
  if (initialized.has(db)) return;
  db.exec(
    `CREATE TABLE IF NOT EXISTS bench_debug_mode (
       thread_id TEXT PRIMARY KEY,
       entered_at TEXT NOT NULL,
       claims_json TEXT NOT NULL,
       expires_at TEXT NOT NULL
     )`,
  );
  initialized.add(db);
}

function now(deps: GatingDeps): Date {
  return deps.now?.() ?? new Date();
}

function parseClaims(value: string): DeviceClaim[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error("INVALID_DEBUG_MODE_STATE");
  return parsed.map((claim): DeviceClaim => {
    if (
      typeof claim !== "object" || claim === null ||
      !("deviceId" in claim) || typeof claim.deviceId !== "string" ||
      !("holder" in claim) || typeof claim.holder !== "string" ||
      !("scope" in claim) || claim.scope !== "machine" ||
      !("expiresAt" in claim) || typeof claim.expiresAt !== "string"
    ) {
      throw new Error("INVALID_DEBUG_MODE_STATE");
    }
    return {
      deviceId: claim.deviceId,
      holder: claim.holder,
      scope: claim.scope,
      expiresAt: claim.expiresAt,
    };
  });
}

function toState(row: DebugModeRow): DebugModeState {
  return {
    threadId: row.thread_id,
    enteredAt: row.entered_at,
    claims: parseClaims(row.claims_json),
    expiresAt: row.expires_at,
  };
}

function readState(deps: GatingDeps, threadId: string): DebugModeState | null {
  initialize(deps.db);
  const row = deps.db.prepare<[string], DebugModeRow>(
    `SELECT thread_id, entered_at, claims_json, expires_at
       FROM bench_debug_mode WHERE thread_id = ?`,
  ).get(threadId);
  return row ? toState(row) : null;
}

function publish(deps: GatingDeps, threadId: string, transition: "entered" | "exited" | "expired"): void {
  deps.publish?.(BENCH_CHANGED_CHANNEL, { threadId, transition });
}

function releaseClaims(deps: GatingDeps, state: DebugModeState): void {
  for (const claim of [...state.claims].reverse()) {
    releaseDevice(deps.db, claim.deviceId, claim.holder, {
      now: now(deps),
      ttlMs: deps.claimTtlMs,
    });
  }
}

export async function enterDebugMode(
  deps: GatingDeps,
  threadId: string,
  deviceIds: string[],
): Promise<DebugModeState> {
  initialize(deps.db);
  const uniqueDeviceIds = [...new Set(deviceIds)];
  if (threadId.trim().length === 0 || uniqueDeviceIds.length !== deviceIds.length) {
    throw new Error("INVALID_DEBUG_MODE_REQUEST");
  }
  const at = now(deps);
  const current = readState(deps, threadId);
  if (current && Date.parse(current.expiresAt) > at.getTime()) {
    const currentIds = current.claims.map((claim) => claim.deviceId);
    if (
      currentIds.length === uniqueDeviceIds.length &&
      currentIds.every((deviceId) => uniqueDeviceIds.includes(deviceId))
    ) {
      for (const claim of current.claims) {
        verifyDeviceClaim(deps.db, claim, claim.deviceId, {
          now: at,
          ttlMs: deps.claimTtlMs,
        });
      }
      return current;
    }
    await exitDebugMode(deps, threadId);
  } else if (current) {
    releaseClaims(deps, current);
    deps.db.prepare("DELETE FROM bench_debug_mode WHERE thread_id = ?").run(threadId);
    publish(deps, threadId, "expired");
  }

  const claims: DeviceClaim[] = [];
  try {
    for (const deviceId of uniqueDeviceIds) {
      const result = claimDevice(deps.db, deviceId, threadId, {
        now: at,
        ttlMs: deps.claimTtlMs,
      });
      const claimedAt = result.device.claimedAt;
      if (claimedAt === null) throw new Error("DEVICE_CLAIM_STATE_MISSING");
      claims.push({
        deviceId,
        holder: threadId,
        scope: "machine",
        expiresAt: new Date(
          Date.parse(claimedAt) + (deps.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS),
        ).toISOString(),
      });
    }
  } catch (error) {
    for (const claim of [...claims].reverse()) {
      releaseDevice(deps.db, claim.deviceId, claim.holder, { now: at, ttlMs: deps.claimTtlMs });
    }
    throw error;
  }
  const state: DebugModeState = {
    threadId,
    enteredAt: at.toISOString(),
    claims,
    expiresAt: new Date(at.getTime() + (deps.debugModeTtlMs ?? DEFAULT_DEBUG_MODE_TTL_MS)).toISOString(),
  };
  deps.db.prepare(
    `INSERT INTO bench_debug_mode (thread_id, entered_at, claims_json, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(state.threadId, state.enteredAt, JSON.stringify(state.claims), state.expiresAt);
  publish(deps, threadId, "entered");
  return state;
}

export async function exitDebugMode(deps: GatingDeps, threadId: string): Promise<void> {
  const state = readState(deps, threadId);
  if (!state) return;
  releaseClaims(deps, state);
  deps.db.prepare("DELETE FROM bench_debug_mode WHERE thread_id = ?").run(threadId);
  publish(deps, threadId, "exited");
}

export async function requireDebugMode(
  deps: GatingDeps,
  ctx: ToolExecutionCtx,
): Promise<DebugModeState> {
  const state = readState(deps, ctx.threadId);
  if (!state) {
    throw new DebugModeError("DEBUG_MODE_REQUIRED", "Instrument access is disabled outside debug mode.");
  }
  const at = now(deps);
  if (Date.parse(state.expiresAt) <= at.getTime()) {
    releaseClaims(deps, state);
    deps.db.prepare("DELETE FROM bench_debug_mode WHERE thread_id = ?").run(ctx.threadId);
    publish(deps, ctx.threadId, "expired");
    throw new DebugModeError("DEBUG_MODE_EXPIRED", "Debug mode expired and its device claims were released.");
  }
  for (const claim of state.claims) {
    verifyDeviceClaim(deps.db, claim, claim.deviceId, {
      now: at,
      ttlMs: deps.claimTtlMs,
    });
  }
  return state;
}
