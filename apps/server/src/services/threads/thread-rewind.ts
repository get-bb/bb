import { asc, desc, eq } from "drizzle-orm";
import {
  abandonThreadBranchInTransaction,
  activateThreadBranchInTransaction,
  bindThreadBranchProviderSessionInTransaction,
  createThreadBranchInTransaction,
  events,
  getEnvironment,
  getActivePendingInteractionForThread,
  getActiveThreadBranch,
  getActiveThreadBranchId,
  getThread,
  getThreadBranch,
  getThreadBranchIdAtOrBeforeSequence,
  incrementRewindRolloutMetric,
  listThreadBranches,
  listStagedThreadBranches,
  queuedThreadMessages,
  updateThreadBranchCleanupResult,
  resolveThreadRewindCheckpoint,
  restoreThreadBranchInTransaction,
  type DbQueryConnection,
  type StoredThreadBranch,
  type StoredEventRow,
  type StoredThreadRewindCheckpoint,
} from "@bb/db";
import {
  promptInputSchema,
  threadRewindRequestSchema,
  threadScope,
  type ClientTurnRequestId,
  type Environment,
  type JsonValue,
  type PromptInput,
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadEvent,
  type ThreadEventType,
  type ThreadRewindIneligibilityReason,
  type ThreadRewindProviderAnchor,
  type ThreadRewindRequest,
  type ThreadRewindResult,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { LIVE_DAEMON_COMMAND_TIMEOUT_MS } from "../hosts/live-command.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import { prepareReadyThreadTurnCommand } from "./thread-lifecycle.js";
import {
  buildExecutionOptions,
  buildThreadStartCommand,
} from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  appendThreadEventInTransaction,
  createClientTurnRequestId,
} from "./thread-events.js";
import { parseStoredEvent } from "./thread-data.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { requireReadyThreadEnvironment } from "./thread-turn-dispatch.js";

/**
 * Aggregate rollout counters. Names are fixed and values are integers only,
 * so no prompt content, thread ids, or provider identifiers are recorded.
 * The split between provider failures and BB reconciliation failures is what
 * makes soak reports actionable.
 */
export const REWIND_ROLLOUT_METRICS = [
  "preview_denied",
  "provider_branch_failure",
  "activation_failure",
  "edited_turn_failure",
  "restore",
  "orphan_cleanup",
  "experiment_denied",
] as const;
export type RewindRolloutMetric = (typeof REWIND_ROLLOUT_METRICS)[number];

function countRewindMetric(
  deps: Pick<ThreadRewindDeps, "db">,
  metric: RewindRolloutMetric,
): void {
  incrementRewindRolloutMetric(deps.db, metric);
}

/** Server dependencies used by the rewind orchestration boundary. */
export type ThreadRewindDeps = LoggedPendingInteractionWorkSessionDeps;

export interface ThreadRewindPreviewWithRevision {
  displacedTurnCount: number;
  eligibility:
    | { status: "eligible" }
    | {
        reason: ThreadRewindIneligibilityReason;
        status: "ineligible";
      };
  mode: "conversation-only";
  provider: "codex" | "claude-code";
  revision: number;
  sourceSequence: number;
  startsFreshProviderSession: boolean;
  target: ThreadRewindRequest["target"];
}

export interface ThreadRewindProviderBranchArgs {
  anchor: ThreadRewindProviderAnchor | null;
  branchId: string;
  editedInput: readonly PromptInput[];
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  sourceProviderThreadId: string | null;
  thread: Thread;
}

export interface ThreadRewindProviderTurnArgs {
  editedInput: readonly PromptInput[];
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  requestId: ClientTurnRequestId;
  thread: Thread;
}

/**
 * Provider work is injectable so the server invariants can be tested without
 * a daemon. The production implementation below uses the existing settled
 * thread.start/turn.submit transport and exact provider fork fields.
 */
export interface ThreadRewindProviderTransport {
  createBranch(
    args: ThreadRewindProviderBranchArgs,
  ): Promise<{ providerThreadId: string }>;
  submitTurn(args: ThreadRewindProviderTurnArgs): Promise<void>;
  cleanupBranch?(args: {
    environment: Environment;
    providerThreadId: string;
    thread: Thread;
  }): Promise<void>;
}

export interface PreviewThreadRewindArgs {
  mode?: "conversation-only";
  /** Optional route-level ownership guard; branch id remains opaque. */
  threadId?: string;
  target: ThreadRewindRequest["target"];
}

export interface CommitThreadRewindArgs {
  idempotencyKey: string;
  preview?: Pick<ThreadRewindPreviewWithRevision, "revision" | "target">;
  request: ThreadRewindRequest;
  /** Optional route-level ownership guard; branch id remains opaque. */
  threadId?: string;
  transport?: ThreadRewindProviderTransport;
}

/** Branch metadata safe for app, SDK, and CLI consumers. */
export interface ThreadRewindBranchView {
  active: boolean;
  activatedAt: number | null;
  cleanupStatus: StoredThreadBranch["cleanupStatus"];
  createdAt: number;
  creationReason: StoredThreadBranch["creationReason"];
  cutoffSequence: number;
  deactivatedAt: number | null;
  id: string;
  lifecycle: StoredThreadBranch["lifecycle"];
  parentBranchId: string | null;
  threadId: string;
  updatedAt: number;
}

export interface ThreadRewindBranchHistory {
  activeBranchId: string | null;
  branches: ThreadRewindBranchView[];
}

export interface RestoreThreadRewindBranchArgs {
  branchId: string;
  expectedActiveBranchId: string;
  threadId: string;
}

export interface RestoreThreadRewindBranchResult {
  activeBranchId: string;
  previousBranchId: string;
  threadId: string;
}

export interface ThreadRewindSubmitted {
  draft: null;
  newBranchId: string;
  previousBranchId: string;
  requestId: ClientTurnRequestId;
  result: ThreadRewindResult;
  submission: "submitted";
}

export interface ThreadRewindDraftRecovery {
  draft: PromptInput[];
  newBranchId: string;
  previousBranchId: string;
  requestId: ClientTurnRequestId;
  result: ThreadRewindResult;
  submission: "draft-recovery";
}

export type CommitThreadRewindResult =
  | ThreadRewindSubmitted
  | ThreadRewindDraftRecovery;

interface ParsedRewindOperation {
  editedInput: PromptInput[];
  idempotencyKey: string;
  newBranchId: string;
  previousBranchId: string;
  requestId: ClientTurnRequestId;
  result: ThreadRewindResult;
  stageRevision: number | null;
  status: RewindOperationStatus;
}

type RewindOperationStatus =
  | "abandoned"
  | "activated"
  | "draft-recovery"
  | "provider-branch-pending"
  | "submitted";

interface ValidatedTarget {
  checkpoint: StoredThreadRewindCheckpoint | null;
  displacedTurnCount: number;
  firstMessage: boolean;
  latestSequence: number;
  requestEvent: Extract<ThreadEvent, { type: "client/turn/requested" }>;
  requestRow: StoredEventRow;
  thread: Thread;
}

const rewindLocks = new Set<string>();

const storedEventFields = {
  createdAt: events.createdAt,
  data: events.data,
  id: events.id,
  itemId: events.itemId,
  itemKind: events.itemKind,
  providerThreadId: events.providerThreadId,
  scopeKind: events.scopeKind,
  sequence: events.sequence,
  threadId: events.threadId,
  turnId: events.turnId,
  type: events.type,
};

function listThreadEventRows(
  db: DbQueryConnection,
  threadId: string,
): StoredEventRow[] {
  return db
    .select(storedEventFields)
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(asc(events.sequence))
    .all();
}

function latestSequence(db: DbQueryConnection, threadId: string): number {
  return (
    db
      .select({ sequence: events.sequence })
      .from(events)
      .where(eq(events.threadId, threadId))
      .orderBy(desc(events.sequence))
      .limit(1)
      .get()?.sequence ?? 0
  );
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, "invalid_request", `${field} cannot be empty`);
  }
  return normalized;
}

function rewindFailure(
  code:
    | "thread-not-idle"
    | "pending-interaction"
    | "queued-input"
    | "rewind-in-progress"
    | "target-ineligible"
    | "provider-branch-failed"
    | "provider-session-unavailable"
    | "branch-commit-failed"
    | "stale-preview",
  message: string,
  retryable: boolean,
): ApiError {
  return new ApiError(409, code, message, { retryable });
}

function parseEventData(row: StoredEventRow): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(row.data);
  } catch {
    throw new ApiError(
      500,
      "internal_error",
      `Stored ${row.type} event #${row.sequence} is not valid JSON`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      500,
      "internal_error",
      `Stored ${row.type} event #${row.sequence} is malformed`,
    );
  }
  return value as Record<string, unknown>;
}

function providerForThread(thread: Thread): "codex" | "claude-code" {
  if (thread.providerId === "codex" || thread.providerId === "claude-code") {
    return thread.providerId;
  }
  throw rewindFailure(
    "target-ineligible",
    `Provider ${thread.providerId} does not support exact conversation rewind`,
    false,
  );
}

function isUserRootTurn(event: ThreadEvent): boolean {
  return (
    event.type === "client/turn/requested" &&
    event.initiator === "user" &&
    (event.target.kind === "thread-start" || event.target.kind === "new-turn")
  );
}

function hasAttachment(input: readonly PromptInput[]): boolean {
  return input.some((item) => item.type !== "text");
}

function hasMention(input: readonly PromptInput[]): boolean {
  return input.some((item) => item.type === "text" && item.mentions.length > 0);
}

function requestRowForTarget(
  rows: readonly StoredEventRow[],
  target: ThreadRewindRequest["target"],
): StoredEventRow | null {
  return (
    rows.find(
      (row) =>
        row.sequence === target.sourceSequence &&
        row.type === "client/turn/requested",
    ) ?? null
  );
}

function requireRequestEvent(
  rows: readonly StoredEventRow[],
  target: ThreadRewindRequest["target"],
): {
  event: Extract<ThreadEvent, { type: "client/turn/requested" }>;
  row: StoredEventRow;
} {
  const row = requestRowForTarget(rows, target);
  if (!row) {
    throw rewindFailure(
      "target-ineligible",
      "The selected message is no longer present in the thread timeline",
      false,
    );
  }
  const event = parseStoredEvent(row);
  if (event.type !== "client/turn/requested") {
    throw rewindFailure(
      "target-ineligible",
      "The selected timeline row is not an editable user message",
      false,
    );
  }
  return { event, row };
}

function isCompletedRootTurn(
  rows: readonly StoredEventRow[],
  requestRow: StoredEventRow,
  targetTurnId: string,
): boolean {
  const requestId = parseEventData(requestRow).requestId;
  if (typeof requestId !== "string") return false;
  const accepted = rows.some((row) => {
    if (row.type !== "turn/input/accepted" || row.turnId !== targetTurnId) {
      return false;
    }
    return parseEventData(row).clientRequestId === requestId;
  });
  return (
    accepted &&
    rows.some(
      (row) => row.type === "turn/completed" && row.turnId === targetTurnId,
    )
  );
}

function isFirstUserRootMessage(
  rows: readonly StoredEventRow[],
  targetSequence: number,
): boolean {
  return (
    rows.filter((row) => {
      if (
        row.sequence > targetSequence ||
        row.type !== "client/turn/requested"
      ) {
        return false;
      }
      try {
        return isUserRootTurn(parseStoredEvent(row));
      } catch {
        return false;
      }
    }).length === 1
  );
}

function countDisplacedTurns(
  rows: readonly StoredEventRow[],
  sourceSequence: number,
): number {
  return rows.filter((row) => {
    if (
      row.sequence <= sourceSequence ||
      row.type !== "client/turn/requested"
    ) {
      return false;
    }
    try {
      return isUserRootTurn(parseStoredEvent(row));
    } catch {
      return false;
    }
  }).length;
}

/**
 * Provider compaction changes the session's replay boundary. A checkpoint
 * before a compaction event cannot safely reconstruct the later provider
 * state, even when the provider still exposes a fork identifier.
 */
function hasCompactionBoundary(
  rows: readonly StoredEventRow[],
  sourceSequence: number,
): boolean {
  return rows.some(
    (row) => row.type === "thread/compacted" && row.sequence > sourceSequence,
  );
}

function targetReason(args: {
  checkpoint: StoredThreadRewindCheckpoint | null;
  checkpointFailure:
    | "ambiguous-provider-checkpoint"
    | "missing-provider-checkpoint"
    | null;
  compactionBoundary: boolean;
  completed: boolean;
  firstMessage: boolean;
  requestEvent: Extract<ThreadEvent, { type: "client/turn/requested" }>;
}): ThreadRewindIneligibilityReason | null {
  if (!isUserRootTurn(args.requestEvent)) return "not-human-root-turn";
  if (
    args.requestEvent.inputGroups &&
    args.requestEvent.inputGroups.length > 1
  ) {
    return "grouped-input";
  }
  if (hasAttachment(args.requestEvent.input))
    return "attachments-not-supported";
  if (hasMention(args.requestEvent.input)) return "mentions-not-supported";
  if (!args.completed) return "turn-incomplete";
  if (args.compactionBoundary) return "compaction-boundary";
  if (!args.firstMessage && args.checkpoint === null) {
    return args.checkpointFailure ?? "missing-provider-checkpoint";
  }
  return null;
}

function acquireRewindLock(threadId: string): () => void {
  if (rewindLocks.has(threadId)) {
    throw rewindFailure(
      "rewind-in-progress",
      "A rewind is already being applied to this thread",
      true,
    );
  }
  rewindLocks.add(threadId);
  return () => rewindLocks.delete(threadId);
}

function queuedInputCount(db: DbQueryConnection, threadId: string): number {
  return db
    .select({ id: queuedThreadMessages.id })
    .from(queuedThreadMessages)
    .where(eq(queuedThreadMessages.threadId, threadId))
    .all().length;
}

function assertIdleAndWritable(db: DbQueryConnection, thread: Thread): void {
  if (thread.status !== "idle") {
    throw rewindFailure(
      "thread-not-idle",
      "The thread must be idle before it can be rewound",
      true,
    );
  }
  if (thread.archivedAt !== null || thread.deletedAt !== null) {
    throw rewindFailure(
      "target-ineligible",
      "Archived or deleted threads cannot be rewound",
      false,
    );
  }
  if (getActivePendingInteractionForThread(db, thread.id)) {
    throw rewindFailure(
      "pending-interaction",
      "Resolve the pending interaction before rewinding the thread",
      true,
    );
  }
  if (queuedInputCount(db, thread.id) > 0) {
    throw rewindFailure(
      "queued-input",
      "Send or remove queued input before rewinding the thread",
      true,
    );
  }
}

function previewStateReason(
  db: DbQueryConnection,
  thread: Thread,
): ThreadRewindIneligibilityReason | null {
  if (thread.status !== "idle") return "thread-not-idle";
  if (getActivePendingInteractionForThread(db, thread.id)) {
    return "pending-interaction";
  }
  if (queuedInputCount(db, thread.id) > 0) return "queued-input";
  return null;
}

function operationData(args: {
  editedInput: readonly PromptInput[];
  idempotencyKey: string;
  newBranchId: string;
  previousBranchId: string;
  requestId: ClientTurnRequestId;
  result: ThreadRewindResult;
  stageRevision?: number | null;
  status: RewindOperationStatus;
}): {
  metadata: Record<string, JsonValue>;
  operation: "thread_rewind";
  operationId: string;
  status: string;
  message: string;
} {
  return {
    operation: "thread_rewind",
    operationId: args.idempotencyKey,
    status: args.status,
    message:
      args.status === "provider-branch-pending"
        ? "Rewind provider branch creation is pending"
        : args.status === "abandoned"
          ? "Rewind provider branch was abandoned before activation"
          : args.status === "activated"
            ? "Rewind branch activated; edited turn is pending submission"
            : args.status === "draft-recovery"
              ? "Rewind branch activated; edited turn is available for recovery"
              : "Edited turn submitted on rewound branch",
    metadata: {
      displacedTurnCount: args.result.displacedTurnCount,
      editedInput: [...args.editedInput],
      mode: args.result.mode,
      newBranchId: args.newBranchId,
      previousBranchId: args.previousBranchId,
      requestId: args.requestId,
      ...(args.stageRevision !== undefined
        ? { stageRevision: args.stageRevision }
        : {}),
      sourceSequence: args.result.sourceSequence,
      threadId: args.result.threadId,
    },
  };
}

function appendOperationInTransaction(
  tx: Parameters<typeof appendThreadEventInTransaction>[0],
  thread: Thread,
  operation: ParsedRewindOperation,
  status: RewindOperationStatus,
  providerThreadId?: string | null,
): number {
  return appendThreadEventInTransaction(tx, {
    threadId: thread.id,
    environmentId: thread.environmentId,
    providerThreadId:
      providerThreadId === undefined
        ? getActiveThreadBranch(tx, thread.id)?.providerThreadId
        : providerThreadId,
    type: "system/operation",
    scope: threadScope(),
    data: operationData({ ...operation, status }),
  });
}

function appendOperation(
  deps: Pick<ThreadRewindDeps, "db">,
  thread: Thread,
  operation: ParsedRewindOperation,
  status: RewindOperationStatus,
): void {
  deps.db.transaction(
    (tx) => {
      appendOperationInTransaction(tx, thread, operation, status);
    },
    { behavior: "immediate" },
  );
}

function notifyRewind(
  deps: Pick<ThreadRewindDeps, "hub">,
  thread: Thread,
  eventTypes: readonly ThreadEventType[],
): void {
  deps.hub.notifyThread(thread.id, ["events-appended", "status-changed"], {
    eventTypes,
    projectId: thread.projectId,
  });
}

function parseOperation(
  db: DbQueryConnection,
  threadId: string,
  idempotencyKey: string,
): ParsedRewindOperation | null {
  const rows = listThreadEventRows(db, threadId);
  for (const row of [...rows].reverse()) {
    if (row.type !== "system/operation") continue;
    const data = parseEventData(row);
    if (
      data.operation !== "thread_rewind" ||
      data.operationId !== idempotencyKey
    ) {
      continue;
    }
    const metadata =
      data.metadata &&
      typeof data.metadata === "object" &&
      !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : null;
    if (!metadata) continue;
    const newBranchId = metadata.newBranchId;
    const previousBranchId = metadata.previousBranchId;
    const requestId = metadata.requestId;
    const sourceSequence = metadata.sourceSequence;
    const displacedTurnCount = metadata.displacedTurnCount;
    const stageRevision = metadata.stageRevision;
    const inputValues = Array.isArray(metadata.editedInput)
      ? metadata.editedInput.map((value) => promptInputSchema.safeParse(value))
      : [];
    if (
      typeof newBranchId !== "string" ||
      typeof previousBranchId !== "string" ||
      typeof requestId !== "string" ||
      typeof sourceSequence !== "number" ||
      typeof displacedTurnCount !== "number" ||
      inputValues.length === 0 ||
      inputValues.some((value) => !value.success)
    ) {
      continue;
    }
    if (
      data.status !== "abandoned" &&
      data.status !== "activated" &&
      data.status !== "draft-recovery" &&
      data.status !== "provider-branch-pending" &&
      data.status !== "submitted"
    ) {
      continue;
    }
    const parsedRequestId = requestId as ClientTurnRequestId;
    const editedInput = inputValues.flatMap((value) =>
      value.success ? [value.data] : [],
    );
    return {
      editedInput,
      idempotencyKey,
      newBranchId,
      previousBranchId,
      requestId: parsedRequestId,
      result: {
        displacedTurnCount,
        mode: "conversation-only",
        previousBranchId,
        sourceSequence,
        threadId,
      },
      stageRevision: typeof stageRevision === "number" ? stageRevision : null,
      status: data.status,
    };
  }
  return null;
}

/**
 * A provider can accept the edited request after the server has persisted the
 * activation reservation but before it records the final operation status.
 * That window is expected across a server restart, so the request's durable
 * input-accepted event is the source of truth for replay reconciliation.
 */
function operationSubmissionWasAccepted(
  db: DbQueryConnection,
  threadId: string,
  requestId: ClientTurnRequestId,
): boolean {
  const rows = listThreadEventRows(db, threadId);
  return rows.some((row) => {
    if (row.type !== "turn/input/accepted") return false;
    const data = parseEventData(row);
    return data.clientRequestId === requestId;
  });
}

function storedOperationResult(
  operation: ParsedRewindOperation,
): CommitThreadRewindResult | null {
  if (operation.status === "draft-recovery") {
    return {
      draft: operation.editedInput,
      newBranchId: operation.newBranchId,
      previousBranchId: operation.previousBranchId,
      requestId: operation.requestId,
      result: operation.result,
      submission: "draft-recovery",
    };
  }
  if (operation.status === "submitted") {
    return {
      draft: null,
      newBranchId: operation.newBranchId,
      previousBranchId: operation.previousBranchId,
      requestId: operation.requestId,
      result: operation.result,
      submission: "submitted",
    };
  }
  return null;
}

function assertPreviewIsCurrent(
  preview:
    | Pick<ThreadRewindPreviewWithRevision, "revision" | "target">
    | undefined,
  target: ThreadRewindRequest["target"],
  current: ValidatedTarget,
): void {
  if (!preview) return;
  if (
    preview.revision !== current.latestSequence ||
    preview.target.branchId !== target.branchId ||
    preview.target.sourceSequence !== target.sourceSequence ||
    preview.target.turnId !== target.turnId
  ) {
    throw rewindFailure(
      "stale-preview",
      "The thread changed after preview; reopen the rewind confirmation",
      true,
    );
  }
}

async function validateTarget(
  db: DbQueryConnection,
  target: ThreadRewindRequest["target"],
): Promise<ValidatedTarget> {
  const branch = getThreadBranch(db, target.branchId);
  const thread = branch ? getThread(db, branch.threadId) : null;
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  providerForThread(thread);
  const rows = listThreadEventRows(db, thread.id);
  const request = requireRequestEvent(rows, target);
  const active = getActiveThreadBranch(db, thread.id);
  if (!active || active.id !== target.branchId) {
    throw rewindFailure(
      "stale-preview",
      "The selected message is not on the active thread branch",
      true,
    );
  }
  if (
    getThreadBranchIdAtOrBeforeSequence(db, {
      sequence: target.sourceSequence,
      threadId: thread.id,
    }) !== target.branchId
  ) {
    throw rewindFailure(
      "stale-preview",
      "The selected message belongs to a different branch",
      true,
    );
  }
  const checkpointResult = resolveThreadRewindCheckpoint(db, {
    branchId: target.branchId,
    sourceSequence: target.sourceSequence,
    threadId: thread.id,
  });
  const checkpoint =
    checkpointResult.outcome === "eligible"
      ? checkpointResult.checkpoint
      : null;
  const firstMessage = isFirstUserRootMessage(rows, target.sourceSequence);
  const reason = targetReason({
    checkpoint,
    checkpointFailure:
      checkpointResult.outcome === "ineligible"
        ? checkpointResult.reason
        : null,
    compactionBoundary: hasCompactionBoundary(rows, target.sourceSequence),
    completed: isCompletedRootTurn(rows, request.row, target.turnId),
    firstMessage,
    requestEvent: request.event,
  });
  if (reason !== null) {
    throw rewindFailure(
      "target-ineligible",
      `The selected message cannot be rewound (${reason})`,
      false,
    );
  }
  return {
    checkpoint,
    displacedTurnCount: countDisplacedTurns(rows, target.sourceSequence),
    firstMessage,
    latestSequence: latestSequence(db, thread.id),
    requestEvent: request.event,
    requestRow: request.row,
    thread,
  };
}

/** Read-only eligibility query with an optimistic revision for commit. */
export async function previewThreadRewind(
  deps: Pick<ThreadRewindDeps, "db">,
  args: PreviewThreadRewindArgs,
): Promise<ThreadRewindPreviewWithRevision> {
  const branch = getThreadBranch(deps.db, args.target.branchId);
  const thread = branch ? getThread(deps.db, branch.threadId) : null;
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  if (args.threadId !== undefined && thread.id !== args.threadId) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const provider = providerForThread(thread);
  const rows = listThreadEventRows(deps.db, thread.id);
  const request = requireRequestEvent(rows, args.target);
  const active = getActiveThreadBranch(deps.db, thread.id);
  const branchAtTarget = getThreadBranchIdAtOrBeforeSequence(deps.db, {
    sequence: args.target.sourceSequence,
    threadId: thread.id,
  });
  const checkpointResult = resolveThreadRewindCheckpoint(deps.db, {
    branchId: args.target.branchId,
    sourceSequence: args.target.sourceSequence,
    threadId: thread.id,
  });
  const checkpoint =
    checkpointResult.outcome === "eligible"
      ? checkpointResult.checkpoint
      : null;
  const firstMessage = isFirstUserRootMessage(rows, args.target.sourceSequence);
  let reason: ThreadRewindIneligibilityReason | null = null;
  if (thread.archivedAt !== null) reason = "archived-thread";
  else if (thread.originKind === "fork" || thread.originPluginId !== null) {
    reason = "fork-thread";
  } else if (
    active?.id !== args.target.branchId ||
    branchAtTarget !== args.target.branchId
  ) {
    reason = "stale-preview";
  } else {
    reason =
      previewStateReason(deps.db, thread) ??
      targetReason({
        checkpoint,
        checkpointFailure:
          checkpointResult.outcome === "ineligible"
            ? checkpointResult.reason
            : null,
        compactionBoundary: hasCompactionBoundary(
          rows,
          args.target.sourceSequence,
        ),
        completed: isCompletedRootTurn(rows, request.row, args.target.turnId),
        firstMessage,
        requestEvent: request.event,
      });
  }
  if (reason !== null) {
    countRewindMetric(deps, "preview_denied");
  }
  return {
    displacedTurnCount: countDisplacedTurns(rows, args.target.sourceSequence),
    eligibility:
      reason === null
        ? { status: "eligible" }
        : { reason, status: "ineligible" },
    mode: args.mode ?? "conversation-only",
    provider,
    revision: latestSequence(deps.db, thread.id),
    sourceSequence: args.target.sourceSequence,
    startsFreshProviderSession: firstMessage && checkpoint === null,
    target: args.target,
  };
}

function toThreadRewindBranchView(
  branch: StoredThreadBranch,
  activeBranchId: string | null,
): ThreadRewindBranchView {
  return {
    active: branch.id === activeBranchId,
    activatedAt: branch.activatedAt,
    cleanupStatus: branch.cleanupStatus,
    createdAt: branch.createdAt,
    creationReason: branch.creationReason,
    cutoffSequence: branch.cutoffSequence,
    deactivatedAt: branch.deactivatedAt,
    id: branch.id,
    lifecycle: branch.lifecycle,
    parentBranchId: branch.parentBranchId,
    threadId: branch.threadId,
    updatedAt: branch.updatedAt,
  };
}

/**
 * List immutable branch lineage without exposing provider session IDs or
 * checkpoint anchors. The active pointer is returned separately so callers do
 * not infer activity from lifecycle timestamps during a restore race.
 */
export function listThreadRewindBranches(
  deps: Pick<ThreadRewindDeps, "db">,
  args: { threadId: string },
): ThreadRewindBranchHistory {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const activeBranchId = getActiveThreadBranchId(deps.db, thread.id);
  return {
    activeBranchId,
    branches: listThreadBranches(deps.db, { threadId: thread.id }).map(
      (branch) => toThreadRewindBranchView(branch, activeBranchId),
    ),
  };
}

/**
 * Restore an existing provider branch for recovery. This operation changes
 * only BB's active conversation projection; it never attempts filesystem
 * restoration and it requires the thread to be idle with no queued or
 * pending input. The expected active branch is a compare-and-swap guard.
 */
export function restoreThreadRewindBranch(
  deps: ThreadRewindDeps,
  args: RestoreThreadRewindBranchArgs,
): RestoreThreadRewindBranchResult {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const branch = getThreadBranch(deps.db, args.branchId);
  if (!branch || branch.threadId !== thread.id) {
    throw new ApiError(404, "thread_not_found", "Thread branch not found");
  }
  const release = acquireRewindLock(thread.id);
  try {
    assertIdleAndWritable(deps.db, thread);
    const active = getActiveThreadBranch(deps.db, thread.id);
    if (!active) {
      throw rewindFailure(
        "provider-session-unavailable",
        "The thread has no active conversation branch",
        true,
      );
    }
    if (active.id !== args.expectedActiveBranchId) {
      throw rewindFailure(
        "stale-preview",
        "The thread changed after branch history was read",
        true,
      );
    }
    if (branch.lifecycle === "abandoned") {
      throw rewindFailure(
        "target-ineligible",
        "An abandoned conversation branch cannot be restored",
        false,
      );
    }
    if (branch.id === active.id) {
      return {
        activeBranchId: active.id,
        previousBranchId: active.id,
        threadId: thread.id,
      };
    }

    let result: RestoreThreadRewindBranchResult;
    try {
      result = deps.db.transaction(
        (tx) => {
          const current = getThread(tx, thread.id);
          const currentActive = getActiveThreadBranch(tx, thread.id);
          if (!current || !currentActive) {
            throw rewindFailure(
              "stale-preview",
              "The thread changed during branch restore",
              true,
            );
          }
          assertIdleAndWritable(tx, current);
          if (currentActive.id !== args.expectedActiveBranchId) {
            throw rewindFailure(
              "stale-preview",
              "The thread changed during branch restore",
              true,
            );
          }
          const restored = getThreadBranch(tx, args.branchId);
          if (!restored || restored.threadId !== current.id) {
            throw new ApiError(
              404,
              "thread_not_found",
              "Thread branch not found",
            );
          }
          if (restored.lifecycle === "abandoned") {
            throw rewindFailure(
              "target-ineligible",
              "An abandoned conversation branch cannot be restored",
              false,
            );
          }
          restoreThreadBranchInTransaction(tx, { branchId: restored.id });
          appendThreadEventInTransaction(tx, {
            threadId: current.id,
            environmentId: current.environmentId,
            providerThreadId: restored.providerThreadId,
            type: "system/operation",
            scope: threadScope(),
            data: {
              operation: "thread_rewind_restore",
              operationId: createClientTurnRequestId(),
              status: "restored",
              message: "Conversation branch restored",
              metadata: {
                activeBranchId: restored.id,
                previousBranchId: currentActive.id,
                threadId: current.id,
              },
            },
          });
          return {
            activeBranchId: restored.id,
            previousBranchId: currentActive.id,
            threadId: current.id,
          };
        },
        { behavior: "immediate" },
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw rewindFailure(
        "branch-commit-failed",
        "Could not restore the conversation branch",
        true,
      );
    }
    countRewindMetric(deps, "restore");
    notifyRewind(deps, thread, ["system/operation"]);
    return result;
  } finally {
    release();
  }
}

function hostTransport(deps: ThreadRewindDeps): ThreadRewindProviderTransport {
  return {
    async createBranch(args) {
      const requestId = createClientTurnRequestId();
      const base = await buildThreadStartCommand(deps, {
        environment: {
          id: args.environment.id,
          hostId: args.environment.hostId,
          path: args.environment.path,
          status: args.environment.status,
          workspaceProvisionType: args.environment.workspaceProvisionType,
        },
        execution: args.execution,
        fork:
          args.anchor && args.sourceProviderThreadId
            ? { sourceProviderThreadId: args.sourceProviderThreadId }
            : null,
        input: [],
        permissionEscalation: resolvePermissionEscalation({
          initiator: "user",
          thread: args.thread,
        }),
        projectId: args.thread.projectId,
        providerId: args.thread.providerId,
        requestId,
        sessionOnly: args.anchor === null,
        syncGeneratedTitle: false,
        thread: args.thread,
      });
      const fork: NonNullable<
        Extract<HostDaemonCommand, { type: "thread.start" }>["fork"]
      > | null =
        args.anchor && args.sourceProviderThreadId
          ? {
              sourceProviderThreadId: args.sourceProviderThreadId,
              ...(args.anchor.provider === "codex"
                ? { lastTurnId: args.anchor.turnId }
                : { sourceProviderMessageId: args.anchor.messageId }),
            }
          : null;
      const result = await callHostOnlineRpc(deps, {
        command: { ...base, ...(fork ? { fork } : {}) },
        hostId: args.environment.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      });
      return { providerThreadId: result.providerThreadId };
    },
    async submitTurn(args) {
      const environment = requireReadyThreadEnvironment(args.environment);
      const prepared = await prepareReadyThreadTurnCommand(deps, {
        environment,
        execution: args.execution,
        fork: null,
        input: [...args.editedInput],
        permissionEscalation: resolvePermissionEscalation({
          initiator: "user",
          thread: args.thread,
        }),
        projectId: args.thread.projectId,
        providerId: args.thread.providerId,
        requestId: args.requestId,
        syncGeneratedTitle: false,
        thread: args.thread,
      });
      if (prepared.mode !== "turn.submit") {
        throw rewindFailure(
          "provider-session-unavailable",
          "The rewound branch did not expose a provider session for submission",
          true,
        );
      }
      await callHostOnlineRpc(deps, {
        command: prepared.command,
        hostId: environment.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      });
    },
  };
}

function operationFromCommit(args: {
  editedInput: readonly PromptInput[];
  idempotencyKey: string;
  newBranchId: string;
  previousBranchId: string;
  requestId: ClientTurnRequestId;
  result: ThreadRewindResult;
  stageRevision?: number | null;
  status?: RewindOperationStatus;
}): ParsedRewindOperation {
  return {
    ...args,
    editedInput: [...args.editedInput],
    stageRevision: args.stageRevision ?? null,
    status: args.status ?? "activated",
  };
}

interface StagedRewind {
  execution: ResolvedThreadExecutionOptions;
  operation: ParsedRewindOperation;
  target: ValidatedTarget;
  thread: Thread;
}

interface ResumedRewind {
  environment: Environment;
  execution: ResolvedThreadExecutionOptions;
  operation: ParsedRewindOperation;
  target: ValidatedTarget;
}

function stageRewind(
  deps: ThreadRewindDeps,
  args: {
    execution: ResolvedThreadExecutionOptions;
    idempotencyKey: string;
    request: ThreadRewindRequest;
    target: ValidatedTarget;
  },
): StagedRewind {
  const requestId = createClientTurnRequestId();
  const result: ThreadRewindResult = {
    displacedTurnCount: args.target.displacedTurnCount,
    mode: args.request.mode,
    previousBranchId: args.request.target.branchId,
    sourceSequence: args.request.target.sourceSequence,
    threadId: args.target.thread.id,
  };
  const staged = deps.db.transaction(
    (tx) => {
      const current = getThread(tx, args.target.thread.id);
      const active = getActiveThreadBranch(tx, args.target.thread.id);
      if (!current || !active) {
        throw rewindFailure(
          "stale-preview",
          "The thread changed during rewind reservation",
          true,
        );
      }
      assertIdleAndWritable(tx, current);
      if (
        active.id !== args.request.target.branchId ||
        latestSequence(tx, args.target.thread.id) !== args.target.latestSequence
      ) {
        throw rewindFailure(
          "stale-preview",
          "The thread changed during rewind reservation",
          true,
        );
      }
      const branch = createThreadBranchInTransaction(tx, {
        cutoffSequence: Math.max(0, args.request.target.sourceSequence - 1),
        creationReason: "rewind",
        parentBranchId: active.id,
        providerId: current.providerId,
        // The provider session is bound only after the host confirms creation.
        providerThreadId: null,
        threadId: current.id,
      });
      const stageRevision = latestSequence(tx, current.id) + 1;
      const operation = operationFromCommit({
        editedInput: args.request.editedInput,
        idempotencyKey: args.idempotencyKey,
        newBranchId: branch.id,
        previousBranchId: active.id,
        requestId,
        result: { ...result, previousBranchId: active.id },
        stageRevision,
        status: "provider-branch-pending",
      });
      const operationSequence = appendOperationInTransaction(
        tx,
        current,
        operation,
        "provider-branch-pending",
        active.providerThreadId,
      );
      if (operationSequence !== stageRevision) {
        throw new Error("Rewind reservation sequence was not contiguous");
      }
      const preparing = applyLoggedThreadLifecycleEventInTransaction(
        { db: tx, logger: deps.logger },
        { event: { type: "run.preparing" }, threadId: current.id },
      );
      if (!preparing.applied) {
        throw rewindFailure(
          "branch-commit-failed",
          "Could not reserve the rewound thread",
          true,
        );
      }
      return { branch, operation, thread: current };
    },
    { behavior: "immediate" },
  );
  return {
    execution: args.execution,
    operation: staged.operation,
    target: args.target,
    thread: staged.thread,
  };
}

function activateStagedRewind(
  deps: ThreadRewindDeps,
  args: {
    execution: ResolvedThreadExecutionOptions;
    operation: ParsedRewindOperation;
    providerThreadId: string;
    request: ThreadRewindRequest;
    target: ValidatedTarget;
  },
): ParsedRewindOperation {
  return deps.db.transaction(
    (tx) => {
      const current = getThread(tx, args.target.thread.id);
      const active = getActiveThreadBranch(tx, args.target.thread.id);
      const branch = getThreadBranch(tx, args.operation.newBranchId);
      if (!current || !active || !branch) {
        throw rewindFailure(
          "stale-preview",
          "The thread changed before branch activation",
          true,
        );
      }
      if (
        current.status !== "starting" ||
        current.archivedAt !== null ||
        current.deletedAt !== null ||
        current.environmentId !== args.target.thread.environmentId ||
        active.id !== args.operation.previousBranchId ||
        branch.lifecycle !== "staged" ||
        args.operation.stageRevision === null ||
        latestSequence(tx, current.id) !== args.operation.stageRevision
      ) {
        throw rewindFailure(
          "stale-preview",
          "The thread changed before branch activation",
          true,
        );
      }
      const bound = bindThreadBranchProviderSessionInTransaction(tx, {
        branchId: branch.id,
        providerThreadId: args.providerThreadId,
      });
      activateThreadBranchInTransaction(tx, { branchId: bound.id });
      const activatedOperation: ParsedRewindOperation = {
        ...args.operation,
        status: "activated",
      };
      appendOperationInTransaction(
        tx,
        current,
        activatedOperation,
        "activated",
        args.providerThreadId,
      );
      appendPreparedClientTurnRequestedEventWithNotificationInTransaction(tx, {
        environmentId: current.environmentId,
        execution: args.execution,
        initiator: "user",
        input: args.request.editedInput,
        requestId: args.operation.requestId,
        requestMethod: "turn/start",
        senderThreadId: null,
        source: "tell",
        target: { kind: "new-turn" },
        threadId: current.id,
        type: "client/turn/requested",
      });
      return activatedOperation;
    },
    { behavior: "immediate" },
  );
}

async function cleanupProviderBranch(
  deps: ThreadRewindDeps,
  args: {
    branchId: string;
    environment: Environment;
    providerThreadId: string | null;
    thread: Thread;
    transport: ThreadRewindProviderTransport;
  },
): Promise<void> {
  if (!args.providerThreadId || !args.transport.cleanupBranch) return;
  try {
    await args.transport.cleanupBranch({
      environment: args.environment,
      providerThreadId: args.providerThreadId,
      thread: args.thread,
    });
    countRewindMetric(deps, "orphan_cleanup");
    updateThreadBranchCleanupResult(deps.db, {
      branchId: args.branchId,
      status: "completed",
    });
  } catch (error) {
    try {
      updateThreadBranchCleanupResult(deps.db, {
        branchId: args.branchId,
        error: error instanceof Error ? error.message : String(error),
        status: "failed",
      });
    } catch {
      // Keep the original provider cleanup failure; the branch remains
      // durable and a later maintenance pass can retry it.
    }
  }
}

async function abandonStagedRewind(
  deps: ThreadRewindDeps,
  args: {
    environment: Environment;
    error?: string;
    operation: ParsedRewindOperation;
    providerThreadId?: string | null;
    thread: Thread;
    transport: ThreadRewindProviderTransport;
  },
): Promise<void> {
  let cleanupProviderThreadId: string | null = args.providerThreadId ?? null;
  try {
    deps.db.transaction(
      (tx) => {
        const branch = getThreadBranch(tx, args.operation.newBranchId);
        if (branch && branch.lifecycle !== "active") {
          if (cleanupProviderThreadId && branch.providerThreadId === null) {
            bindThreadBranchProviderSessionInTransaction(tx, {
              branchId: branch.id,
              providerThreadId: cleanupProviderThreadId,
            });
          }
          const abandoned = abandonThreadBranchInTransaction(tx, {
            branchId: branch.id,
            error: args.error ?? null,
          });
          cleanupProviderThreadId = abandoned.providerThreadId;
        }
        const current = getThread(tx, args.thread.id);
        if (!current) return;
        const active = getActiveThreadBranch(tx, current.id);
        if (
          current.status === "starting" &&
          active?.id === args.operation.previousBranchId
        ) {
          applyLoggedThreadLifecycleEventInTransaction(
            { db: tx, logger: deps.logger },
            { event: { type: "run.succeeded" }, threadId: current.id },
          );
        }
        appendOperationInTransaction(
          tx,
          current,
          args.operation,
          "abandoned",
          cleanupProviderThreadId,
        );
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    deps.logger.warn(
      {
        err: error,
        threadId: args.thread.id,
        rewindBranchId: args.operation.newBranchId,
      },
      "Failed to persist abandoned rewind state",
    );
  }
  await cleanupProviderBranch(deps, {
    branchId: args.operation.newBranchId,
    environment: args.environment,
    providerThreadId: cleanupProviderThreadId,
    thread: args.thread,
    transport: args.transport,
  });
}

function operationForStagedBranch(
  db: DbQueryConnection,
  branch: { id: string; threadId: string },
): ParsedRewindOperation | null {
  const rows = listThreadEventRows(db, branch.threadId);
  for (const row of [...rows].reverse()) {
    if (row.type !== "system/operation") continue;
    const data = parseEventData(row);
    const metadata =
      data.metadata &&
      typeof data.metadata === "object" &&
      !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : null;
    if (
      data.operation !== "thread_rewind" ||
      typeof data.operationId !== "string" ||
      metadata?.newBranchId !== branch.id
    ) {
      continue;
    }
    return parseOperation(db, branch.threadId, data.operationId);
  }
  return null;
}

/**
 * Reconcile staged rewind reservations from durable branch/event state. This
 * is safe to call from a fresh server process or a second server process: the
 * staged branch never owns the active pointer, and only a reservation whose
 * thread is still starting on the original branch is left for commit retry.
 * Known provider sessions remain cleanup-pending on the branch until a host
 * transport is available.
 */
export async function reconcileThreadRewindOperations(
  deps: ThreadRewindDeps,
  args: {
    threadId?: string;
    transport?: ThreadRewindProviderTransport;
  } = {},
): Promise<number> {
  let reconciled = 0;
  for (const branch of listStagedThreadBranches(deps.db)) {
    if (args.threadId !== undefined && branch.threadId !== args.threadId) {
      continue;
    }
    const thread = getThread(deps.db, branch.threadId);
    if (!thread) continue;
    const operation = operationForStagedBranch(deps.db, branch);
    const active = getActiveThreadBranch(deps.db, thread.id);
    if (
      operation?.status === "provider-branch-pending" &&
      thread.status === "starting" &&
      active?.id === operation.previousBranchId
    ) {
      continue;
    }

    let providerThreadId: string | null = branch.providerThreadId;
    deps.db.transaction(
      (tx) => {
        const currentBranch = getThreadBranch(tx, branch.id);
        if (!currentBranch || currentBranch.lifecycle !== "staged") return;
        const abandoned = abandonThreadBranchInTransaction(tx, {
          branchId: currentBranch.id,
          error: "Recovered abandoned rewind reservation",
        });
        providerThreadId = abandoned.providerThreadId;
        const currentThread = getThread(tx, thread.id);
        if (!currentThread) return;
        const currentActive = getActiveThreadBranch(tx, thread.id);
        if (
          currentThread.status === "starting" &&
          currentActive !== null &&
          (operation === null ||
            currentActive.id === operation.previousBranchId)
        ) {
          applyLoggedThreadLifecycleEventInTransaction(
            { db: tx, logger: deps.logger },
            { event: { type: "run.succeeded" }, threadId: thread.id },
          );
        }
        if (operation) {
          appendOperationInTransaction(
            tx,
            currentThread,
            operation,
            "abandoned",
            providerThreadId,
          );
        }
      },
      { behavior: "immediate" },
    );
    reconciled += 1;

    if (providerThreadId && args.transport?.cleanupBranch) {
      const environment =
        thread.environmentId === null
          ? null
          : getEnvironment(deps.db, thread.environmentId);
      if (environment?.status === "ready" && environment.path) {
        await cleanupProviderBranch(deps, {
          branchId: branch.id,
          environment,
          providerThreadId,
          thread,
          transport: args.transport,
        });
      }
    }
  }
  return reconciled;
}

function abandonPendingRewindWithoutProvider(
  deps: ThreadRewindDeps,
  operation: ParsedRewindOperation,
  threadId: string,
): void {
  deps.db.transaction(
    (tx) => {
      const branch = getThreadBranch(tx, operation.newBranchId);
      if (branch && branch.lifecycle !== "active") {
        abandonThreadBranchInTransaction(tx, {
          branchId: branch.id,
          error: "Provider branch was not bound before restart",
        });
      }
      const current = getThread(tx, threadId);
      if (!current) return;
      const active = getActiveThreadBranch(tx, threadId);
      if (
        current.status === "starting" &&
        active?.id === operation.previousBranchId
      ) {
        applyLoggedThreadLifecycleEventInTransaction(
          { db: tx, logger: deps.logger },
          { event: { type: "run.succeeded" }, threadId },
        );
      }
      appendOperationInTransaction(tx, current, operation, "abandoned", null);
    },
    { behavior: "immediate" },
  );
}

function assertRewindReservationCurrent(
  db: DbQueryConnection,
  args: {
    environmentId: string;
    newBranchId: string;
    threadId: string;
  },
): void {
  const thread = getThread(db, args.threadId);
  const active = getActiveThreadBranch(db, args.threadId);
  if (
    !thread ||
    thread.status !== "starting" ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.environmentId !== args.environmentId ||
    active?.id !== args.newBranchId
  ) {
    throw rewindFailure(
      "stale-preview",
      "The thread changed while the rewound turn was being submitted",
      true,
    );
  }
}

/**
 * Create the provider branch first, then switch BB's active branch and append
 * the rewind boundary/request in one immediate transaction. A provider branch
 * failure therefore leaves the original branch untouched. Submission failure
 * settles the reservation back to idle and returns the structured draft.
 */
export async function commitThreadRewind(
  deps: ThreadRewindDeps,
  args: CommitThreadRewindArgs,
): Promise<CommitThreadRewindResult> {
  const request = threadRewindRequestSchema.parse(args.request);
  const idempotencyKey = nonEmpty(args.idempotencyKey, "idempotencyKey");
  const sourceBranch = getThreadBranch(deps.db, request.target.branchId);
  const sourceThread = sourceBranch
    ? getThread(deps.db, sourceBranch.threadId)
    : null;
  if (!sourceThread || sourceThread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  if (args.threadId !== undefined && sourceThread.id !== args.threadId) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  const release = acquireRewindLock(sourceThread.id);
  try {
    const transport = args.transport ?? hostTransport(deps);
    await reconcileThreadRewindOperations(deps, {
      threadId: sourceThread.id,
      transport,
    });
    const prior = parseOperation(deps.db, sourceThread.id, idempotencyKey);
    let resumed: ResumedRewind | null = null;
    if (prior) {
      const stored = storedOperationResult(prior);
      if (stored) return stored;
      if (prior.status === "provider-branch-pending") {
        if (
          JSON.stringify(prior.editedInput) !==
          JSON.stringify(request.editedInput)
        ) {
          throw new ApiError(
            409,
            "invalid_request",
            "The idempotency key is already bound to different rewind input",
          );
        }
        const pendingBranch = getThreadBranch(deps.db, prior.newBranchId);
        if (!pendingBranch || pendingBranch.lifecycle !== "staged") {
          throw rewindFailure(
            "rewind-in-progress",
            "A rewind reservation is missing its staged branch",
            true,
          );
        }
        if (pendingBranch.providerThreadId === null) {
          abandonPendingRewindWithoutProvider(deps, prior, sourceThread.id);
        } else {
          const pendingTarget = await validateTarget(deps.db, request.target);
          const pendingThread = getThread(deps.db, sourceThread.id);
          if (!pendingThread) {
            throw new ApiError(404, "thread_not_found", "Thread not found");
          }
          const pendingEnvironment = requireReadyThreadEnvironment(
            await requireThreadCommandEnvironment(deps, {
              thread: pendingThread,
            }),
          );
          const pendingExecution = await buildExecutionOptions(
            deps,
            {},
            { threadId: pendingThread.id },
            "client/turn/requested",
          );
          try {
            const activated = activateStagedRewind(deps, {
              execution: pendingExecution,
              operation: prior,
              providerThreadId: pendingBranch.providerThreadId,
              request,
              target: pendingTarget,
            });
            resumed = {
              environment: pendingEnvironment,
              execution: pendingExecution,
              operation: activated,
              target: pendingTarget,
            };
            notifyRewind(deps, pendingThread, [
              "system/operation",
              "client/turn/requested",
            ]);
          } catch (error) {
            await abandonStagedRewind(deps, {
              environment: pendingEnvironment,
              error: error instanceof Error ? error.message : String(error),
              operation: prior,
              providerThreadId: pendingBranch.providerThreadId,
              thread: pendingThread,
              transport,
            });
            if (error instanceof ApiError) throw error;
            throw rewindFailure(
              "branch-commit-failed",
              "Could not reconcile the staged rewound branch",
              true,
            );
          }
        }
      }
      if (prior.status === "activated") {
        // The daemon may have accepted the request while this process was
        // down, leaving the operation event at `activated`. Reconcile from
        // the durable provider acknowledgement instead of retrying the turn
        // (or leaving every future idempotency retry stuck in progress).
        if (
          operationSubmissionWasAccepted(
            deps.db,
            sourceThread.id,
            prior.requestId,
          )
        ) {
          const active = getActiveThreadBranch(deps.db, sourceThread.id);
          if (active?.id === prior.newBranchId) {
            appendOperation(deps, sourceThread, prior, "submitted");
            notifyRewind(deps, sourceThread, ["system/operation"]);
          }
          return {
            draft: null,
            newBranchId: prior.newBranchId,
            previousBranchId: prior.previousBranchId,
            requestId: prior.requestId,
            result: prior.result,
            submission: "submitted",
          };
        }
        const current = getThread(deps.db, sourceThread.id);
        if (current?.status === "starting") {
          const settled = deps.db.transaction(
            (tx) =>
              applyLoggedThreadLifecycleEventInTransaction(
                { db: tx, logger: deps.logger },
                { event: { type: "run.succeeded" }, threadId: sourceThread.id },
              ),
            { behavior: "immediate" },
          );
          if (settled.applied) {
            appendOperation(deps, sourceThread, prior, "draft-recovery");
            notifyRewind(deps, sourceThread, ["system/operation"]);
            return {
              draft: prior.editedInput,
              newBranchId: prior.newBranchId,
              previousBranchId: prior.previousBranchId,
              requestId: prior.requestId,
              result: prior.result,
              submission: "draft-recovery",
            };
          }
        }
        throw rewindFailure(
          "rewind-in-progress",
          "A previously accepted rewind is still being reconciled",
          true,
        );
      }
    }

    const target =
      resumed?.target ?? (await validateTarget(deps.db, request.target));
    if (!resumed) {
      assertIdleAndWritable(deps.db, target.thread);
      assertPreviewIsCurrent(args.preview, request.target, target);
    }
    const environment =
      resumed?.environment ??
      requireReadyThreadEnvironment(
        await requireThreadCommandEnvironment(deps, { thread: target.thread }),
      );
    const execution =
      resumed?.execution ??
      (await buildExecutionOptions(
        deps,
        {},
        { threadId: target.thread.id },
        "client/turn/requested",
      ));

    let operation: ParsedRewindOperation;
    if (resumed) {
      operation = resumed.operation;
    } else {
      const staged = stageRewind(deps, {
        execution,
        idempotencyKey,
        request,
        target,
      });
      notifyRewind(deps, target.thread, ["system/operation"]);

      let providerBranch: { providerThreadId: string };
      try {
        providerBranch = await transport.createBranch({
          anchor: target.checkpoint?.anchor ?? null,
          branchId: staged.operation.newBranchId,
          editedInput: request.editedInput,
          environment,
          execution,
          sourceProviderThreadId:
            target.checkpoint?.providerThreadId ??
            getActiveThreadBranch(deps.db, target.thread.id)
              ?.providerThreadId ??
            null,
          thread: target.thread,
        });
        nonEmpty(providerBranch.providerThreadId, "providerThreadId");
      } catch (error) {
        countRewindMetric(deps, "provider_branch_failure");
        await abandonStagedRewind(deps, {
          environment,
          error: error instanceof Error ? error.message : String(error),
          operation: staged.operation,
          thread: target.thread,
          transport,
        });
        if (error instanceof ApiError) throw error;
        throw rewindFailure(
          "provider-branch-failed",
          error instanceof Error
            ? error.message
            : "Provider branch creation failed",
          true,
        );
      }

      try {
        operation = activateStagedRewind(deps, {
          execution,
          operation: staged.operation,
          providerThreadId: providerBranch.providerThreadId,
          request,
          target,
        });
      } catch (error) {
        countRewindMetric(deps, "activation_failure");
        await abandonStagedRewind(deps, {
          environment,
          error: error instanceof Error ? error.message : String(error),
          operation: staged.operation,
          providerThreadId: providerBranch.providerThreadId,
          thread: target.thread,
          transport,
        });
        if (error instanceof ApiError) throw error;
        throw rewindFailure(
          "branch-commit-failed",
          "Could not activate the rewound branch",
          true,
        );
      }
      notifyRewind(deps, target.thread, [
        "system/operation",
        "client/turn/requested",
      ]);
    }

    const result = operation.result;
    assertRewindReservationCurrent(deps.db, {
      environmentId: environment.id,
      newBranchId: operation.newBranchId,
      threadId: target.thread.id,
    });
    try {
      await transport.submitTurn({
        editedInput: request.editedInput,
        environment,
        execution,
        requestId: operation.requestId,
        thread: target.thread,
      });
      const started = deps.db.transaction(
        (tx) => {
          assertRewindReservationCurrent(tx, {
            environmentId: environment.id,
            newBranchId: operation.newBranchId,
            threadId: target.thread.id,
          });
          return applyLoggedThreadLifecycleEventInTransaction(
            { db: tx, logger: deps.logger },
            { event: { type: "run.started" }, threadId: target.thread.id },
          );
        },
        { behavior: "immediate" },
      );
      if (!started.applied) {
        throw rewindFailure(
          "stale-preview",
          "The thread changed before edited-turn submission completed",
          true,
        );
      }
      appendOperation(deps, target.thread, operation, "submitted");
      notifyRewind(deps, target.thread, ["system/operation"]);
      return {
        draft: null,
        newBranchId: operation.newBranchId,
        previousBranchId: operation.previousBranchId,
        requestId: operation.requestId,
        result,
        submission: "submitted",
      };
    } catch (error) {
      countRewindMetric(deps, "edited_turn_failure");
      const settled = deps.db.transaction(
        (tx) =>
          applyLoggedThreadLifecycleEventInTransaction(
            { db: tx, logger: deps.logger },
            { event: { type: "run.succeeded" }, threadId: target.thread.id },
          ),
        { behavior: "immediate" },
      );
      if (settled.applied) {
        appendOperation(deps, target.thread, operation, "draft-recovery");
        notifyRewind(deps, target.thread, ["system/operation"]);
        return {
          draft: request.editedInput,
          newBranchId: operation.newBranchId,
          previousBranchId: operation.previousBranchId,
          requestId: operation.requestId,
          result,
          submission: "draft-recovery",
        };
      }
      if (error instanceof ApiError) throw error;
      throw rewindFailure(
        "branch-commit-failed",
        "Edited-turn submission failed during rewind",
        true,
      );
    }
  } finally {
    release();
  }
}
