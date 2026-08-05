import {
  getEnvironment,
  getLastStoredTurnRequestEvent,
  getLatestStoredEventRowByType,
  getStoredTurnRequestEventForTurn,
  getThread,
  listStoredEventRowsInRange,
  requireThreadLifecycleEventApplied,
  type DbQueryConnection,
} from "@bb/db";
import {
  clientTurnRequestIdSchema,
  resolvedThreadExecutionOptionsSchema,
  threadScope,
  type ClientTurnRequestId,
  type Environment,
  type PromptInput,
  type ProviderRateLimitState,
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadEvent,
} from "@bb/domain";
import type {
  ContinueAfterProviderRateLimitResponse,
  ProviderRateLimitRecoveryReason,
  ProviderRateLimitRecoveryStatus,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  prepareReadyThreadTurnCommand,
  prepareReadyThreadTurnDispatch,
  ensureThreadCanStartRequest,
} from "./thread-lifecycle.js";
import {
  appendPreparedClientTurnRequestedEventInTransaction,
  appendThreadEventInTransaction,
  createClientTurnRequestId,
  parseStoredTurnRequestEvent,
} from "./thread-events.js";
import { parseStoredEvent } from "./thread-data.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { requireReadyThreadEnvironment } from "./thread-turn-dispatch.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import {
  ensureThreadIsNotAwaitingUserInteraction,
  ensureThreadIsWritable,
} from "./thread-send.js";

const CONTINUE_INPUT: PromptInput[] = [
  {
    type: "text",
    text: "Please continue.",
    mentions: [],
    visibility: "agent-only",
  },
];

const SAFE_EMPTY_TURN_EVENT_TYPES = new Set<ThreadEvent["type"]>([
  "turn/started",
  "turn/input/accepted",
  "turn/completed",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "provider/error",
  "provider/warning",
  "provider/rateLimits/updated",
  "system/error",
]);

interface InternalRecoveryCandidate {
  execution: ResolvedThreadExecutionOptions;
  failedRequestId: ClientTurnRequestId;
  rateLimits: ProviderRateLimitState;
  resetsAtMs: number;
  turnId: string;
}

interface RecoveryInspection {
  candidate: InternalRecoveryCandidate | null;
  status: ProviderRateLimitRecoveryStatus;
}

interface InspectRecoveryArgs {
  db: DbQueryConnection;
  environment: Environment;
  thread: Thread;
}

function scopeKey(environment: Environment, thread: Thread): string {
  return `${environment.hostId}:${thread.providerId}`;
}

function emptyInspection(
  args: InspectRecoveryArgs,
  reason: ProviderRateLimitRecoveryReason,
  rateLimits: ProviderRateLimitState | null,
): RecoveryInspection {
  return {
    candidate: null,
    status: {
      reason,
      scopeKey: scopeKey(args.environment, args.thread),
      rateLimits,
      candidate: null,
    },
  };
}

function latestRateLimitState(
  db: DbQueryConnection,
  thread: Thread,
): ProviderRateLimitState | null {
  const row = getLatestStoredEventRowByType(db, {
    threadId: thread.id,
    type: "provider/rateLimits/updated",
  });
  if (!row) return null;
  const event = parseStoredEvent(row);
  if (
    event.type !== "provider/rateLimits/updated" ||
    event.rateLimits.providerId !== thread.providerId
  ) {
    return null;
  }
  return event.rateLimits;
}

function recoveryResetAtMs(rateLimits: ProviderRateLimitState): number | null {
  const blockedWindows = rateLimits.windows.filter(
    (window) => window.status === "blocked",
  );
  const relevantWindows =
    blockedWindows.length > 0 ? blockedWindows : rateLimits.windows;
  const resetTimes = relevantWindows.flatMap((window) =>
    window.resetsAtMs === null ? [] : [window.resetsAtMs],
  );
  return resetTimes.length === 0 ? null : Math.max(...resetTimes);
}

function eventBelongsToTurn(event: ThreadEvent, turnId: string): boolean {
  return event.scope.kind === "turn" && event.scope.turnId === turnId;
}

function hasOutputOrSideEffect(
  events: readonly ThreadEvent[],
  turnId: string,
): boolean {
  return events.some(
    (event) =>
      eventBelongsToTurn(event, turnId) &&
      !SAFE_EMPTY_TURN_EVENT_TYPES.has(event.type),
  );
}

function inspectRecovery(args: InspectRecoveryArgs): RecoveryInspection {
  const observedRateLimits = latestRateLimitState(args.db, args.thread);
  if (args.thread.status !== "error") {
    return emptyInspection(args, "thread-not-failed", observedRateLimits);
  }

  const completedRow = getLatestStoredEventRowByType(args.db, {
    threadId: args.thread.id,
    type: "turn/completed",
  });
  if (!completedRow || completedRow.turnId === null) {
    return emptyInspection(args, "no-failed-turn", observedRateLimits);
  }
  const completedEvent = parseStoredEvent(completedRow);
  if (
    completedEvent.type !== "turn/completed" ||
    completedEvent.status !== "failed"
  ) {
    return emptyInspection(args, "no-failed-turn", observedRateLimits);
  }
  const turnId = completedRow.turnId;

  const requestRow = getStoredTurnRequestEventForTurn(args.db, {
    threadId: args.thread.id,
    turnId,
  });
  if (!requestRow) {
    return emptyInspection(args, "input-not-accepted", observedRateLimits);
  }
  const request = parseStoredTurnRequestEvent(requestRow);
  const latestRequestRow = getLastStoredTurnRequestEvent(
    args.db,
    args.thread.id,
  );
  if (!latestRequestRow || latestRequestRow.sequence !== requestRow.sequence) {
    return emptyInspection(args, "superseded", observedRateLimits);
  }

  const rows = listStoredEventRowsInRange(args.db, {
    threadId: args.thread.id,
    seqStart: requestRow.sequence,
    seqEnd: completedRow.sequence,
  });
  const events = rows.map(parseStoredEvent);
  const accepted = events.some(
    (event) =>
      event.type === "turn/input/accepted" &&
      event.clientRequestId === request.requestId &&
      eventBelongsToTurn(event, turnId),
  );
  if (!accepted) {
    return emptyInspection(args, "input-not-accepted", observedRateLimits);
  }

  const turnRateLimits = events
    .filter(
      (
        event,
      ): event is Extract<
        ThreadEvent,
        { type: "provider/rateLimits/updated" }
      > =>
        event.type === "provider/rateLimits/updated" &&
        event.rateLimits.providerId === args.thread.providerId,
    )
    .at(-1)?.rateLimits;
  if (!turnRateLimits || turnRateLimits.status !== "blocked") {
    return emptyInspection(args, "no-rate-limit-state", observedRateLimits);
  }

  const rateLimitErrors = events.filter(
    (event): event is Extract<ThreadEvent, { type: "provider/error" }> =>
      event.type === "provider/error" &&
      event.errorInfo?.category === "rate-limit",
  );
  if (
    rateLimitErrors.some((event) => event.willRetry === true) &&
    !rateLimitErrors.some((event) => event.willRetry !== true)
  ) {
    return emptyInspection(args, "provider-will-retry", turnRateLimits);
  }
  if (turnRateLimits.kind !== "subscription-window") {
    return emptyInspection(args, "not-subscription-window", turnRateLimits);
  }

  const resetsAtMs = recoveryResetAtMs(turnRateLimits);
  if (resetsAtMs === null) {
    return emptyInspection(args, "reset-unavailable", turnRateLimits);
  }
  if (hasOutputOrSideEffect(events, turnId)) {
    return emptyInspection(
      args,
      "output-or-side-effect-observed",
      turnRateLimits,
    );
  }

  const execution = resolvedThreadExecutionOptionsSchema.safeParse(
    request.execution,
  );
  if (!execution.success) {
    return emptyInspection(args, "execution-unavailable", turnRateLimits);
  }
  const failedRequestId = clientTurnRequestIdSchema.parse(request.requestId);
  const candidate: InternalRecoveryCandidate = {
    execution: execution.data,
    failedRequestId,
    rateLimits: turnRateLimits,
    resetsAtMs,
    turnId,
  };
  return {
    candidate,
    status: {
      reason: "eligible",
      scopeKey: scopeKey(args.environment, args.thread),
      rateLimits: turnRateLimits,
      candidate: {
        failedRequestId,
        turnId,
        scopeKey: scopeKey(args.environment, args.thread),
        resetsAtMs,
        rateLimits: turnRateLimits,
      },
    },
  };
}

export function getProviderRateLimitRecoveryStatus(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db">,
  args: { environment: Environment; thread: Thread },
): ProviderRateLimitRecoveryStatus {
  return inspectRecovery({ db: deps.db, ...args }).status;
}

function unavailableRecoveryError(status: ProviderRateLimitRecoveryStatus) {
  return new ApiError(
    409,
    "rate_limit_recovery_unavailable",
    "This thread is no longer safe to continue after its provider rate limit.",
    { details: status },
  );
}

export async function continueThreadAfterProviderRateLimit(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    environment: Environment;
    expectedRequestId: ClientTurnRequestId;
    thread: Thread;
  },
): Promise<ContinueAfterProviderRateLimitResponse> {
  ensureThreadIsWritable(args.thread);
  ensureThreadIsNotAwaitingUserInteraction(deps, args.thread.id);
  const readyEnvironment = requireReadyThreadEnvironment(
    getEnvironment(deps.db, args.environment.id) ?? args.environment,
  );
  const initial = inspectRecovery({
    db: deps.db,
    environment: readyEnvironment,
    thread: args.thread,
  });
  if (
    !initial.candidate ||
    initial.candidate.failedRequestId !== args.expectedRequestId
  ) {
    throw unavailableRecoveryError(initial.status);
  }

  const requestId = createClientTurnRequestId();
  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const command = await prepareReadyThreadTurnCommand(deps, {
    thread: args.thread,
    fork: null,
    input: CONTINUE_INPUT,
    requestId,
    execution: initial.candidate.execution,
    permissionEscalation,
    environment: {
      id: readyEnvironment.id,
      hostId: readyEnvironment.hostId,
      path: readyEnvironment.path,
      status: readyEnvironment.status,
      workspaceProvisionType: readyEnvironment.workspaceProvisionType,
    },
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    syncGeneratedTitle: false,
  });

  deps.db.transaction(
    (tx) => {
      const currentThread = getThread(tx, args.thread.id);
      const currentEnvironment = getEnvironment(tx, readyEnvironment.id);
      if (!currentThread || !currentEnvironment) {
        throw unavailableRecoveryError(initial.status);
      }
      requireReadyThreadEnvironment(currentEnvironment);
      ensureThreadIsWritable(currentThread);
      ensureThreadCanStartRequest(currentThread);
      const current = inspectRecovery({
        db: tx,
        environment: currentEnvironment,
        thread: currentThread,
      });
      if (
        !current.candidate ||
        current.candidate.failedRequestId !== args.expectedRequestId
      ) {
        throw unavailableRecoveryError(current.status);
      }

      appendPreparedClientTurnRequestedEventInTransaction(tx, {
        threadId: currentThread.id,
        environmentId: currentEnvironment.id,
        type: "client/turn/requested",
        continuationOfRequestId: args.expectedRequestId,
        input: CONTINUE_INPUT,
        execution: current.candidate.execution,
        initiator: "system",
        senderThreadId: null,
        requestMethod: "turn/start",
        source: "tell",
        target: { kind: "new-turn" },
        requestId,
      });
      appendThreadEventInTransaction(tx, {
        threadId: currentThread.id,
        environmentId: currentEnvironment.id,
        type: "system/operation",
        scope: threadScope(),
        data: {
          operation: "provider_rate_limit_recovery",
          operationId: `provider-rate-limit-recovery:${args.expectedRequestId}`,
          status: "completed",
          message: "Continued after provider rate limit reset",
          metadata: {
            failedRequestId: args.expectedRequestId,
            continuationRequestId: requestId,
          },
        },
      });
      prepareReadyThreadTurnDispatch({ command, thread: currentThread });
      requireThreadLifecycleEventApplied(
        applyLoggedThreadLifecycleEventInTransaction(
          { db: tx, logger: deps.logger },
          { event: { type: "run.started" }, threadId: currentThread.id },
        ),
      );
    },
    { behavior: "immediate" },
  );

  deps.hub.notifyThread(args.thread.id, ["events-appended", "status-changed"], {
    eventTypes: ["client/turn/requested", "system/operation"],
    projectId: args.thread.projectId,
  });
  startLiveHostCommand(deps, {
    command: command.command,
    hostId: readyEnvironment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        "Provider rate-limit continuation command failed",
      );
    },
  });
  return { ok: true, requestId };
}
