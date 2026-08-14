import { randomUUID } from "node:crypto";
import type { BbPluginApi, JsonValue } from "@bb/plugin-sdk";
import type { ActionToolName } from "../../../lib/agentic/registry.js";
import { BENCH_CHANGED_CHANNEL } from "../registry/families.js";
import type { GatingDeps, ToolExecutionCtx } from "./mode.js";
import { DESTRUCTIVE_CONFIRMATION_RENDERER_ID } from "./destructive-contract.js";

export { DESTRUCTIVE_CONFIRMATION_RENDERER_ID } from "./destructive-contract.js";
export const DEFAULT_DESTRUCTIVE_GRANT_TTL_MS = 60_000;
export const HELPER_INSTALL_OPERATION = "benchDevHelperInstall" as const;

export type DestructiveOperationName =
  | ActionToolName
  | typeof HELPER_INSTALL_OPERATION;

export interface DestructiveGrant {
  grantId: string;
  threadId: string;
  toolName: DestructiveOperationName;
  deviceId: string;
  mintedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

const humanConfirmationEvidence = Symbol("HumanConfirmationEvidence");

export interface HumanConfirmationEvidence {
  readonly [humanConfirmationEvidence]: true;
  readonly confirmationId: string;
  readonly threadId: string;
  readonly toolName: typeof HELPER_INSTALL_OPERATION;
  readonly deviceId: string;
  readonly confirmedBy: string;
  readonly callerOrigin: "bb.ui.requestInput";
  readonly confirmedAt: string;
  readonly expiresAt: string;
}

export interface HumanConfirmationRequest {
  threadId: string;
  toolName: typeof HELPER_INSTALL_OPERATION;
  deviceId: string;
  title: string;
  detail: string;
  command: string | null;
  timeoutMs?: number;
}

export type DestructiveErrorCode =
  | "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE"
  | "DESTRUCTIVE_REQUIRES_GRANT"
  | "DESTRUCTIVE_CONFIRMATION_REJECTED";

export class DestructiveGateError extends Error {
  constructor(
    readonly code: DestructiveErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DestructiveGateError";
  }
}

interface GrantRow {
  grant_id: string;
  thread_id: string;
  tool_name: DestructiveOperationName;
  device_id: string;
  turn_id: string;
  minted_at: string;
  expires_at: string;
  consumed_at: string | null;
}

const initialized = new WeakSet<GatingDeps["db"]>();

function initialize(deps: GatingDeps): void {
  if (initialized.has(deps.db)) return;
  deps.db.exec(
    `CREATE TABLE IF NOT EXISTS bench_destructive_grant (
       grant_id TEXT PRIMARY KEY,
       thread_id TEXT NOT NULL,
       tool_name TEXT NOT NULL,
       device_id TEXT NOT NULL,
       turn_id TEXT NOT NULL,
       confirmation_id TEXT NOT NULL UNIQUE,
       confirmed_by TEXT NOT NULL,
       caller_origin TEXT NOT NULL CHECK (caller_origin = 'bb.ui.requestInput'),
       minted_at TEXT NOT NULL,
       expires_at TEXT NOT NULL,
       consumed_at TEXT
     )`,
  );
  deps.db.exec(
    `CREATE INDEX IF NOT EXISTS bench_destructive_grant_live_idx
       ON bench_destructive_grant(thread_id, tool_name, device_id, turn_id, expires_at)
       WHERE consumed_at IS NULL`,
  );
  initialized.add(deps.db);
}

function now(deps: GatingDeps): Date {
  return deps.now?.() ?? new Date();
}

function toGrant(row: GrantRow): DestructiveGrant {
  return {
    grantId: row.grant_id,
    threadId: row.thread_id,
    toolName: row.tool_name,
    deviceId: row.device_id,
    mintedAt: row.minted_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function submittedConfirmation(value: JsonValue): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "confirmed" in value &&
    value.confirmed === true
  );
}

export async function requestHumanConfirmation(
  bb: Pick<BbPluginApi, "ui">,
  deps: Pick<GatingDeps, "now">,
  request: HumanConfirmationRequest,
): Promise<HumanConfirmationEvidence> {
  if (request.toolName !== HELPER_INSTALL_OPERATION) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
      `${request.toolName} is refused because bb.ui.requestInput is not destructive-grade authorization evidence.`,
    );
  }
  if (request.threadId.trim().length === 0) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
      "A bb thread is required for server-issued human confirmation.",
    );
  }
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? DEFAULT_DESTRUCTIVE_GRANT_TTL_MS, 1_000),
    DEFAULT_DESTRUCTIVE_GRANT_TTL_MS,
  );
  const result = await bb.ui.requestInput({
    threadId: request.threadId,
    rendererId: DESTRUCTIVE_CONFIRMATION_RENDERER_ID,
    title: request.title,
    timeoutMs,
    payload: {
      operation: request.toolName,
      deviceId: request.deviceId,
      detail: request.detail,
      command: request.command,
    },
  });
  if (result.outcome !== "submitted" || !submittedConfirmation(result.value)) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_CONFIRMATION_REJECTED",
      "The human confirmation interaction was cancelled or rejected.",
    );
  }
  const confirmedAt = deps.now?.() ?? new Date();
  return Object.freeze({
    [humanConfirmationEvidence]: true as const,
    confirmationId: `confirmation-${randomUUID()}`,
    threadId: request.threadId,
    toolName: request.toolName,
    deviceId: request.deviceId,
    confirmedBy: `request-input-response:${request.threadId}:${randomUUID()}`,
    callerOrigin: "bb.ui.requestInput" as const,
    confirmedAt: confirmedAt.toISOString(),
    expiresAt: new Date(confirmedAt.getTime() + timeoutMs).toISOString(),
  });
}

export async function mintDestructiveGrant(
  deps: GatingDeps,
  human: HumanConfirmationEvidence,
  req: Omit<
    DestructiveGrant,
    "grantId" | "toolName" | "mintedAt" | "consumedAt"
  > & { toolName: typeof HELPER_INSTALL_OPERATION },
): Promise<DestructiveGrant> {
  if (
    human.toolName !== HELPER_INSTALL_OPERATION ||
    req.toolName !== HELPER_INSTALL_OPERATION
  ) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
      `${req.toolName} is refused because bb.ui.requestInput grants are limited to helper installation.`,
    );
  }
  if (
    human[humanConfirmationEvidence] !== true ||
    human.threadId !== req.threadId ||
    human.toolName !== req.toolName ||
    human.deviceId !== req.deviceId
  ) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_REQUIRES_GRANT",
      "Human confirmation evidence does not match this operation.",
    );
  }
  initialize(deps);
  const at = now(deps);
  const requestedExpiry = Date.parse(req.expiresAt);
  const evidenceExpiry = Date.parse(human.expiresAt);
  if (
    !Number.isFinite(requestedExpiry) ||
    requestedExpiry <= at.getTime() ||
    evidenceExpiry <= at.getTime()
  ) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_REQUIRES_GRANT",
      "Human confirmation has expired.",
    );
  }
  const grant: DestructiveGrant = {
    grantId: `destructive-${randomUUID()}`,
    threadId: req.threadId,
    toolName: req.toolName,
    deviceId: req.deviceId,
    mintedAt: at.toISOString(),
    expiresAt: new Date(
      Math.min(
        requestedExpiry,
        evidenceExpiry,
        at.getTime() + DEFAULT_DESTRUCTIVE_GRANT_TTL_MS,
      ),
    ).toISOString(),
    consumedAt: null,
  };
  deps.db
    .prepare(
      `INSERT INTO bench_destructive_grant (
       grant_id, thread_id, tool_name, device_id, turn_id, confirmation_id,
       confirmed_by, caller_origin, minted_at, expires_at, consumed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      grant.grantId,
      grant.threadId,
      grant.toolName,
      grant.deviceId,
      human.confirmationId,
      human.confirmationId,
      human.confirmedBy,
      human.callerOrigin,
      grant.mintedAt,
      grant.expiresAt,
    );
  deps.publish?.(BENCH_CHANGED_CHANNEL, {
    threadId: grant.threadId,
    deviceId: grant.deviceId,
    transition: "destructive-grant-minted",
  });
  return grant;
}

export async function consumeDestructiveGrant(
  deps: GatingDeps,
  toolName: DestructiveOperationName,
  deviceId: string,
  ctx: ToolExecutionCtx,
): Promise<DestructiveGrant> {
  initialize(deps);
  if (ctx.turnId === null) {
    throw new DestructiveGateError(
      "DESTRUCTIVE_AUTHORIZATION_UNAVAILABLE",
      `${toolName} is refused because the plugin cannot observe current-turn human instruction evidence.`,
    );
  }
  const turnId = ctx.turnId;
  const consumedAt = now(deps).toISOString();
  const transaction = deps.db.transaction((): DestructiveGrant => {
    const row = deps.db
      .prepare<[string, string, string, string, string], GrantRow>(
        `SELECT grant_id, thread_id, tool_name, device_id, turn_id,
              minted_at, expires_at, consumed_at
         FROM bench_destructive_grant
        WHERE thread_id = ? AND tool_name = ? AND device_id = ? AND turn_id = ?
          AND consumed_at IS NULL AND expires_at > ?
        ORDER BY minted_at DESC LIMIT 1`,
      )
      .get(ctx.threadId, toolName, deviceId, turnId, consumedAt);
    if (!row) {
      throw new DestructiveGateError(
        "DESTRUCTIVE_REQUIRES_GRANT",
        `${toolName} requires a live, single-use human confirmation for this turn and device.`,
      );
    }
    const changed = deps.db
      .prepare(
        `UPDATE bench_destructive_grant SET consumed_at = ?
        WHERE grant_id = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .run(consumedAt, row.grant_id, consumedAt).changes;
    if (changed !== 1) {
      throw new DestructiveGateError(
        "DESTRUCTIVE_REQUIRES_GRANT",
        "The destructive grant was already used.",
      );
    }
    return toGrant({ ...row, consumed_at: consumedAt });
  });
  const grant = transaction.immediate();
  deps.publish?.(BENCH_CHANGED_CHANNEL, {
    threadId: grant.threadId,
    deviceId: grant.deviceId,
    transition: "destructive-grant-consumed",
  });
  return grant;
}

export function destructiveGrantAudit(
  deps: GatingDeps,
  grantId: string,
): {
  grant: DestructiveGrant;
  confirmedBy: string;
  callerOrigin: "bb.ui.requestInput";
} | null {
  initialize(deps);
  const row = deps.db
    .prepare<
      [string],
      GrantRow & { confirmed_by: string; caller_origin: "bb.ui.requestInput" }
    >(
      `SELECT grant_id, thread_id, tool_name, device_id, turn_id, minted_at,
            expires_at, consumed_at, confirmed_by, caller_origin
       FROM bench_destructive_grant WHERE grant_id = ?`,
    )
    .get(grantId);
  return row
    ? {
        grant: toGrant(row),
        confirmedBy: row.confirmed_by,
        callerOrigin: row.caller_origin,
      }
    : null;
}
