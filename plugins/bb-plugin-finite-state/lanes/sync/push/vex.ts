import type Database from "better-sqlite3";

import { RemoteLimiter } from "../../../lib/remote/rate-limit.js";
import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_RESUMABLE_CHUNK_SIZE,
  VEX_STATUSES,
  type PlatformClient,
  type VexDecisionInput,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { canonicalJson } from "../serialize/canonical.js";
import { BaseSnapshotStore } from "../store/base-snapshot.js";
import { projectVexDecision } from "../entities/vex-decision.js";
import type { PlanItem } from "../plan/index.js";
import { assertPusherItem } from "./pushers.js";
import { intendedPayload } from "./read-back.js";
import {
  PushExecutionError,
  type ApplyResult,
  type EntityPusher,
  type PushContext,
  type PushErrorDetail,
  type ReadBackResult,
} from "./types.js";

interface FindingRow {
  findingId: string;
  projectVersionId: string;
}

export interface VexBatchApplyOutcome {
  item: PlanItem;
  result: ApplyResult | null;
  error: (PushErrorDetail & { requiresPull?: boolean }) | null;
}

export interface VexBatchPusher extends EntityPusher {
  readonly kind: "vexDecision";
  applyBatch(items: readonly PlanItem[], context: PushContext): Promise<VexBatchApplyOutcome[]>;
}

export interface VexPusherOptions {
  db: Database.Database;
  client: Pick<PlatformClient, "batchSetVexStatus" | "clearVexStatus" | "getFindingDetail">;
  limiter: RemoteLimiter;
  maxConcurrency?: number;
}

interface PendingItem {
  item: PlanItem;
  rows: FindingRow[];
  payload: Record<string, unknown> | null;
  error: (PushErrorDetail & { requiresPull?: boolean }) | null;
}

interface SetRow {
  owner: PendingItem;
  row: FindingRow;
  input: VexDecisionInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseFindingRow(value: unknown): FindingRow {
  if (
    !isRecord(value)
    || typeof value["finding_id"] !== "string"
    || typeof value["project_version_id"] !== "string"
  ) {
    throw new Error("Cached finding target is corrupt");
  }
  return { findingId: value["finding_id"], projectVersionId: value["project_version_id"] };
}

function findingRows(
  db: Database.Database,
  projectId: string,
  projectVersionId: string,
  stableKey: string,
): FindingRow[] {
  return db.prepare(
    `SELECT finding.finding_id, finding.project_version_id
       FROM findings finding
       JOIN sync_state state
         ON state.project_id = finding.project_id
        AND state.project_version_id = finding.project_version_id
        AND state.entity_kind = 'finding'
        AND state.accepted_generation_id = finding.generation_id
      WHERE finding.project_id = ? AND finding.project_version_id = ?
        AND finding.stable_key = ?
      ORDER BY finding.finding_id`,
  ).all(projectId, projectVersionId, stableKey).map(parseFindingRow);
}

function chunks<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += VEX_RESUMABLE_CHUNK_SIZE) {
    result.push(values.slice(index, index + VEX_RESUMABLE_CHUNK_SIZE));
  }
  return result;
}

function stringField(payload: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = payload[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new PushExecutionError("VEX_PAYLOAD_INVALID", `VEX ${field} must be a string or null`);
  }
  return value;
}

function isVexStatus(value: string): value is VexStatus {
  return VEX_STATUSES.some((candidate) => candidate === value);
}

function isVexResponse(value: string): value is VexResponse {
  return VEX_RESPONSES.some((candidate) => candidate === value);
}

function isVexJustification(value: string): value is VexJustification {
  return VEX_JUSTIFICATIONS.some((candidate) => candidate === value);
}

function statusField(payload: Readonly<Record<string, unknown>>): VexStatus | null {
  const value = stringField(payload, "status");
  if (value === null || isVexStatus(value)) return value;
  throw new PushExecutionError("VEX_PAYLOAD_INVALID", "VEX status is outside the frozen vocabulary");
}

function responseField(payload: Readonly<Record<string, unknown>>): VexResponse | null {
  const value = stringField(payload, "response");
  if (value === null || isVexResponse(value)) return value;
  throw new PushExecutionError("VEX_PAYLOAD_INVALID", "VEX response is outside the frozen vocabulary");
}

function justificationField(payload: Readonly<Record<string, unknown>>): VexJustification | null {
  const value = stringField(payload, "justification");
  if (value === null || isVexJustification(value)) return value;
  throw new PushExecutionError("VEX_PAYLOAD_INVALID", "VEX justification is outside the frozen vocabulary");
}

/** Adds provenance without truncating an unverified server limit or dropping rationale. */
export function prefixVexReason(runId: string, reason: string | null): string {
  const prefix = `[bb:${runId}]`;
  if (reason === null || reason.trim().length === 0) return prefix;
  return reason.startsWith(`${prefix} `) || reason === prefix
    ? reason
    : `${prefix} ${reason}`;
}

function withoutRunPrefix(runId: string, reason: unknown): unknown {
  if (typeof reason !== "string") return reason;
  const prefix = `[bb:${runId}]`;
  if (reason === prefix) return null;
  return reason.startsWith(`${prefix} `) ? reason.slice(prefix.length + 1) : reason;
}

function setInput(payload: Readonly<Record<string, unknown>>, findingId: string, runId: string): VexDecisionInput {
  const status = statusField(payload);
  if (status === null) {
    throw new PushExecutionError("VEX_STATUS_REQUIRED", "A set VEX decision requires status");
  }
  const response = responseField(payload);
  const justification = justificationField(payload);
  const reason = stringField(payload, "reason");
  return {
    findingId,
    status,
    ...(response === null ? {} : { response }),
    ...(justification === null ? {} : { justification }),
    reason: prefixVexReason(runId, reason),
  };
}

function safeRemoteMessage(value: string | null): string {
  if (value === null || value.trim().length === 0) return "Platform rejected the VEX decision";
  return value.replace(/https?:\/\/\S+/gu, "[url]").slice(0, 500);
}

function pendingItems(options: VexPusherOptions, items: readonly PlanItem[], context: PushContext): PendingItem[] {
  const projectVersionId = context.scope.projectVersionId;
  if (projectVersionId === null) {
    throw new PushExecutionError("VEX_SCOPE_INVALID", "VEX decisions require a project version");
  }
  const baseStore = new BaseSnapshotStore(options.db);
  return items.map((item) => {
    const base = baseStore.getAccepted(context.scope.projectId, projectVersionId, item.kind, item.key);
    const rows = findingRows(options.db, context.scope.projectId, projectVersionId, item.key);
    return {
      item,
      rows,
      payload: intendedPayload(item, base),
      error: rows.length === 0 ? {
        code: "VEX_TARGET_NOT_FOUND",
        message: `No accepted finding row resolves ${item.key}`,
        retryable: false,
      } : null,
    };
  });
}

function setFailure(
  owner: PendingItem,
  error: PushErrorDetail & { requiresPull?: boolean },
): void {
  owner.error ??= error;
}

async function applySetRows(
  options: VexPusherOptions,
  values: readonly SetRow[],
  context: PushContext,
): Promise<void> {
  const projectVersionId = context.scope.projectVersionId;
  if (projectVersionId === null) throw new Error("VEX project version disappeared");
  for (const chunk of chunks(values)) {
    const response = await options.limiter.run(() => options.client.batchSetVexStatus({
      projectVersionId,
      findings: chunk.map((entry) => entry.input),
    }, { signal: context.signal }), context.signal, "platform");
    if (response.results.length !== chunk.length) {
      for (const requested of chunk) {
        setFailure(requested.owner, {
          code: "VEX_RESULT_MISSING",
          message: "Platform did not return one ordered outcome per VEX row",
          retryable: false,
          requiresPull: true,
        });
      }
      continue;
    }
    for (let index = 0; index < chunk.length; index += 1) {
      const result = response.results[index];
      const requested = chunk[index];
      if (result === undefined || requested === undefined) throw new Error("VEX chunk indexing failed");
      if (result.findingId !== requested.input.findingId) {
        setFailure(requested.owner, {
          code: "VEX_RESULT_MISMATCH",
          message: `Platform returned a misaligned outcome for finding ${requested.row.findingId}`,
          retryable: false,
          requiresPull: true,
        });
        continue;
      }
      if (!result.success) {
        setFailure(requested.owner, {
          code: "VEX_ITEM_FAILED",
          message: safeRemoteMessage(result.error),
          retryable: true,
        });
      } else if (result.status !== requested.input.status) {
        setFailure(requested.owner, {
          code: "VEX_RESULT_MISMATCH",
          message: `Platform reported a different status for finding ${requested.row.findingId}`,
          retryable: false,
        });
      }
    }
  }
}

async function applyClearRows(
  options: VexPusherOptions,
  values: readonly PendingItem[],
  context: PushContext,
): Promise<void> {
  const projectVersionId = context.scope.projectVersionId;
  if (projectVersionId === null) throw new Error("VEX project version disappeared");
  const rows = values.flatMap((owner) => owner.rows.map((row) => ({ owner, row })));
  for (const chunk of chunks(rows)) {
    await options.limiter.run(() => options.client.clearVexStatus({
      projectVersionId,
      findingIds: chunk.map((entry) => entry.row.findingId),
    }, { signal: context.signal }), context.signal, "platform");
  }
}

/** Creates the only bulk pusher; its own row chunks never exceed 500. */
export function createVexPusher(options: VexPusherOptions): VexBatchPusher {
  const pusher: VexBatchPusher = {
    kind: "vexDecision",
    maxConcurrency: options.maxConcurrency ?? 1,
    async apply(item, context): Promise<ApplyResult> {
      const outcome = (await pusher.applyBatch([item], context))[0];
      if (outcome?.result !== null && outcome?.result !== undefined) return outcome.result;
      const error = outcome?.error ?? {
        code: "VEX_ITEM_FAILED",
        message: `VEX apply produced no outcome for ${item.key}`,
        retryable: false,
      };
      throw new PushExecutionError(error.code, error.message, error.retryable);
    },
    async applyBatch(items, context): Promise<VexBatchApplyOutcome[]> {
      for (const item of items) assertPusherItem(pusher, item, context);
      const pending = pendingItems(options, items, context);
      const setRows: SetRow[] = [];
      const clears: PendingItem[] = [];
      for (const owner of pending) {
        if (owner.error !== null) continue;
        if (owner.item.operation === "delete") {
          clears.push(owner);
          continue;
        }
        if (owner.payload === null) {
          setFailure(owner, {
            code: "VEX_PAYLOAD_MISSING",
            message: `VEX ${owner.item.key} has no intended decision payload`,
            retryable: false,
          });
          continue;
        }
        for (const row of owner.rows) {
          setRows.push({
            owner,
            row,
            input: setInput(owner.payload, row.findingId, context.runId),
          });
        }
      }
      await applySetRows(options, setRows, context);
      await applyClearRows(options, clears, context);
      return pending.map((owner) => ({
        item: owner.item,
        result: owner.error === null ? {
          remoteId: owner.rows.length === 1 ? owner.rows[0]?.findingId ?? null : null,
          serverPayload: owner.payload,
          verification: "required",
        } : null,
        error: owner.error,
      }));
    },
    async readBack(item, context): Promise<ReadBackResult> {
      assertPusherItem(pusher, item, context);
      const projectVersionId = context.scope.projectVersionId;
      if (projectVersionId === null) {
        throw new PushExecutionError("VEX_SCOPE_INVALID", "VEX decisions require a project version");
      }
      const rows = findingRows(options.db, context.scope.projectId, projectVersionId, item.key);
      if (rows.length === 0) {
        throw new PushExecutionError(
          "VEX_TARGET_NOT_FOUND",
          `No accepted finding row resolves ${item.key}`,
          false,
          true,
        );
      }
      const payloads: Record<string, unknown>[] = [];
      for (const row of rows) {
        const detail = await options.limiter.run(() => options.client.getFindingDetail({
          projectVersionId,
          findingId: row.findingId,
        }, { signal: context.signal }), context.signal, "platform");
        const projected = projectVexDecision(detail);
        if (projected !== null) {
          if (projected.key !== item.key) {
            throw new PushExecutionError(
              "VEX_TARGET_MOVED",
              `Finding ${row.findingId} no longer has the planned stable identity`,
              false,
              true,
            );
          }
          payloads.push({
            ...projected.payload,
            reason: withoutRunPrefix(context.runId, projected.payload["reason"]),
          });
        }
      }
      if (payloads.length === 0) return { exists: false, remoteId: null, payload: null };
      if (
        payloads.length !== rows.length
        || payloads.some((payload) => canonicalJson(payload) !== canonicalJson(payloads[0]))
      ) {
        throw new PushExecutionError(
          "VEX_READ_BACK_INCONSISTENT",
          `Finding rows for ${item.key} do not share one VEX tuple`,
          false,
          true,
        );
      }
      return {
        exists: true,
        remoteId: rows.length === 1 ? rows[0]?.findingId ?? null : null,
        payload: payloads[0] ?? null,
      };
    },
  };
  return pusher;
}

export function isVexBatchPusher(value: EntityPusher): value is VexBatchPusher {
  return value.kind === "vexDecision" && "applyBatch" in value && typeof value.applyBatch === "function";
}
