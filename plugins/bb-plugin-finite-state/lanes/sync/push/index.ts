import { randomUUID } from "node:crypto";

import { RemoteError } from "../../../lib/remote/types.js";
import { toStorageProjectVersionId } from "../../../lib/store/index.js";
import { isRemotePushable, type EntityKind } from "../../../lib/sync/registry.js";
import { HUMAN_APPROVAL_CAPABILITY_POLICY } from "../../../shared/contract.js";
import { syncMetadata } from "../engine/status.js";
import { loadPlanForDeps, type Plan, type PlanItem } from "../plan/index.js";
import { canonicalJson } from "../serialize/canonical.js";
import { BaseSnapshotStore, type BaseRow } from "../store/base-snapshot.js";
import { PushLogStore, type PushLogEntry, type StoredPushError } from "./log.js";
import { publishPushProgress } from "./progress.js";
import { pusherFor } from "./pushers.js";
import {
  intendedPayload,
  reconcileReadBack,
  verifyApply,
  type ConfirmedApply,
  type VerificationOutcome,
} from "./read-back.js";
import {
  decodePushContinuation,
  encodePushContinuation,
  initializeSidecar,
  loadPushSidecar,
  newSidecar,
  updatePushSidecar,
  type PushSidecar,
} from "./resume.js";
import {
  PushExecutionError,
  type ApplyResult,
  type EntityPusher,
  type PushContext,
  type PushDeps,
  type PushItemResult,
  type PushOptions,
  type PushReport,
} from "./types.js";
import { isVexBatchPusher, type VexBatchApplyOutcome } from "./vex.js";

interface ExecutionState {
  plan: Plan;
  sidecar: PushSidecar;
  context: PushContext;
  log: PushLogStore;
  stop: boolean;
}

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

function now(deps: PushDeps): Date {
  return deps.now?.() ?? new Date();
}

function safeMessage(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gu, "[url]")
    .replace(/authorization/giu, "auth")
    .replace(/bearer\s+\S+/giu, "credential [redacted]")
    .replace(/(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/giu, "credential=[redacted]")
    .slice(0, 500);
}

function detailsFromError(error: unknown): StoredPushError {
  if (error instanceof PushExecutionError) {
    return {
      code: error.code,
      message: safeMessage(error.message),
      retryable: error.retryable,
      requiresPull: error.requiresPull,
    };
  }
  if (error instanceof RemoteError) {
    const detailCode = error.details !== null
      && typeof error.details === "object"
      && !Array.isArray(error.details)
      && typeof error.details["code"] === "string"
      ? error.details["code"]
      : null;
    if (error.status === 409 && detailCode === "stale_tara_state") {
      return {
        code: "STALE_TARA_STATE",
        message: "Assurance Studio rejected the planned TARA head/working-state fence",
        retryable: false,
        requiresPull: true,
      };
    }
    return {
      code: error.code,
      message: safeMessage(error.message),
      retryable: error.retryable,
      requiresPull: false,
    };
  }
  if (error instanceof Error) {
    return {
      code: "PUSH_ITEM_FAILED",
      message: safeMessage(error.message),
      retryable: false,
      requiresPull: false,
    };
  }
  return {
    code: "PUSH_ITEM_FAILED",
    message: "Push item failed without a typed diagnostic",
    retryable: false,
    requiresPull: false,
  };
}

function recordsEqual(
  left: Readonly<Record<string, string | number>>,
  right: Readonly<Record<string, string | number>>,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function selectedKinds(plan: Plan): EntityKind[] {
  return [...new Set(plan.items.map((item) => item.kind))]
    .sort((left, right) => left.localeCompare(right));
}

function assertPlanApplicable(plan: Plan, confirmed: boolean): void {
  if (plan.staleness.degraded) {
    throw new PushExecutionError(
      "PLAN_STALE",
      "Degraded plans cannot prove current upstream and working state",
    );
  }
  if (plan.validationErrors.length > 0 || plan.items.some((item) => item.error !== null)) {
    throw new PushExecutionError("PLAN_VALIDATION_FAILED", "Plan contains validation failures");
  }
  if (plan.items.some((item) => item.operation === "conflict")) {
    throw new PushExecutionError("PLAN_CONFLICT_UNRESOLVED", "Plan contains unresolved conflicts");
  }
  if (plan.items.some((item) => item.operation === "orphan")) {
    throw new PushExecutionError("PLAN_ORPHAN_UNRESOLVED", "Plan contains unresolved overlay orphans");
  }
  if (plan.blastRadius.requiresHumanReview && !confirmed) {
    throw new PushExecutionError(
      "BLAST_RADIUS_UNCONFIRMED",
      "Plan blast radius requires trusted human confirmation",
    );
  }
  const nonPushable = plan.items.find((item) => (
    item.operation !== "noop" && !isRemotePushable(item.kind)
  ));
  if (nonPushable !== undefined) {
    throw new PushExecutionError(
      "PLAN_ITEM_NON_APPLICABLE",
      `${nonPushable.kind}/${nonPushable.key} has no remote push contract`,
    );
  }
}

function assertPlanIdentity(
  plan: Plan,
  scope: PushOptions["scope"],
  planId: string,
  expectedPlanSha256: string,
  expectedBaseStateSha256: string,
): void {
  if (plan.planId !== planId || plan.planSha256 !== expectedPlanSha256) {
    throw new PushExecutionError("PLAN_FENCE_MISMATCH", "Persisted plan digest does not match the request fence");
  }
  if (
    plan.projectId !== scope.projectId
    || plan.projectVersionId !== scope.projectVersionId
  ) {
    throw new PushExecutionError("PLAN_SCOPE_MISMATCH", "Persisted plan belongs to another scope");
  }
  if (
    plan.baseStateSha256 !== expectedBaseStateSha256
    || plan.items.some((item) => (
      item.projectId !== scope.projectId || item.projectVersionId !== scope.projectVersionId
    ))
  ) {
    throw new PushExecutionError("PLAN_FENCE_MISMATCH", "Persisted plan base fence does not match the request");
  }
}

function assertExactBaseRows(deps: PushDeps, plan: Plan, onlyPending?: ReadonlySet<string>): void {
  const storageVersionId = toStorageProjectVersionId(plan.projectVersionId);
  const store = new BaseSnapshotStore(deps.db);
  for (const item of plan.items) {
    if (onlyPending !== undefined && !onlyPending.has(`${item.kind}\0${item.key}`)) continue;
    const row = store.getAccepted(plan.projectId, storageVersionId, item.kind, item.key);
    if ((row?.contentHash ?? null) !== item.expectedBaseContentHash) {
      throw new PushExecutionError(
        "PLAN_STALE",
        `Accepted ${item.kind}/${item.key} moved from its planned content hash`,
      );
    }
  }
}

function loadInitialPlan(deps: PushDeps, options: PushOptions): Plan {
  const plan = loadPlanForDeps(deps, options.planId);
  if (plan === null) {
    throw new PushExecutionError(
      "PLAN_NOT_FOUND",
      "Persisted plan is missing or failed integrity validation",
    );
  }
  assertPlanIdentity(
    plan,
    options.scope,
    options.planId,
    options.expectedPlanSha256,
    options.expectedBaseStateSha256,
  );
  assertPlanApplicable(plan, options.confirmed);
  const metadata = syncMetadata(deps, options.scope, selectedKinds(plan));
  if (
    metadata.baseStateSha256 !== plan.baseStateSha256
    || !recordsEqual(metadata.acceptedGenerationIds, plan.baseGenerationIds)
    || !recordsEqual(metadata.baseRevisions, plan.baseRevisions)
  ) {
    throw new PushExecutionError("PLAN_STALE", "Accepted base generation or revision moved after planning");
  }
  assertExactBaseRows(deps, plan);
  return plan;
}

function loadResumePlan(deps: PushDeps, sidecar: PushSidecar): Plan {
  const plan = loadPlanForDeps(deps, sidecar.planId);
  if (plan === null || plan.planSha256 !== sidecar.planSha256) {
    throw new PushExecutionError(
      "PLAN_NOT_FOUND",
      "Push plan is missing or failed integrity validation",
    );
  }
  if (
    plan.projectId !== sidecar.scope.projectId
    || plan.projectVersionId !== sidecar.scope.projectVersionId
    || plan.baseStateSha256 !== sidecar.expectedBaseStateSha256
    || !recordsEqual(plan.baseGenerationIds, sidecar.baseGenerationIds)
    || !recordsEqual(plan.baseRevisions, sidecar.baseRevisions)
    || canonicalJson(plan.items.map((item) => ({ kind: item.kind, key: item.key })))
      !== canonicalJson(sidecar.ordered)
  ) {
    throw new PushExecutionError("PUSH_SIDECAR_MISMATCH", "Push sidecar does not match its immutable plan");
  }
  assertPlanApplicable(plan, sidecar.confirmed);
  return plan;
}

function appliedByKind(entries: readonly PushLogEntry[]): Map<EntityKind, number> {
  const result = new Map<EntityKind, number>();
  for (const entry of entries) {
    if (entry.status === "applied") result.set(entry.kind, (result.get(entry.kind) ?? 0) + 1);
  }
  return result;
}

function assertResumeFence(
  deps: PushDeps,
  plan: Plan,
  sidecar: PushSidecar,
  entries: readonly PushLogEntry[],
): void {
  const metadata = syncMetadata(deps, sidecar.scope, selectedKinds(plan));
  const applied = appliedByKind(entries);
  for (const kind of selectedKinds(plan)) {
    const generation = sidecar.baseGenerationIds[kind];
    const startingRevision = sidecar.baseRevisions[kind];
    if (
      generation === undefined
      || startingRevision === undefined
      || metadata.acceptedGenerationIds[kind] !== generation
      || metadata.baseRevisions[kind] !== startingRevision + (applied.get(kind) ?? 0)
    ) {
      throw new PushExecutionError(
        "PLAN_STALE",
        `Accepted ${kind} generation/revision moved outside push ${sidecar.runId}`,
      );
    }
  }
  const pending = new Set(entries
    .filter((entry) => entry.status !== "applied" && entry.status !== "skipped")
    .map((entry) => `${entry.kind}\0${entry.key}`));
  assertExactBaseRows(deps, plan, pending);
}

function planItem(plan: Plan, entry: PushLogEntry): PlanItem {
  const item = plan.items.find((candidate) => candidate.kind === entry.kind && candidate.key === entry.key);
  if (item === undefined) throw new Error(`Push log item ${entry.kind}/${entry.key} is absent from its plan`);
  return item;
}

function currentRevision(deps: PushDeps, state: ExecutionState, kind: EntityKind): number {
  const entries = state.log.list(
    state.sidecar.scope.projectId,
    toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
    state.sidecar.runId,
  );
  const starting = state.sidecar.baseRevisions[kind];
  if (starting === undefined) throw new Error(`Push sidecar has no ${kind} base revision`);
  const expected = starting + entries.filter((entry) => (
    entry.kind === kind && entry.status === "applied"
  )).length;
  const metadata = syncMetadata(deps, state.sidecar.scope, [kind]);
  if (
    metadata.acceptedGenerationIds[kind] !== state.sidecar.baseGenerationIds[kind]
    || metadata.baseRevisions[kind] !== expected
  ) {
    throw new PushExecutionError(
      "PLAN_STALE",
      `Accepted ${kind} base moved outside push ${state.sidecar.runId}`,
    );
  }
  return expected;
}

function baseRow(deps: PushDeps, state: ExecutionState, item: PlanItem): BaseRow | null {
  return new BaseSnapshotStore(deps.db).getAccepted(
    state.sidecar.scope.projectId,
    toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
    item.kind,
    item.key,
  );
}

function advanceConfirmed(
  deps: PushDeps,
  state: ExecutionState,
  entry: PushLogEntry,
  item: PlanItem,
  confirmed: ConfirmedApply,
): void {
  const revision = currentRevision(deps, state, item.kind);
  const generationId = state.sidecar.baseGenerationIds[item.kind];
  if (generationId === undefined) throw new Error(`Push sidecar has no ${item.kind} generation`);
  const store = new BaseSnapshotStore(deps.db);
  state.log.markAppliedAtomically(entry, revision, now(deps).toISOString(), () => {
    if (item.operation === "delete") {
      if (item.expectedBaseContentHash === null) {
        throw new PushExecutionError("PLAN_STALE", `Delete ${item.kind}/${item.key} has no prior hash`);
      }
      store.deleteAccepted(
        state.sidecar.scope.projectId,
        toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
        item.kind,
        item.key,
        { generationId, baseRevision: revision, contentHash: item.expectedBaseContentHash },
      );
      return;
    }
    if (confirmed.payload === null) {
      throw new Error(`Confirmed ${item.kind}/${item.key} has no semantic payload`);
    }
    store.advanceAccepted(
      state.sidecar.scope.projectId,
      toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
      item.kind,
      item.key,
      {
        generationId,
        baseRevision: revision,
        contentHash: item.expectedBaseContentHash,
      },
      {
        payload: confirmed.payload,
        remoteId: confirmed.remoteId,
        pulledAt: now(deps).toISOString(),
      },
    );
  });
}

async function markFailure(
  deps: PushDeps,
  state: ExecutionState,
  entry: PushLogEntry,
  error: StoredPushError,
): Promise<void> {
  state.log.markFailed(entry, error);
  if (error.requiresPull) {
    state.sidecar = await updatePushSidecar(deps, state.sidecar, { requiresPull: true });
  }
  state.stop = true;
}

async function markPending(
  deps: PushDeps,
  state: ExecutionState,
  entry: PushLogEntry,
  error: StoredPushError,
): Promise<void> {
  state.log.markPendingError(entry, error);
  if (error.requiresPull) {
    state.sidecar = await updatePushSidecar(deps, state.sidecar, { requiresPull: true });
  }
  state.stop = true;
}

async function verifyAndAdvance(
  deps: PushDeps,
  state: ExecutionState,
  pusher: EntityPusher,
  entry: PushLogEntry,
  item: PlanItem,
  base: BaseRow | null,
  expected: Record<string, unknown> | null,
  result: ApplyResult,
): Promise<boolean> {
  publishPushProgress(deps, {
    runId: state.sidecar.runId,
    phase: "verify",
    completed: state.sidecar.cursor,
    total: state.plan.items.length,
  });
  let verified: VerificationOutcome;
  try {
    verified = await verifyApply(pusher, item, expected, result, state.context);
  } catch (error: unknown) {
    const detail = detailsFromError(error);
    await markPending(deps, state, entry, {
      code: "READ_BACK_FAILED",
      message: detail.message,
      retryable: true,
      requiresPull: detail.requiresPull,
    });
    return false;
  }
  if (!verified.ok) {
    await markFailure(deps, state, entry, { ...verified.error, requiresPull: true });
    return false;
  }
  try {
    advanceConfirmed(deps, state, entry, item, verified.confirmed);
    return true;
  } catch (error: unknown) {
    const detail = detailsFromError(error);
    await markPending(deps, state, entry, {
      code: "BASE_ADVANCE_FAILED",
      message: detail.message,
      retryable: true,
      requiresPull: true,
    });
    return false;
  }
}

async function reconcileEntry(
  deps: PushDeps,
  state: ExecutionState,
  entry: PushLogEntry,
): Promise<"intended" | "base" | "blocked"> {
  const item = planItem(state.plan, entry);
  const pusher = pusherFor(item.kind, deps.pushers);
  if (pusher === null) {
    await markFailure(deps, state, entry, {
      code: "PUSHER_NOT_REGISTERED",
      message: `No typed pusher is registered for ${item.kind}`,
      retryable: false,
      requiresPull: false,
    });
    return "blocked";
  }
  const base = baseRow(deps, state, item);
  const expected = intendedPayload(item, base);
  try {
    const outcome = await reconcileReadBack(pusher, item, base, expected, state.context);
    if (outcome.state === "intended") {
      advanceConfirmed(deps, state, entry, item, outcome.confirmed);
      return "intended";
    }
    if (outcome.state === "base") return "base";
    await markFailure(deps, state, entry, {
      code: "AMBIGUOUS_WRITE",
      message: `Remote ${item.kind}/${item.key} matches neither the planned base nor intended payload`,
      retryable: false,
      requiresPull: true,
    });
    return "blocked";
  } catch (error: unknown) {
    const detail = detailsFromError(error);
    await markPending(deps, state, entry, {
      code: "RECONCILIATION_FAILED",
      message: detail.message,
      retryable: true,
      requiresPull: detail.requiresPull,
    });
    return "blocked";
  }
}

async function reconcilePending(deps: PushDeps, state: ExecutionState): Promise<void> {
  publishPushProgress(deps, {
    runId: state.sidecar.runId,
    phase: "reconcile",
    completed: 0,
    total: state.plan.items.length,
  });
  const entries = state.log.list(
    state.sidecar.scope.projectId,
    toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
    state.sidecar.runId,
  );
  for (const entry of entries) {
    if (entry.status !== "pending") continue;
    await reconcileEntry(deps, state, entry);
  }
}

function indeterminate(error: unknown): boolean {
  return error instanceof RemoteError && error.code === "REMOTE_WRITE_INDETERMINATE";
}

async function applyOne(
  deps: PushDeps,
  state: ExecutionState,
  entry: PushLogEntry,
  groupToken?: unknown,
): Promise<boolean> {
  const item = planItem(state.plan, entry);
  const pusher = pusherFor(item.kind, deps.pushers);
  if (pusher === null) {
    await markFailure(deps, state, entry, {
      code: "PUSHER_NOT_REGISTERED",
      message: `No typed pusher is registered for ${item.kind}`,
      retryable: false,
      requiresPull: false,
    });
    return false;
  }
  const base = baseRow(deps, state, item);
  if ((base?.contentHash ?? null) !== item.expectedBaseContentHash) {
    await markFailure(deps, state, entry, {
      code: "PLAN_STALE",
      message: `Accepted ${item.kind}/${item.key} moved before apply`,
      retryable: false,
      requiresPull: false,
    });
    return false;
  }
  const expected = intendedPayload(item, base);
  try {
    const result = await pusher.apply(item, state.context, groupToken);
    return await verifyAndAdvance(deps, state, pusher, entry, item, base, expected, result);
  } catch (error: unknown) {
    if (indeterminate(error)) {
      const reconciled = await reconcileEntry(deps, state, entry);
      if (reconciled === "base") {
        await markPending(deps, state, entry, {
          code: "WRITE_NOT_CONFIRMED",
          message: `Remote ${item.kind}/${item.key} still matches the planned base; resume may retry it`,
          retryable: true,
          requiresPull: false,
        });
      }
      return reconciled === "intended";
    }
    await markFailure(deps, state, entry, detailsFromError(error));
    return false;
  }
}

async function applyVexBatch(
  deps: PushDeps,
  state: ExecutionState,
  pusher: EntityPusher,
  entries: readonly PushLogEntry[],
): Promise<void> {
  if (!isVexBatchPusher(pusher)) throw new Error("VEX batch requires a VexBatchPusher");
  const items = entries.map((entry) => planItem(state.plan, entry));
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const base = baseRow(deps, state, item);
    if ((base?.contentHash ?? null) !== item.expectedBaseContentHash) {
      await markFailure(deps, state, entries[index]!, {
        code: "PLAN_STALE",
        message: `Accepted ${item.kind}/${item.key} moved before VEX apply`,
        retryable: false,
        requiresPull: false,
      });
      return;
    }
  }
  currentRevision(deps, state, "vexDecision");
  let outcomes: VexBatchApplyOutcome[];
  try {
    outcomes = await pusher.applyBatch(items, state.context);
  } catch (error: unknown) {
    if (indeterminate(error)) {
      for (const entry of entries) {
        const reconciled = await reconcileEntry(deps, state, entry);
        if (reconciled === "base") {
          await markPending(deps, state, entry, {
            code: "WRITE_NOT_CONFIRMED",
            message: `Remote vexDecision/${entry.key} still matches the planned base; resume may retry it`,
            retryable: true,
            requiresPull: false,
          });
        }
      }
      return;
    }
    await markFailure(deps, state, entries[0]!, detailsFromError(error));
    return;
  }
  if (
    outcomes.length !== entries.length
    || outcomes.some((outcome, index) => {
      const entry = entries[index];
      return entry === undefined
        || outcome.item.kind !== entry.kind
        || outcome.item.key !== entry.key;
    })
  ) {
    await markFailure(deps, state, entries[0]!, {
      code: "VEX_RESULT_MISSING",
      message: "VEX pusher did not return one ordered outcome per plan item",
      retryable: false,
      requiresPull: true,
    });
    return;
  }
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]!;
    const entry = entries[index]!;
    const item = items[index]!;
    if (outcome.error !== null || outcome.result === null) {
      await markFailure(deps, state, entry, {
        ...(outcome.error ?? {
          code: "VEX_ITEM_FAILED",
          message: `VEX pusher returned no result for ${entry.key}`,
          retryable: false,
        }),
        requiresPull: outcome.error?.requiresPull ?? false,
      });
      continue;
    }
    const base = baseRow(deps, state, item);
    const expected = intendedPayload(item, base);
    await verifyAndAdvance(deps, state, pusher, entry, item, base, expected, outcome.result);
  }
}

async function executeGroup(
  deps: PushDeps,
  state: ExecutionState,
  pusher: EntityPusher,
  entries: readonly PushLogEntry[],
): Promise<void> {
  const items = entries.map((entry) => planItem(state.plan, entry));
  let token: unknown;
  try {
    token = await pusher.beginGroup?.(items, state.context);
  } catch (error: unknown) {
    await markFailure(deps, state, entries[0]!, detailsFromError(error));
    return;
  }
  for (const entry of entries) {
    await applyOne(deps, state, entry, token);
    if (state.stop) {
      for (const applied of state.log.list(
        state.sidecar.scope.projectId,
        toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
        state.sidecar.runId,
      ).filter((candidate) => (
        candidate.status === "applied"
        && entries.some((groupEntry) => groupEntry.id === candidate.id)
      ))) {
        try {
          await pusher.readBack(planItem(state.plan, applied), state.context);
        } catch {
          // The row is already atomically journaled/base-advanced. An aborted
          // bracket cannot roll it back; pull/re-plan is the recovery fence.
        }
      }
      state.sidecar = await updatePushSidecar(deps, state.sidecar, { requiresPull: true });
      return;
    }
  }
  if (pusher.commitGroup === undefined) return;
  try {
    await pusher.commitGroup(items, state.context, token);
  } catch (error: unknown) {
    const detail = detailsFromError(error);
    for (const entry of entries) {
      const item = planItem(state.plan, entry);
      try {
        await pusher.readBack(item, state.context);
      } catch {
        // Earlier row calls are already journaled/base-advanced. A checkpoint
        // failure cannot roll them back; pull/re-plan is the only safe recovery.
      }
    }
    state.sidecar = await updatePushSidecar(deps, state.sidecar, {
      requiresPull: true,
      terminalError: {
        code: detail.code,
        message: detail.message,
        retryable: false,
      },
    });
    state.stop = true;
  }
}

async function executePending(deps: PushDeps, state: ExecutionState): Promise<void> {
  publishPushProgress(deps, {
    runId: state.sidecar.runId,
    phase: "apply",
    completed: state.sidecar.cursor,
    total: state.plan.items.length,
  });
  while (!state.stop) {
    const entries = state.log.list(
      state.sidecar.scope.projectId,
      toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
      state.sidecar.runId,
    );
    const entry = entries.find((candidate) => candidate.status === "pending");
    if (entry === undefined) return;
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (entries.slice(0, index).some((candidate) => candidate.status === "failed")) return;
    state.sidecar = await updatePushSidecar(deps, state.sidecar, { cursor: Math.max(0, index) });
    const pusher = pusherFor(entry.kind, deps.pushers);
    if (pusher === null) {
      await markFailure(deps, state, entry, {
        code: "PUSHER_NOT_REGISTERED",
        message: `No typed pusher is registered for ${entry.kind}`,
        retryable: false,
        requiresPull: false,
      });
      return;
    }
    if (isVexBatchPusher(pusher)) {
      const batch = entries.slice(index).filter((candidate, batchIndex) => (
        candidate.status === "pending"
        && candidate.kind === entry.kind
        && entries.slice(index, index + batchIndex).every((prior) => (
          prior.status === "pending" && prior.kind === entry.kind
        ))
      ));
      await applyVexBatch(deps, state, pusher, batch);
    } else if (pusher.beginGroup !== undefined || pusher.commitGroup !== undefined) {
      const group = entries.slice(index).filter((candidate, groupIndex) => (
        candidate.status === "pending"
        && candidate.kind === entry.kind
        && entries.slice(index, index + groupIndex).every((prior) => (
          prior.status === "pending" && prior.kind === entry.kind
        ))
      ));
      await executeGroup(deps, state, pusher, group);
    } else {
      await applyOne(deps, state, entry);
    }
    const refreshed = state.log.list(
      state.sidecar.scope.projectId,
      toStorageProjectVersionId(state.sidecar.scope.projectVersionId),
      state.sidecar.runId,
    );
    const nextPending = refreshed.findIndex((candidate) => candidate.status === "pending");
    state.sidecar = await updatePushSidecar(deps, state.sidecar, {
      cursor: nextPending < 0 ? refreshed.length : nextPending,
    });
  }
}

function resultForEntry(deps: PushDeps, sidecar: PushSidecar, plan: Plan, entry: PushLogEntry): PushItemResult {
  const item = planItem(plan, entry);
  const row = new BaseSnapshotStore(deps.db).getAccepted(
    sidecar.scope.projectId,
    toStorageProjectVersionId(sidecar.scope.projectVersionId),
    item.kind,
    item.key,
  );
  const error = entry.status === "pending"
    ? entry.error ?? {
      code: "PENDING_RETRY",
      message: `Push ${item.kind}/${item.key} remains pending reconciliation or retry`,
      retryable: true,
      requiresPull: false,
    }
    : entry.error;
  return {
    projectId: item.projectId,
    projectVersionId: item.projectVersionId,
    kind: item.kind,
    key: item.key,
    expectedBaseContentHash: item.expectedBaseContentHash,
    status: entry.status === "applied" ? "applied" : entry.status === "skipped" ? "skipped" : "failed",
    newBaseContentHash: entry.status === "applied" ? row?.contentHash ?? null : null,
    error: error === null ? null : {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
}

function pageSize(value: number | undefined): number {
  const size = value ?? PAGE_SIZE_DEFAULT;
  if (!Number.isSafeInteger(size) || size < 1 || size > PAGE_SIZE_MAX) {
    throw new PushExecutionError("PUSH_PAGE_INVALID", "Push page size must be from 1 through 200");
  }
  return size;
}

function report(
  deps: PushDeps,
  plan: Plan,
  sidecar: PushSidecar,
  offset: number,
  requestedPageSize: number,
): PushReport {
  const entries = new PushLogStore(deps.db).list(
    sidecar.scope.projectId,
    toStorageProjectVersionId(sidecar.scope.projectVersionId),
    sidecar.runId,
  );
  const allItems = entries.map((entry) => resultForEntry(deps, sidecar, plan, entry));
  if (offset < 0 || offset >= Math.max(1, allItems.length)) {
    throw new PushExecutionError("PUSH_PAGE_INVALID", "Push page offset is outside the result set");
  }
  const page = allItems.slice(offset, offset + requestedPageSize);
  const nextOffset = offset + page.length;
  const applied = allItems.filter((item) => item.status === "applied").length;
  const failed = allItems.filter((item) => item.status === "failed").length;
  const skipped = allItems.filter((item) => item.status === "skipped").length;
  const requiresPull = sidecar.requiresPull || entries.some((entry) => entry.error?.requiresPull === true);
  const metadata = syncMetadata(deps, sidecar.scope, selectedKinds(plan));
  const accepted = new Set(Object.values(metadata.acceptedGenerationIds));
  const revisions = Object.values(metadata.baseRevisions);
  const status: PushReport["status"] = failed === 0 && sidecar.terminalError === null
    ? "completed"
    : applied > 0 && !requiresPull && sidecar.terminalError === null
      ? "partial"
      : "failed";
  return {
    ...sidecar.scope,
    runId: sidecar.runId,
    planId: plan.planId,
    planSha256: plan.planSha256,
    baseGenerationIds: metadata.acceptedGenerationIds,
    baseRevisions: metadata.baseRevisions,
    baseStateSha256: metadata.baseStateSha256,
    status,
    summary: { total: allItems.length, applied, failed, skipped },
    items: page,
    total: allItems.length,
    next: nextOffset < allItems.length
      ? encodePushContinuation(sidecar.runId, nextOffset)
      : null,
    requiresPull,
    cache: {
      state: requiresPull ? "stale" : metadata.lastPull === null ? "empty" : "fresh",
      asOf: metadata.lastPull,
      message: requiresPull
        ? "Push requires pull and re-plan before another write"
        : sidecar.terminalError?.message ?? null,
      acceptedGenerationId: accepted.size === 1 ? accepted.values().next().value ?? null : null,
      baseRevision: revisions.length === 0 ? 0 : Math.max(...revisions),
    },
  };
}

async function finish(
  deps: PushDeps,
  state: ExecutionState,
  offset: number,
  requestedPageSize: number,
): Promise<PushReport> {
  const final = report(deps, state.plan, state.sidecar, offset, requestedPageSize);
  publishPushProgress(deps, {
    runId: final.runId,
    phase: final.status === "completed" ? "completed" : "failed",
    completed: final.summary.applied + final.summary.failed + final.summary.skipped,
    total: final.summary.total,
    applied: final.summary.applied,
    failed: final.summary.failed,
    skipped: final.summary.skipped,
  });
  return final;
}

export async function push(deps: PushDeps, options: PushOptions): Promise<PushReport> {
  const requestedPageSize = pageSize(options.pageSize);
  if (options.continuation !== undefined && options.continuation !== null) {
    const cursor = decodePushContinuation(options.continuation);
    const sidecar = loadPushSidecar(deps, cursor.runId);
    if (sidecar === null) throw new PushExecutionError("PUSH_NOT_FOUND", "Push continuation run is missing");
    const plan = loadResumePlan(deps, sidecar);
    assertPlanIdentity(
      plan,
      options.scope,
      options.planId,
      options.expectedPlanSha256,
      options.expectedBaseStateSha256,
    );
    return report(deps, plan, sidecar, cursor.offset, requestedPageSize);
  }

  if (options.runId !== undefined) {
    const existing = loadPushSidecar(deps, options.runId);
    if (existing !== null) {
      const plan = loadResumePlan(deps, existing);
      assertPlanIdentity(
        plan,
        options.scope,
        options.planId,
        options.expectedPlanSha256,
        options.expectedBaseStateSha256,
      );
      if (existing.confirmed !== options.confirmed) {
        throw new PushExecutionError("PUSH_CONFIRMATION_MISMATCH", "Persisted run confirmation does not match");
      }
      return await resumePush(deps, options.runId, options.signal);
    }
  }

  // All safety checks happen before journaling and, critically, before a pusher
  // can reach either remote service.
  const plan = loadInitialPlan(deps, options);
  const runId = options.runId ?? deps.createRunId?.() ?? randomUUID();
  publishPushProgress(deps, { runId, phase: "prepare", completed: 0, total: plan.items.length });
  const candidate = newSidecar(plan, runId, options.confirmed, now(deps));
  const sidecar = await initializeSidecar(deps, candidate);
  const log = new PushLogStore(deps.db);
  log.initialize(plan, runId, now(deps).toISOString());
  const state: ExecutionState = {
    plan,
    sidecar,
    context: { runId, scope: options.scope, signal: options.signal },
    log,
    stop: false,
  };
  assertResumeFence(deps, plan, sidecar, log.list(
    sidecar.scope.projectId,
    toStorageProjectVersionId(sidecar.scope.projectVersionId),
    runId,
  ));
  await executePending(deps, state);
  return await finish(deps, state, 0, requestedPageSize);
}

export async function resumePush(
  deps: PushDeps,
  runId: string,
  signal?: AbortSignal,
  keys?: readonly string[],
): Promise<PushReport> {
  const loaded = loadPushSidecar(deps, runId);
  if (loaded === null) throw new PushExecutionError("PUSH_NOT_FOUND", `Push ${runId} is not persisted`);
  const plan = loadResumePlan(deps, loaded);
  const log = new PushLogStore(deps.db);
  log.initialize(plan, runId, loaded.createdAt);
  const state: ExecutionState = {
    plan,
    sidecar: loaded,
    context: { runId, scope: loaded.scope, signal },
    log,
    stop: false,
  };
  const entries = log.list(
    loaded.scope.projectId,
    toStorageProjectVersionId(loaded.scope.projectVersionId),
    runId,
  );
  assertResumeFence(deps, plan, loaded, entries);
  await reconcilePending(deps, state);
  if (state.sidecar.requiresPull || state.sidecar.terminalError !== null) {
    state.stop = true;
  }
  if (!state.stop) {
    const selected = keys === undefined ? null : new Set(keys);
    for (const entry of log.list(
      loaded.scope.projectId,
      toStorageProjectVersionId(loaded.scope.projectVersionId),
      runId,
    )) {
      if (
        entry.status === "failed"
        && entry.error?.retryable === true
        && (selected === null || selected.has(entry.key))
      ) {
        log.resetRetryable(entry);
      }
    }
    assertResumeFence(deps, plan, state.sidecar, log.list(
      loaded.scope.projectId,
      toStorageProjectVersionId(loaded.scope.projectVersionId),
      runId,
    ));
    await executePending(deps, state);
  }
  return await finish(deps, state, 0, PAGE_SIZE_MAX);
}

/** Frozen v1 has no actor-authenticated capability mint, so RPC must fail closed. */
export function pushAuthorizationUnavailable(_deps: PushDeps, _capability: string): never {
  throw new PushExecutionError(
    "PUSH_AUTHORIZATION_UNAVAILABLE",
    `Push ${HUMAN_APPROVAL_CAPABILITY_POLICY.handlerDisposition}`,
  );
}

export type {
  ApplyResult,
  EntityPusher,
  PushContext,
  PushDeps,
  PushErrorDetail,
  PushItemResult,
  PushOptions,
  PushReport,
} from "./types.js";
export { registerTypedPusher } from "./pushers.js";
