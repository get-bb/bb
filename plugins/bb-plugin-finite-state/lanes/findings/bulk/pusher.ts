import type Database from "better-sqlite3";

import { systemScheduler, type Scheduler } from "../../../lib/remote/rate-limit.js";
import {
  RemoteError,
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
  type Json,
  type PlatformClient,
  type VexDecisionInput,
  type VexJustification,
  type VexResponse,
  type VexStatus,
} from "../../../lib/remote/types.js";
import { BaseSnapshotStore } from "../../sync/store/base-snapshot.js";
import { registeredResolver } from "../../sync/engine/adapter.js";
import type { PlanItem } from "../../sync/plan/index.js";
import { canonicalJson } from "../../sync/serialize/canonical.js";
import { intendedPayload } from "../../sync/push/read-back.js";
import { assertPusherItem, registerTypedPusher } from "../../sync/push/pushers.js";
import {
  PushExecutionError,
  type ApplyResult,
  type PushContext as SyncPushContext,
  type ReadBackResult,
} from "../../sync/push/types.js";
import type { VexBatchApplyOutcome, VexBatchPusher } from "../../sync/push/vex.js";
import { enforcePin, resolveFinding, type Pin, type StableFindingKey } from "../stable-key/index.js";
import type { VexTuple } from "../overlay/schema.js";
import { chunkVexTargets, type VexBulkTarget } from "./chunk.js";
import { consumeSetEnvelope, VexItemAccumulator, type VexApplyError, type VexApplyResult } from "./results.js";
import {
  detailMatchesStableKey,
  getTargetDetails,
  identityFromStableKey,
  sameVexTuple,
  stampVexReason,
  tupleFromDetail,
} from "./readback.js";

const PROGRESS_TARGET_INTERVAL = 500;
const RATE_LIMIT_ATTEMPTS = 6;
const RATE_LIMIT_MIN_DELAY_MS = 250;
const RATE_LIMIT_JITTER_MS = 250;

export interface VexBulkProgress {
  runId: string;
  completed: number;
  total: number;
}

export interface VexBulkDependencies {
  db: Database.Database;
  platform: Pick<PlatformClient, "batchSetVexStatus" | "clearVexStatus" | "getFindings">;
  publish(progress: VexBulkProgress): void;
  scheduler?: Scheduler;
  random?: () => number;
}

export interface PushContext extends SyncPushContext, VexBulkDependencies {}

interface OverlayGuardRow {
  pin: string | null;
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  local_state: string;
}

interface PreparedItem {
  item: PlanItem;
  tuple: VexTuple | null;
  targets: VexBulkTarget[];
  accumulator: VexItemAccumulator;
}

function isStatus(value: string | null): value is VexStatus {
  return value !== null && VEX_STATUSES.some((candidate) => candidate === value);
}

function isResponse(value: string | null): value is VexResponse | null {
  return value === null || VEX_RESPONSES.some((candidate) => candidate === value);
}

function isJustification(value: string | null): value is VexJustification | null {
  return value === null || VEX_JUSTIFICATIONS.some((candidate) => candidate === value);
}

function tupleFromPayload(payload: Readonly<Record<string, unknown>>): VexTuple {
  const status = payload["status"] ?? null;
  const response = payload["response"] ?? null;
  const justification = payload["justification"] ?? null;
  const reason = payload["reason"] ?? null;
  if (
    (status !== null && typeof status !== "string")
    || (response !== null && typeof response !== "string")
    || (justification !== null && typeof justification !== "string")
    || (reason !== null && typeof reason !== "string")
    || !isStatus(status)
    || !isResponse(response)
    || !isJustification(justification)
  ) {
    throw new PushExecutionError("VEX_PAYLOAD_INVALID", "Validated VEX plan payload is outside the frozen vocabulary");
  }
  return { status, response, justification, reason };
}

function overlayGuard(
  db: Database.Database,
  item: PlanItem,
  tuple: VexTuple,
): { pin: Pin } {
  const row = db.prepare(
    `SELECT pin, vex_status, vex_response, vex_justification, vex_reason, local_state
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?`,
  ).get(item.projectId, item.projectVersionId, item.key) as OverlayGuardRow | undefined;
  if (row === undefined) {
    throw new PushExecutionError("VEX_APPLY_GUARD_MISSING", `Authored VEX guard is missing for ${item.key}`);
  }
  if (row.local_state !== "dirty") {
    throw new PushExecutionError("VEX_APPLY_GUARD_STATE", `Authored VEX guard is ${row.local_state}, not dirty`);
  }
  const projected: VexTuple = {
    status: isStatus(row.vex_status) ? row.vex_status : null,
    response: isResponse(row.vex_response) ? row.vex_response : null,
    justification: isJustification(row.vex_justification) ? row.vex_justification : null,
    reason: row.vex_reason,
  };
  if (canonicalJson(projected) !== canonicalJson(tuple)) {
    throw new PushExecutionError("VEX_APPLY_GUARD_CHANGED", `Authored VEX tuple changed after planning for ${item.key}`);
  }
  if (row.pin !== "exact_version" && row.pin !== "any_version") {
    throw new PushExecutionError("VEX_APPLY_GUARD_INVALID", `Authored VEX pin is invalid for ${item.key}`);
  }
  try {
    return { pin: enforcePin({ pin: row.pin, justification: tuple.justification }) };
  } catch (error: unknown) {
    throw new PushExecutionError(
      "VEX_EXACT_VERSION_REQUIRED",
      error instanceof Error ? error.message : "CODE_NOT_REACHABLE requires exact-version pinning",
    );
  }
}

function assertApplicable(item: PlanItem): void {
  if (item.error !== null) throw new PushExecutionError("VEX_PLAN_INVALID", `VEX plan item ${item.key} has a validation error`);
  if (item.operation !== "create" && item.operation !== "update" && item.operation !== "delete") {
    throw new PushExecutionError("VEX_PLAN_INVALID", `VEX ${item.operation} item cannot be applied`);
  }
  if (item.conflicts.some((conflict) => conflict.resolution === null)) {
    throw new PushExecutionError("VEX_CONFLICT_UNRESOLVED", `VEX plan item ${item.key} has unresolved conflicts`);
  }
}

function stableFindingKey(projectId: string, stableKey: string): StableFindingKey {
  const parsed = identityFromStableKey(projectId, stableKey);
  return {
    schema: "fs-finding-key/v1",
    project: projectId,
    cve: parsed.identity.cve,
    purl: parsed.identity.purl ?? null,
    name: parsed.identity.name,
    group: parsed.identity.group ?? null,
    version: parsed.identity.version ?? null,
  };
}

function errorDetail(error: unknown, fallbackCode: string, fallbackRetryable = true): VexApplyError {
  if (error instanceof RemoteError) {
    return {
      code: error.code,
      message: error.message.slice(0, 300),
      retryable: error.status === 429 || error.retryable || error.code === "REMOTE_WRITE_INDETERMINATE",
    };
  }
  if (error instanceof PushExecutionError) {
    return { code: error.code, message: error.message.slice(0, 300), retryable: error.retryable };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message.slice(0, 300) : "VEX operation failed",
    retryable: fallbackRetryable,
  };
}

async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  scheduler: Scheduler,
  random: () => number,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        !(error instanceof RemoteError)
        || (error.status !== 429 && error.code !== "REMOTE_RATE_LIMITED")
        || attempt >= RATE_LIMIT_ATTEMPTS
      ) {
        throw error;
      }
      const requested = error.retryAfterMs ?? 1_000 * 2 ** (attempt - 1);
      const delay = Math.min(
        Math.max(RATE_LIMIT_MIN_DELAY_MS, requested) + Math.floor(random() * RATE_LIMIT_JITTER_MS),
        64_000,
      );
      await scheduler.sleep(delay, signal);
    }
  }
}

function prepareItem(context: PushContext, item: PlanItem): PreparedItem {
  const baseStore = new BaseSnapshotStore(context.db);
  if (item.projectId !== context.scope.projectId || item.projectVersionId !== context.scope.projectVersionId) {
    throw new PushExecutionError("VEX_SCOPE_INVALID", `VEX plan item ${item.key} is outside the push scope`);
  }
  assertApplicable(item);
  if (item.projectVersionId === null) {
    throw new PushExecutionError("VEX_SCOPE_INVALID", "VEX decisions require a project version");
  }
  const base = baseStore.getAccepted(item.projectId, item.projectVersionId, item.kind, item.key);
  const intended = intendedPayload(item, base);
  const tuple = intended === null ? null : tupleFromPayload(intended);
  if (tuple !== null) {
    try {
      stampVexReason(context.runId, tuple.reason);
    } catch (error: unknown) {
      throw new PushExecutionError(
        "VEX_REASON_TOO_LONG",
        error instanceof Error ? error.message : "VEX reason cannot carry required provenance",
      );
    }
  }
  const pin = tuple === null
    ? identityFromStableKey(item.projectId, item.key).tier === "name-group-any-version" ? "any_version" : "exact_version"
    : overlayGuard(context.db, item, tuple).pin;
  const resolution = resolveFinding(context.db, stableFindingKey(item.projectId, item.key), item.projectVersionId, pin);
  if (resolution.state !== "resolved" || (pin === "exact_version" && resolution.versionChanged)) {
    const state = resolution.state === "orphaned" ? "orphaned" : "stale";
    const accumulator = new VexItemAccumulator(item.key, []);
    accumulator.setTerminal(state, {
      code: state === "orphaned" ? "VEX_ORPHANED" : "VEX_STALE",
      message: state === "orphaned"
        ? `No current finding resolves ${item.key}`
        : `Exact-version finding identity changed for ${item.key}`,
      retryable: false,
    });
    return { item, tuple, targets: [], accumulator };
  }
  const findingIds = resolution.rows.map((row) => row.findingId);
  const accumulator = new VexItemAccumulator(item.key, findingIds);
  const pvId = item.projectVersionId;
  const targets = findingIds.map((findingId): VexBulkTarget => tuple === null
    ? { pvId, findingId, stableKey: item.key, action: "clear" }
    : { pvId, findingId, stableKey: item.key, action: "set", tuple });
  return { item, tuple, targets, accumulator };
}

function prepareItems(context: PushContext, items: readonly PlanItem[]): PreparedItem[] {
  return items.map((item) => {
    try {
      return prepareItem(context, item);
    } catch (error: unknown) {
      const accumulator = new VexItemAccumulator(item.key, []);
      accumulator.failItem(errorDetail(error, "VEX_PREPARE_FAILED", false));
      return { item, tuple: null, targets: [], accumulator };
    }
  });
}

function rejectContendedTargets(prepared: readonly PreparedItem[]): void {
  const claims = new Map<string, PreparedItem[]>();
  for (const owner of prepared) {
    if (owner.accumulator.terminal !== null || owner.accumulator.hasErrors) continue;
    for (const target of owner.targets) {
      const key = `${target.pvId}\0${target.findingId}`;
      const owners = claims.get(key) ?? [];
      owners.push(owner);
      claims.set(key, owners);
    }
  }
  for (const [claimKey, owners] of claims) {
    const distinct = [...new Map(owners.map((owner) => [owner.item.key, owner])).values()];
    if (distinct.length < 2) continue;
    for (const owner of distinct) {
      const siblings = distinct.filter((candidate) => candidate !== owner).map((candidate) => candidate.item.key);
      const target = owner.targets.find((candidate) => `${candidate.pvId}\0${candidate.findingId}` === claimKey);
      if (target === undefined) continue;
      owner.accumulator.markFailed(target.findingId, {
        code: "VEX_TARGET_CONTENDED",
        message: `Finding ${target.findingId} is also targeted by ${siblings.join(", ")}`.slice(0, 300),
        retryable: false,
      });
    }
  }
}

function detailsByPv(prepared: readonly PreparedItem[], state: "pending" | "provisional"): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const owner of prepared) {
    if (owner.accumulator.terminal !== null || owner.accumulator.hasErrors && state === "pending") continue;
    for (const target of owner.targets) {
      if (owner.accumulator.state(target.findingId) !== state) continue;
      const ids = result.get(target.pvId) ?? new Set<string>();
      ids.add(target.findingId);
      result.set(target.pvId, ids);
    }
  }
  return result;
}

async function preflight(
  context: PushContext,
  prepared: readonly PreparedItem[],
  onProgress: (processed: number) => void,
): Promise<void> {
  const snapshots = new Map<string, Map<string, Record<string, Json>>>();
  for (const [pvId, ids] of detailsByPv(prepared, "pending")) {
    try {
      snapshots.set(pvId, await getTargetDetails(context.platform, pvId, ids, context.signal, onProgress));
    } catch (error: unknown) {
      const detail = errorDetail(error, "VEX_PREFLIGHT_FAILED");
      for (const owner of prepared) for (const target of owner.targets) {
        if (target.pvId === pvId && owner.accumulator.state(target.findingId) === "pending") {
          owner.accumulator.markFailed(target.findingId, detail);
        }
      }
    }
  }
  for (const owner of prepared) {
    if (owner.accumulator.terminal !== null || owner.accumulator.hasErrors) continue;
    for (const target of owner.targets) {
      try {
        const detail = snapshots.get(target.pvId)?.get(target.findingId);
        if (detail === undefined) throw new Error(`Platform findings snapshot omitted ${target.findingId}`);
        if (!detailMatchesStableKey(detail, target.stableKey)) {
          owner.accumulator.setTerminal("stale", {
            findingId: target.findingId,
            code: "VEX_TARGET_MOVED",
            message: `Finding ${target.findingId} no longer has the planned stable identity`,
            retryable: false,
          });
          break;
        }
        if (sameVexTuple(tupleFromDetail(detail), owner.tuple)) {
          owner.accumulator.markNoop(target.findingId);
        }
      } catch (error: unknown) {
        owner.accumulator.markFailed(target.findingId, errorDetail(error, "VEX_PREFLIGHT_FAILED"));
      }
    }
  }
}

function setInput(target: VexBulkTarget, runId: string): VexDecisionInput {
  if (target.action !== "set" || target.tuple?.status === null || target.tuple === undefined) {
    throw new Error("Set batch contained a clear target");
  }
  return {
    findingId: target.findingId,
    status: target.tuple.status,
    ...(target.tuple.response === null ? {} : { response: target.tuple.response }),
    ...(target.tuple.justification === null ? {} : { justification: target.tuple.justification }),
    reason: stampVexReason(runId, target.tuple.reason),
  };
}

function ownerMap(prepared: readonly PreparedItem[]): Map<string, PreparedItem> {
  return new Map(prepared.map((owner) => [owner.item.key, owner]));
}

async function sendBatches(
  context: PushContext,
  prepared: readonly PreparedItem[],
  onProgress: (processed: number) => void,
): Promise<void> {
  const owners = ownerMap(prepared);
  const pending = prepared.flatMap((owner) => owner.targets.filter((target) => (
    owner.accumulator.terminal === null && owner.accumulator.state(target.findingId) === "pending"
  )));
  const batches = chunkVexTargets(pending);
  const scheduler = context.scheduler ?? systemScheduler;
  for (const batch of batches) {
    try {
      if (batch.action === "set") {
        const response = await withRateLimitRetry(() => context.platform.batchSetVexStatus({
          projectVersionId: batch.pvId,
          findings: batch.targets.map((target) => setInput(target, context.runId)),
        }, { signal: context.signal }), scheduler, context.random ?? Math.random, context.signal);
        const consumed = consumeSetEnvelope(batch.targets, response);
        if (!consumed.ok) {
          const affectedOwners = new Set(batch.targets.map((target) => target.stableKey));
          for (const stableKey of affectedOwners) {
            owners.get(stableKey)?.accumulator.addError({
              code: consumed.code,
              message: consumed.message,
              retryable: true,
            });
          }
          for (const target of batch.targets) {
            owners.get(target.stableKey)?.accumulator.markFailed(target.findingId, {
              code: "REMOTE_WRITE_INDETERMINATE",
              message: consumed.message,
              retryable: true,
            });
          }
        } else {
          for (const target of batch.targets) {
            const owner = owners.get(target.stableKey);
            if (consumed.succeeded.has(target.findingId)) owner?.accumulator.markProvisional(target.findingId);
            else owner?.accumulator.markFailed(target.findingId, {
              code: "VEX_ITEM_FAILED",
              message: (consumed.failed.get(target.findingId) ?? "Platform rejected the VEX decision").slice(0, 300),
              retryable: true,
            });
          }
        }
      } else {
        await withRateLimitRetry(() => context.platform.clearVexStatus({
          projectVersionId: batch.pvId,
          findingIds: batch.targets.map((target) => target.findingId),
        }, { signal: context.signal }), scheduler, context.random ?? Math.random, context.signal);
        for (const target of batch.targets) owners.get(target.stableKey)?.accumulator.markProvisional(target.findingId);
      }
    } catch (error: unknown) {
      const detail = errorDetail(error, "VEX_CHUNK_FAILED");
      for (const target of batch.targets) owners.get(target.stableKey)?.accumulator.markFailed(target.findingId, detail);
    }
    onProgress(batch.targets.length);
  }
}

async function verifyProvisional(
  context: PushContext,
  prepared: readonly PreparedItem[],
  onProgress: (processed: number) => void,
): Promise<void> {
  const snapshots = new Map<string, Map<string, Record<string, Json>>>();
  for (const [pvId, ids] of detailsByPv(prepared, "provisional")) {
    try {
      snapshots.set(pvId, await getTargetDetails(context.platform, pvId, ids, context.signal, onProgress));
    } catch (error: unknown) {
      const detail = errorDetail(error, "VEX_READ_BACK_FAILED");
      for (const owner of prepared) for (const findingId of owner.accumulator.provisionalTargets()) {
        if (owner.item.projectVersionId === pvId) owner.accumulator.markFailed(findingId, detail);
      }
    }
  }
  for (const owner of prepared) {
    for (const findingId of owner.accumulator.provisionalTargets()) {
      const pvId = owner.item.projectVersionId;
      if (pvId === null) throw new Error("VEX project version disappeared");
      try {
        const detail = snapshots.get(pvId)?.get(findingId);
        if (detail === undefined) throw new Error(`Platform findings read-back omitted ${findingId}`);
        if (!detailMatchesStableKey(detail, owner.item.key)) {
          owner.accumulator.markFailed(findingId, {
            code: "VEX_TARGET_MOVED",
            message: `Finding ${findingId} changed identity during VEX apply`,
            retryable: false,
          });
        } else if (!sameVexTuple(tupleFromDetail(detail), owner.tuple)) {
          owner.accumulator.markFailed(findingId, {
            code: "VEX_READ_BACK_MISMATCH",
            message: `Finding ${findingId} did not retain the intended VEX tuple`,
            retryable: false,
          });
        } else {
          owner.accumulator.markSucceeded(findingId);
        }
      } catch (error: unknown) {
        owner.accumulator.markFailed(findingId, errorDetail(error, "VEX_READ_BACK_FAILED"));
      }
    }
  }
}

export async function pushVexItems(context: PushContext, items: PlanItem[]): Promise<VexApplyResult[]> {
  if (registeredResolver("vexDecision") === undefined) {
    throw new PushExecutionError("VEX_RESOLVER_MISSING", "WP-23 VEX resolver must be registered before bulk apply");
  }
  const prepared = prepareItems(context, items);
  rejectContendedTargets(prepared);
  const totalTargets = prepared.reduce((sum, owner) => sum + owner.targets.length, 0);
  const totalWork = Math.max(1, totalTargets * 3);
  let processed = 0;
  let lastPublished = 0;
  const progress = (count: number, force = false): void => {
    processed = Math.min(totalWork, processed + count);
    const completed = Math.min(totalTargets, Math.floor(processed * totalTargets / totalWork));
    if (force || completed - lastPublished >= PROGRESS_TARGET_INTERVAL) {
      context.publish({ runId: context.runId, completed, total: totalTargets });
      lastPublished = completed;
    }
  };
  await preflight(context, prepared, count => progress(count));
  await sendBatches(context, prepared, count => progress(count));
  await verifyProvisional(context, prepared, count => progress(count));
  progress(totalWork - processed, true);
  return prepared.map((owner) => owner.accumulator.result());
}

function outcomeError(result: VexApplyResult): VexBatchApplyOutcome["error"] {
  if (result.state === "applied" || result.state === "noop") return null;
  const codes = [...new Set(result.errors.map((error) => error.code))].slice(0, 5);
  const targetDetails = result.errors.slice(0, 3).map((error) => (
    `${error.findingId ?? "item"}:${error.code}`
  ));
  const countMessage = result.targets === 0
    ? "VEX item failed before target expansion"
    : `${result.succeeded}/${result.targets} targets confirmed; ${result.failed} failed`;
  return {
    code: result.state === "partial" ? "VEX_PARTIAL_FAILURE" : codes[0] ?? "VEX_ITEM_FAILED",
    message: `${countMessage}${targetDetails.length === 0 ? "" : ` (${targetDetails.join(", ")})`}`,
    retryable: result.errors.length > 0 && result.errors.every((error) => error.retryable),
    requiresPull: result.errors.some((error) => (
      error.code === "VEX_RESULT_INVALID"
      || error.code === "VEX_READ_BACK_MISMATCH"
      || error.code === "VEX_TARGET_MOVED"
    )),
  };
}

export function createVexBulkPusher(deps: VexBulkDependencies): VexBatchPusher {
  const pusher: VexBatchPusher = {
    kind: "vexDecision",
    maxConcurrency: 1,
    async apply(item, context): Promise<ApplyResult> {
      const outcome = (await pusher.applyBatch([item], context))[0];
      if (outcome?.result !== null && outcome?.result !== undefined) return outcome.result;
      const error = outcome?.error;
      throw new PushExecutionError(
        error?.code ?? "VEX_ITEM_FAILED",
        error?.message ?? `VEX apply produced no outcome for ${item.key}`,
        error?.retryable ?? false,
        error?.requiresPull ?? false,
      );
    },
    async applyBatch(items, context): Promise<VexBatchApplyOutcome[]> {
      for (const item of items) assertPusherItem(pusher, item, context);
      const results = await pushVexItems({ ...deps, ...context }, [...items]);
      return items.map((item, index) => {
        const result = results[index];
        if (result === undefined || result.stableKey !== item.key) {
          return {
            item,
            result: null,
            error: { code: "VEX_RESULT_MISSING", message: `No VEX result for ${item.key}`, retryable: false, requiresPull: true },
          };
        }
        const error = outcomeError(result);
        const base = new BaseSnapshotStore(deps.db).getAccepted(
          item.projectId,
          item.projectVersionId ?? "",
          item.kind,
          item.key,
        );
        const payload = intendedPayload(item, base);
        return {
          item,
          result: error === null ? {
            remoteId: null,
            serverPayload: payload,
            // Set responses are authoritative only because pushVexItems already
            // paged and compared every provisional target before reaching here.
            verification: payload === null ? "required" : "response-is-authoritative",
          } : null,
          error,
        };
      });
    },
    async readBack(item, context): Promise<ReadBackResult> {
      assertPusherItem(pusher, item, context);
      const extended: PushContext = { ...deps, ...context };
      const prepared = prepareItems(extended, [item])[0];
      if (
        prepared === undefined
        || prepared.accumulator.terminal !== null
        || prepared.accumulator.hasErrors
      ) {
        throw new PushExecutionError("VEX_TARGET_NOT_FOUND", `No current findings resolve ${item.key}`, false, true);
      }
      const pvId = item.projectVersionId;
      if (pvId === null) throw new PushExecutionError("VEX_TARGET_NOT_FOUND", `No project version resolves ${item.key}`, false, true);
      const details = await getTargetDetails(
        deps.platform,
        pvId,
        new Set(prepared.targets.map((target) => target.findingId)),
        context.signal,
      );
      for (const target of prepared.targets) {
        const detail = details.get(target.findingId);
        if (detail === undefined) throw new PushExecutionError("VEX_READ_BACK_INCONSISTENT", `Finding ${target.findingId} is missing from read-back`, false, true);
        if (!detailMatchesStableKey(detail, item.key) || !sameVexTuple(tupleFromDetail(detail), prepared.tuple)) {
          throw new PushExecutionError("VEX_READ_BACK_INCONSISTENT", `Finding rows for ${item.key} do not share the intended VEX tuple`, false, true);
        }
      }
      return prepared.tuple === null
        ? { exists: false, remoteId: null, payload: null }
        : {
          exists: true,
          remoteId: prepared.targets.length === 1 ? prepared.targets[0]?.findingId ?? null : null,
          payload: { ...prepared.tuple },
        };
    },
  };
  return pusher;
}

export function registerVexBulkPusher(deps: VexBulkDependencies): void {
  registerTypedPusher(createVexBulkPusher(deps));
}
