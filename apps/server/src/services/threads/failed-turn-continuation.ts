import {
  getEnvironment,
  getLastStoredTurnRequestEvent,
  getLatestStoredEventRowByType,
  getLatestStoredTurnCompletedRowWithAcceptedInput,
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
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadEvent,
} from "@bb/domain";
import type {
  ExperimentalFailedTurnCandidate,
  ExperimentalFailedTurnInspection,
  ExperimentalFailedTurnInspectionReason,
} from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  ensureThreadCanStartRequest,
  prepareReadyThreadTurnCommand,
  prepareReadyThreadTurnDispatch,
} from "./thread-lifecycle.js";
import {
  appendPreparedClientTurnRequestedEventInTransaction,
  appendThreadEventInTransaction,
  createClientTurnRequestId,
  parseStoredTurnRequestEvent,
} from "./thread-events.js";
import {
  parseStoredEvent,
  parseStoredEventRow,
} from "./thread-data.js";
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

const MAX_CONTINUATION_INSTRUCTION_LENGTH = 4_096;

interface InternalFailedTurnCandidate {
  execution: ResolvedThreadExecutionOptions;
  public: ExperimentalFailedTurnCandidate;
}

interface InternalFailedTurnInspection {
  candidate: InternalFailedTurnCandidate | null;
  public: ExperimentalFailedTurnInspection;
}

interface InspectFailedTurnArgs {
  db: DbQueryConnection;
  environment: Environment;
  thread: Thread;
}

function emptyInspection(
  reason: Exclude<ExperimentalFailedTurnInspectionReason, "eligible">,
): InternalFailedTurnInspection {
  return {
    candidate: null,
    public: { candidate: null, reason },
  };
}

function eventBelongsToTurn(event: ThreadEvent, turnId: string): boolean {
  return event.scope.kind === "turn" && event.scope.turnId === turnId;
}

/**
 * Locate the latest failed root turn that accepted the thread's latest client
 * request. Provider-only drain turns are deliberately ignored: they have no
 * accepted client input and therefore cannot supersede the user's failed turn.
 */
function inspectFailedTurn(
  args: InspectFailedTurnArgs,
): InternalFailedTurnInspection {
  const latestCompletedRow = getLatestStoredEventRowByType(args.db, {
    threadId: args.thread.id,
    type: "turn/completed",
  });
  if (!latestCompletedRow || latestCompletedRow.turnId === null) {
    return emptyInspection("no-failed-turn");
  }

  const completedRow = getLatestStoredTurnCompletedRowWithAcceptedInput(
    args.db,
    { threadId: args.thread.id },
  );
  if (!completedRow) {
    return emptyInspection("input-not-accepted");
  }
  const completedEvent = parseStoredEvent(completedRow);
  if (
    completedEvent.type !== "turn/completed" ||
    completedEvent.status !== "failed" ||
    completedRow.turnId === null
  ) {
    return emptyInspection("no-failed-turn");
  }
  const turnId = completedRow.turnId;

  const requestRow = getStoredTurnRequestEventForTurn(args.db, {
    threadId: args.thread.id,
    turnId,
  });
  if (!requestRow) {
    return emptyInspection("input-not-accepted");
  }
  const request = parseStoredTurnRequestEvent(requestRow);
  const latestRequestRow = getLastStoredTurnRequestEvent(
    args.db,
    args.thread.id,
  );
  if (!latestRequestRow || latestRequestRow.sequence !== requestRow.sequence) {
    return emptyInspection("superseded");
  }

  const latestInterruptionRow = getLatestStoredEventRowByType(args.db, {
    threadId: args.thread.id,
    type: "system/thread/interrupted",
  });
  if (
    latestInterruptionRow &&
    latestInterruptionRow.sequence > requestRow.sequence
  ) {
    const latestInterruption = parseStoredEvent(latestInterruptionRow);
    if (
      latestInterruption.type === "system/thread/interrupted" &&
      latestInterruption.reason === "manual-stop"
    ) {
      return emptyInspection("superseded");
    }
  }

  const turnStartedSequence = getRootStoredTurnStartedSequence(args.db, {
    threadId: args.thread.id,
    turnId,
  });
  if (turnStartedSequence === null) {
    return emptyInspection("no-failed-turn");
  }

  const rows = listStoredEventRowsInRange(args.db, {
    threadId: args.thread.id,
    seqStart: requestRow.sequence,
    seqEnd: Number.MAX_SAFE_INTEGER,
  });
  const failedTurnEvents = rows
    .filter((row) => row.sequence <= completedRow.sequence)
    .map(parseStoredEvent);
  const accepted = failedTurnEvents.some(
    (event) =>
      event.type === "turn/input/accepted" &&
      event.clientRequestId === request.requestId &&
      eventBelongsToTurn(event, turnId),
  );
  if (!accepted) {
    return emptyInspection("input-not-accepted");
  }

  const execution = resolvedThreadExecutionOptionsSchema.safeParse(
    request.execution,
  );
  if (!execution.success) {
    return emptyInspection("execution-unavailable");
  }

  const publicCandidate: ExperimentalFailedTurnCandidate = {
    completedSeq: completedRow.sequence,
    events: rows.map(parseStoredEventRow),
    failedRequestId: clientTurnRequestIdSchema.parse(request.requestId),
    hostId: args.environment.hostId,
    providerId: args.thread.providerId,
    turnId,
  };
  return {
    candidate: { execution: execution.data, public: publicCandidate },
    public: { candidate: publicCandidate, reason: "eligible" },
  };
}

export function inspectThreadFailedTurn(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db">,
  args: { environment: Environment; thread: Thread },
): ExperimentalFailedTurnInspection {
  return inspectFailedTurn({ db: deps.db, ...args }).public;
}

function unavailableContinuationError(
  inspection: ExperimentalFailedTurnInspection,
): ApiError {
  return new ApiError(
    409,
    "failed_turn_continuation_unavailable",
    "This failed turn is no longer available to continue.",
    { details: { reason: inspection.reason } },
  );
}

function continuationInput(instruction: string): PromptInput[] {
  if (
    typeof instruction !== "string" ||
    instruction.trim().length === 0 ||
    instruction.length > MAX_CONTINUATION_INSTRUCTION_LENGTH
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Continuation instruction must contain 1-${MAX_CONTINUATION_INSTRUCTION_LENGTH} characters.`,
    );
  }
  return [
    {
      type: "text",
      text: instruction,
      mentions: [],
      visibility: "agent-only",
    },
  ];
}

export async function continueThreadFailedTurn(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    environment: Environment;
    failedRequestId: ClientTurnRequestId;
    instruction: string;
    pluginId: string;
    thread: Thread;
  },
): Promise<{ requestId: ClientTurnRequestId }> {
  const input = continuationInput(args.instruction);
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
  const initial = inspectFailedTurn({
    db: deps.db,
    environment: readyEnvironment,
    thread: args.thread,
  });
  if (
    !initial.candidate ||
    initial.candidate.public.failedRequestId !== args.failedRequestId
  ) {
    throw unavailableContinuationError(initial.public);
  }

  const requestId = createClientTurnRequestId();
  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator: "system",
  });
  const command = await prepareReadyThreadTurnCommand(deps, {
    thread: args.thread,
    fork: null,
    input,
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
        throw unavailableContinuationError(initial.public);
      }
      requireReadyThreadEnvironment(currentEnvironment);
      ensureThreadIsWritable(currentThread);
      ensureThreadCanStartRequest(currentThread);
      const current = inspectFailedTurn({
        db: tx,
        environment: currentEnvironment,
        thread: currentThread,
      });
      if (
        !current.candidate ||
        current.candidate.public.failedRequestId !== args.failedRequestId
      ) {
        throw unavailableContinuationError(current.public);
      }

      appendPreparedClientTurnRequestedEventInTransaction(tx, {
        threadId: currentThread.id,
        environmentId: currentEnvironment.id,
        type: "client/turn/requested",
        continuationOfRequestId: args.failedRequestId,
        input,
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
          operation: "failed_turn_continuation",
          operationId: `failed-turn-continuation:${args.pluginId}:${args.failedRequestId}`,
          status: "completed",
          message: "Continued a failed turn",
          metadata: {
            pluginId: args.pluginId,
            failedRequestId: args.failedRequestId,
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
        "Failed-turn continuation command failed",
      );
    },
  });
  return { requestId };
}
