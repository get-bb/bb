import {
  getEnvironment,
  getLastStoredTurnRequestEvent,
  getLatestStoredEventRowByType,
  getRootStoredTurnStartedSequence,
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
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";

const CONTINUE_INPUT: PromptInput[] = [
  {
    type: "text",
    text: "Please continue.",
    mentions: [],
    visibility: "agent-only",
  },
];

interface InternalRecoveryCandidate {
  automatic: boolean;
  execution: ResolvedThreadExecutionOptions;
  failedRequestId: ClientTurnRequestId;
  rateLimits: ProviderRateLimitState;
  resetsAtMs: number | null;
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
      hostId: args.environment.hostId,
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

  const turnStartedSequence = getRootStoredTurnStartedSequence(args.db, {
    threadId: args.thread.id,
    turnId,
  });
  if (turnStartedSequence === null) {
    return emptyInspection(args, "no-failed-turn", observedRateLimits);
  }

  const rows = listStoredEventRowsInRange(args.db, {
    threadId: args.thread.id,
    seqStart: turnStartedSequence,
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
  const blockedRateLimits =
    turnRateLimits?.status === "blocked"
      ? turnRateLimits
      : observedRateLimits?.status === "blocked"
        ? observedRateLimits
        : null;
  if (blockedRateLimits === null) {
    return emptyInspection(args, "no-rate-limit-state", observedRateLimits);
  }

  const rateLimitErrors = events.filter(
    (event): event is Extract<ThreadEvent, { type: "provider/error" }> =>
      event.type === "provider/error" &&
      event.errorInfo?.category === "rate-limit",
  );
  const hasTerminalRateLimitError = rateLimitErrors.some(
    (event) => event.willRetry !== true,
  );
  if (!hasTerminalRateLimitError) {
    return emptyInspection(
      args,
      rateLimitErrors.length > 0
        ? "provider-will-retry"
        : "no-terminal-rate-limit-error",
      blockedRateLimits,
    );
  }
  const execution = resolvedThreadExecutionOptionsSchema.safeParse(
    request.execution,
  );
  if (!execution.success) {
    return emptyInspection(args, "execution-unavailable", blockedRateLimits);
  }
  const failedRequestId = clientTurnRequestIdSchema.parse(request.requestId);
  const currentBlockedRateLimits =
    observedRateLimits?.status === "blocked"
      ? observedRateLimits
      : blockedRateLimits;
  const resetsAtMs = recoveryResetAtMs(currentBlockedRateLimits);
  const automatic =
    currentBlockedRateLimits.kind === "subscription-window" &&
    resetsAtMs !== null;
  const candidate: InternalRecoveryCandidate = {
    automatic,
    execution: execution.data,
    failedRequestId,
    rateLimits: currentBlockedRateLimits,
    resetsAtMs,
    turnId,
  };
  return {
    candidate,
    status: {
      reason: automatic ? "eligible" : "manual-only",
      scopeKey: scopeKey(args.environment, args.thread),
      hostId: args.environment.hostId,
      rateLimits: observedRateLimits ?? blockedRateLimits,
      candidate: {
        automatic,
        failedRequestId,
        turnId,
        resetsAtMs,
        rateLimits: currentBlockedRateLimits,
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
    "This thread is no longer eligible to continue after its provider rate limit.",
    { details: status },
  );
}

export async function continueThreadAfterProviderRateLimit(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    environment: Environment;
    failedRequestId: ClientTurnRequestId;
    mode: "automatic" | "manual";
    thread: Thread;
  },
): Promise<ContinueAfterProviderRateLimitResponse> {
  ensureThreadIsWritable(args.thread);
  ensureThreadIsNotAwaitingUserInteraction(deps, args.thread.id);
  const currentEnvironment =
    getEnvironment(deps.db, args.environment.id) ?? args.environment;
  if (currentEnvironment.status === "retiring") {
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: currentEnvironment.id,
      event: { type: "retire.cancelled" },
    });
  }
  const readyEnvironment = requireReadyThreadEnvironment(
    getEnvironment(deps.db, args.environment.id) ?? currentEnvironment,
  );
  const initial = inspectRecovery({
    db: deps.db,
    environment: readyEnvironment,
    thread: args.thread,
  });
  if (
    !initial.candidate ||
    initial.candidate.failedRequestId !== args.failedRequestId ||
    (args.mode === "automatic" && !initial.candidate.automatic)
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
        current.candidate.failedRequestId !== args.failedRequestId ||
        (args.mode === "automatic" && !current.candidate.automatic)
      ) {
        throw unavailableRecoveryError(current.status);
      }

      appendPreparedClientTurnRequestedEventInTransaction(tx, {
        threadId: currentThread.id,
        environmentId: currentEnvironment.id,
        type: "client/turn/requested",
        continuationOfRequestId: args.failedRequestId,
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
          operationId: `provider-rate-limit-recovery:${args.failedRequestId}`,
          status: "completed",
          message:
            args.mode === "automatic"
              ? "Continued automatically after provider rate limit reset"
              : "Provider rate limit retry requested manually",
          metadata: {
            mode: args.mode,
            failedRequestId: args.failedRequestId,
            continuationRequestId: requestId,
            resetsAtMs: current.candidate.resetsAtMs,
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
