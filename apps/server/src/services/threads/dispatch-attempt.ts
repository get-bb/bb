import {
  deleteClaimedQueuedThreadMessageBatchInTransaction,
  getThread,
  getThreadPendingStartContext,
  setThreadPendingStartContext,
  type ClaimedQueuedThreadMessageRow,
} from "@bb/db";
import {
  promptInputSchema,
  type PluginInputs,
  type PromptInput,
  type QueuedMessagePayload,
  type QueuedMessageWaitingOn,
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import type {
  SendMessageRequest,
  StartedOnBehalfOf,
  ThreadCreateOrigin,
} from "@bb/server-contract";
import { startedOnBehalfOfSchema } from "@bb/server-contract";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { requirePublicProject } from "../lib/entity-lookup.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import {
  dispatchExecutionSources,
  dispatchWaitReasonForPass,
  hasDispatchGates,
  noteDispatchReparked,
  runDispatchGatePass,
  type DispatchAmendmentResult,
  type DispatchAttemptKind,
} from "./dispatch-gates.js";
import { parkDispatch, settleQueueRowDispatched } from "./queue-parking.js";
import { applyLoggedThreadLifecycleEvent } from "./lifecycle-outcome.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { isManualCompactionActive } from "./thread-events.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
  scheduleThreadProvisioningAdvance,
} from "./thread-provisioning.js";
import {
  threadForkDescriptorSchema,
  threadProvisionEnvironmentIntentSchema,
} from "./thread-provisioning-context.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";
import { isPreStartThreadStatus } from "./thread-status.js";
import {
  ensureThreadIsWritable,
  resolveMessageSenderThreadId,
  sendThreadMessage,
  type SendThreadMessageTransactionPreflight,
} from "./thread-send.js";
import type { TurnRequestRetryMarker } from "./thread-events.js";

/**
 * The half of a never-started thread's first turn that the message itself does
 * not carry: where the thread will run and how it will be established.
 *
 * Persisted on the thread (`threads.pending_start_context`) rather than
 * recomputed, because the live provisioning context is in-memory only and
 * requires the thread to be `starting` — a `pending` thread's first message can
 * wait for a week and across a restart, so a parked context would not survive
 * the wait.
 */
export const pendingThreadStartContextSchema = z.object({
  environmentIntent: threadProvisionEnvironmentIntentSchema,
  fork: threadForkDescriptorSchema.nullable(),
  /** Provider-facing input when it differs from the persisted start seed. */
  providerInput: z.array(promptInputSchema).optional(),
  startedOnBehalfOf: startedOnBehalfOfSchema.nullable(),
  titleProvided: z.boolean(),
});
export type PendingThreadStartContext = z.infer<
  typeof pendingThreadStartContextSchema
>;

export function readPendingThreadStartContext(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db">,
  threadId: string,
): PendingThreadStartContext | null {
  const stored = getThreadPendingStartContext(deps.db, threadId);
  if (stored === null) return null;
  return pendingThreadStartContextSchema.parse(JSON.parse(stored));
}

/**
 * How this attempt reached the checkpoint.
 *
 * `inline` is somebody sending right now; `drain` is a re-attempt of rows a
 * drain already claimed. The two run the SAME checkpoint — that is the whole
 * point — and differ only in what parking does (create a row vs. hand the
 * claimed one back) and in whether a failure has a caller to report to.
 */
export type DispatchAttemptSource =
  | { kind: "inline" }
  | {
      kind: "drain";
      claimed: ClaimedQueuedThreadMessageRow[];
      /**
       * Send-now. Bypasses every plugin wait AND the row's own `sendAt`; core
       * waits are NOT overridable, because they guard invariants rather than
       * express a policy — a message cannot join a turn that is not running,
       * and cannot interrupt an interaction the user has not answered.
       */
      sendNow: boolean;
    };

/**
 * Everything creation knows that a drain re-attempt cannot reconstruct.
 *
 * `applyEnvironmentAmendment` exists because an `environment` amendment has to
 * re-run the environment intent resolution, which lives in thread creation and
 * needs the original request. So the amendment is honoured on the attempt that
 * creates the thread, where creation is still on the stack, and refused on a
 * later drain re-attempt — the same rule the previous contract had, now stated
 * in terms of what the attempt actually has in hand.
 */
export interface DispatchAttemptCreation {
  startContext: PendingThreadStartContext;
  applyEnvironmentAmendment(
    amendment: NonNullable<DispatchAmendmentResult["environment"]>,
  ): Promise<PendingThreadStartContext>;
}

export interface DispatchAttemptArgs {
  thread: Thread;
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] };
  source: DispatchAttemptSource;
  /** Present only on the attempt that is creating the thread. */
  creation?: DispatchAttemptCreation;
  /** What the parked row would carry; `retry` for a re-submitted failed turn. */
  queuePayload: QueuedMessagePayload;
  /** Retry provenance, when this attempt re-submits a failed turn. */
  retryOf?: TurnRequestRetryMarker;
  origin: ThreadCreateOrigin | null;
  originPluginId: string | null;
  startedOnBehalfOf: StartedOnBehalfOf | null;
  /** Execution defaults resolved by creation, which the thread row lacks. */
  executionDefaults?: Parameters<typeof buildExecutionOptions>[2];
  trigger: "auto-dispatch" | "user";
}

export type DispatchAttemptOutcome =
  | { kind: "dispatched" }
  | { kind: "parked"; entry: ThreadQueuedMessage };

/**
 * Whether this attempt starts a turn or joins one that is already running.
 *
 * Read off the thread's live status and the message's own delivery mode, which
 * is exactly what makes "steers are gated uniformly" implementable: the same
 * message is a `join-turn` attempt against a running thread and a `start-turn`
 * attempt against an idle one, and it is the drain firing at the right moment
 * — not a separate code path — that decides which.
 */
export function resolveDispatchAttemptKind(
  thread: Thread,
  mode: SendMessageRequest["mode"],
): DispatchAttemptKind {
  if (thread.status !== "active") return "start-turn";
  return mode === "steer" || mode === "steer-if-active" || mode === "auto"
    ? "join-turn"
    : "start-turn";
}

/**
 * THE dispatch checkpoint.
 *
 * Every message on its way to a provider passes through here exactly once per
 * attempt, whether it was just sent, was parked and became eligible again, or
 * is a retry of a turn that failed. The shape is the plan's three steps:
 *
 * 1. **Core waits.** A future `sendAt`, a thread already running a turn this
 *    message did not ask to join, a workspace still provisioning, an
 *    unanswered interaction. Each parks the message with its typed reason and
 *    returns; none of them consults a plugin, because none of them is a
 *    policy — they are the invariants a dispatch cannot violate.
 * 2. **The single plugin pass.** One stage, one chain, `proceed` / `wait` /
 *    `reject`.
 * 3. **Dispatch.** A cleared first attempt moves a `pending` thread to
 *    `starting` and rides the cold-start command; every other cleared attempt
 *    sends or steers exactly as it does today.
 *
 * When nothing blocks it, no queued row is ever created and the path is the
 * one that existed before the queue did.
 */
export async function attemptDispatch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DispatchAttemptArgs,
): Promise<DispatchAttemptOutcome> {
  const { payload, thread } = args;
  ensureThreadIsWritable(thread);
  if (args.trigger === "user" && args.source.kind === "inline") {
    // Reject what can never deliver while the sender is still listening; a
    // drain has nobody to tell, and its rows were validated when they parked.
    await validatePromptAttachmentReferences({
      dataDir: deps.config.dataDir,
      input: payload.input,
      projectId: thread.projectId,
    });
  }
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    ...(payload.senderThreadId !== undefined
      ? { senderThreadId: payload.senderThreadId }
      : {}),
    targetThread: thread,
  });

  const firstDispatch = thread.status === "pending";
  const claimed = args.source.kind === "drain" ? args.source.claimed : null;
  const sendNow = args.source.kind === "drain" && args.source.sendNow;
  const attempt = resolveDispatchAttemptKind(thread, payload.mode);

  const execution = await buildExecutionOptions(
    deps,
    payload,
    args.executionDefaults ?? { threadId: thread.id },
  );

  const park = (
    waitingOn: QueuedMessageWaitingOn,
    sendAt: number | null,
    input: PromptInput[] = payload.input,
    parkExecution: ResolvedThreadExecutionOptions = execution,
    pluginInputs: PluginInputs = payload.pluginInputs ?? {},
  ): DispatchAttemptOutcome => {
    const entry = parkDispatch(deps, {
      thread,
      message: {
        input,
        execution: parkExecution,
        pluginInputs,
        senderThreadId,
        payload: args.queuePayload,
        // Only core parks a system notice, and it does so directly rather
        // than through a send request, so an attempt never carries one.
        systemNotice: null,
      },
      waitingOn,
      sendAt,
      claimed,
    });
    if (entry === null) {
      // The row vanished under a re-park (the user deleted it). Nothing is
      // waiting and nothing dispatched; report it as dispatched-away so the
      // drain stops rather than looping on a row that no longer exists.
      return { kind: "dispatched" };
    }
    return { kind: "parked", entry };
  };

  // --- 1. core waits, in the order a message meets them -------------------

  const sendAt = payload.sendAt ?? null;
  if (!sendNow && sendAt !== null && sendAt > Date.now()) {
    return park({ kind: "time" }, sendAt);
  }

  if (thread.status === "active" && attempt === "start-turn") {
    if (payload.mode === "start") {
      // `start` asks for a FRESH turn specifically, so a running one is a
      // conflict rather than something to wait behind. Unchanged 409.
      throwThreadNotWritable(thread, "already_active", "Thread is already active");
    }
    return park({ kind: "thread-busy" }, null);
  }
  if (payload.mode !== "start" && isManualCompactionActive(deps, thread)) {
    return park({ kind: "thread-busy" }, null);
  }
  if (!firstDispatch && isPreStartThreadStatus(thread.status)) {
    // A follow-up or steer sent while the workspace is being (re)provisioned.
    // The workspace-ready drain re-attempts it; the thread's first message
    // never lands here, because it rides the cold-start command instead.
    return park({ kind: "provisioning" }, null);
  }
  if (
    payload.mode !== "start" &&
    deps.pendingInteractions.hasPendingThreadInteraction(thread.id)
  ) {
    return park({ kind: "interaction" }, null);
  }

  // --- 2. the single plugin pass ------------------------------------------

  let amendments: DispatchAmendmentResult | null = null;
  if (!sendNow && hasDispatchGates("dispatch")) {
    const outcome = await runDispatchGatePass(deps, {
      thread,
      threadResponse: toThreadResponseFromThread(deps, { thread }),
      project: requirePublicProject(deps.db, thread.projectId),
      environmentId: thread.environmentId,
      input: payload.input,
      requestedExecution: {
        providerId: thread.providerId,
        model: execution.model,
        reasoningLevel: execution.reasoningLevel,
        serviceTier: execution.serviceTier,
        permissionMode: execution.permissionMode,
      },
      executionSources: dispatchExecutionSources(
        payload.executionInputSources ?? {},
      ),
      attempt,
      firstDispatch,
      environmentAmendable: args.creation !== undefined,
      origin: args.origin,
      originPluginId: args.originPluginId,
      startedOnBehalfOf: args.startedOnBehalfOf,
      parentThreadId: thread.parentThreadId,
      pluginInputs: payload.pluginInputs ?? {},
      queuedMessage:
        claimed?.[0] === undefined ? null : toThreadQueuedMessage(claimed[0]),
    });
    if (outcome.kind === "wait") {
      return parkForGateWait(deps, {
        args,
        claimed,
        execution,
        outcome,
        park,
        senderThreadId,
      });
    }
    amendments = outcome.amendments;
  }

  // --- 3. dispatch --------------------------------------------------------

  const amendedPayload = applyAmendmentsToPayload(payload, execution, amendments);
  if (firstDispatch) {
    await startPendingThread(deps, {
      amendments,
      claimed,
      creation: args.creation ?? null,
      payload: amendedPayload,
      thread,
    });
    return { kind: "dispatched" };
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: amendedPayload,
    thread,
    trigger: args.trigger,
    ...(args.retryOf !== undefined ? { retryOf: args.retryOf } : {}),
    ...(claimed === null
      ? {}
      : { beforeAppendInTransaction: consumeClaimedRows(claimed) }),
    ...(amendments !== null && amendments.amendedBy.input !== undefined
      ? {
          amendment: {
            pluginId: amendments.amendedBy.input,
            ...(amendments.originalInput !== null
              ? { originalInput: amendments.originalInput }
              : {}),
          },
        }
      : {}),
  });
  if (claimed !== null) {
    settleQueueRowDispatched(deps, {
      row: claimed[0]!,
      waitingOn: parkedWaitOf(claimed[0]!),
    });
  }
  return { kind: "dispatched" };
}

/** The wait a claimed row was holding, for its settle event. */
function parkedWaitOf(
  row: ClaimedQueuedThreadMessageRow,
): QueuedMessageWaitingOn {
  if (row.waitingOn === null) return { kind: "thread-busy" };
  try {
    return JSON.parse(row.waitingOn) as QueuedMessageWaitingOn;
  } catch {
    return { kind: "thread-busy" };
  }
}

/**
 * Consumes the rows a drain claimed, inside the same transaction that appends
 * the turn request. This is the exactly-once guarantee: the claim CAS picked
 * one winner, and the delete makes the dispatch and the consumption atomic, so
 * a double drain dispatches once and the loser finds nothing to claim.
 */
function consumeClaimedRows(
  claimed: readonly ClaimedQueuedThreadMessageRow[],
): SendThreadMessageTransactionPreflight {
  return ({ tx }) => {
    const consumed = deleteClaimedQueuedThreadMessageBatchInTransaction(tx, {
      queuedMessages: claimed,
    });
    if (!consumed) {
      throw new ApiError(
        409,
        "queued_message_claim_lost",
        "Queued message claim expired before it could be sent",
      );
    }
  };
}

interface ParkForGateWaitArgs {
  args: DispatchAttemptArgs;
  claimed: ClaimedQueuedThreadMessageRow[] | null;
  execution: ResolvedThreadExecutionOptions;
  outcome: Extract<
    Awaited<ReturnType<typeof runDispatchGatePass>>,
    { kind: "wait" }
  >;
  park: (
    waitingOn: QueuedMessageWaitingOn,
    sendAt: number | null,
    input?: PromptInput[],
    parkExecution?: ResolvedThreadExecutionOptions,
    pluginInputs?: PluginInputs,
  ) => DispatchAttemptOutcome;
  senderThreadId: string | null;
}

/**
 * Parks a message a gate pass voted to wait on.
 *
 * The execution tuple frozen here is the one the WHOLE pass agreed on, which
 * is why wait verdicts are collected across a full pass rather than
 * short-circuiting: a limiter that parked the turn must not also freeze a
 * stale model that a later gate had already corrected.
 */
function parkForGateWait(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ParkForGateWaitArgs,
): DispatchAttemptOutcome {
  const { outcome } = args;
  if (args.claimed !== null) {
    noteDispatchReparked(args.args.thread.id);
  }
  const amended = args.outcome.amendments;
  const execution: ResolvedThreadExecutionOptions = {
    ...args.execution,
    ...(amended.model !== null ? { model: amended.model } : {}),
    ...(amended.reasoningLevel !== null
      ? { reasoningLevel: amended.reasoningLevel }
      : {}),
    ...(amended.serviceTier !== null ? { serviceTier: amended.serviceTier } : {}),
    ...(amended.permissionMode !== null
      ? { permissionMode: amended.permissionMode }
      : {}),
  };
  return args.park(
    {
      kind: "plugin",
      pluginId: outcome.waiter.pluginId,
      reason: dispatchWaitReasonForPass(outcome),
    },
    outcome.waiter.retryAt,
    amended.input ?? args.args.payload.input,
    execution,
    args.args.payload.pluginInputs ?? {},
  );
}

interface StartPendingThreadArgs {
  amendments: DispatchAmendmentResult | null;
  claimed: ClaimedQueuedThreadMessageRow[] | null;
  creation: DispatchAttemptCreation | null;
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] };
  thread: Thread;
}

/**
 * A cleared FIRST attempt: the thread leaves `pending` and the existing
 * provisioning machinery takes over with the message riding the cold-start
 * command, exactly as creation has always done it.
 *
 * Nothing about provisioning changes here. The only new thing is where the
 * start context comes from — the creation call that is still on the stack, or
 * the thread column a park wrote — which is what makes "the schedule survives
 * a restart" true rather than aspirational.
 */
async function startPendingThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: StartPendingThreadArgs,
): Promise<void> {
  let startContext =
    args.creation?.startContext ??
    readPendingThreadStartContext(deps, args.thread.id);
  if (startContext === null) {
    throw new ApiError(
      500,
      "internal_error",
      `Thread ${args.thread.id} is pending but has no start context to dispatch`,
    );
  }
  if (args.amendments?.environment != null) {
    if (args.creation === null) {
      throw new ApiError(
        502,
        "dispatch_gate_failed",
        "A gate amended the environment on a re-attempt; a thread's workspace can only be chosen on the attempt that creates it",
      );
    }
    startContext = await args.creation.applyEnvironmentAmendment(
      args.amendments.environment,
    );
  }
  const execution = await buildExecutionOptions(deps, args.payload, {
    threadId: args.thread.id,
  });
  const claimedRow = args.claimed?.[0] ?? null;
  if (args.claimed !== null && args.claimed.length > 0) {
    // Consume the parked row before anything else: the claim CAS already
    // picked this drain as the winner, and provisioning is driven off this
    // stack, so there is no later transaction to fold the delete into.
    deps.db.transaction(
      (tx) => consumeClaimedRows(args.claimed!)({ tx }),
      { behavior: "immediate" },
    );
  }

  const prepared = applyLoggedThreadLifecycleEvent(deps, {
    threadId: args.thread.id,
    event: { type: "run.preparing" },
  });
  if (!prepared.applied) {
    // Archived, deleted or already started under the attempt. Re-dispatching
    // into a thread that moved on would be worse than dropping the turn.
    deps.logger.warn(
      { threadId: args.thread.id, status: args.thread.status },
      "A cleared first dispatch could not move its thread out of pending",
    );
    return;
  }
  const startingThread = getThread(deps.db, args.thread.id);
  if (!startingThread) {
    return;
  }
  setThreadPendingStartContext(deps.db, {
    threadId: args.thread.id,
    pendingStartContext: null,
  });
  const context = requestThreadProvision(deps, {
    thread: startingThread,
    environmentIntent: startContext.environmentIntent,
    execution,
    fork: startContext.fork,
    input: args.payload.input,
    ...(startContext.providerInput !== undefined
      ? { providerInput: startContext.providerInput }
      : {}),
    startedOnBehalfOf: startContext.startedOnBehalfOf,
    titleProvided: startContext.titleProvided,
  });
  if (claimedRow !== null) {
    settleQueueRowDispatched(deps, {
      row: claimedRow,
      waitingOn: parkedWaitOf(claimedRow),
    });
  }
  if (startContext.environmentIntent.type === "direct-personal") {
    // A personal workspace needs no worktree, so provisioning it is fast and
    // the caller is told about a failure synchronously instead of finding the
    // thread in `error` afterwards. Every other intent is driven off this
    // stack, because it can take as long as a clone.
    await advanceThreadProvisioning(deps, {
      context,
      threadId: startingThread.id,
    });
    return;
  }
  scheduleThreadProvisioningAdvance(deps, context, startingThread.id);
}

/**
 * Folds a pass's amendments back into the request the executor will run.
 *
 * The resolved tuple is written back as EXPLICIT request fields rather than
 * left to be re-derived, so the executor's own `buildExecutionOptions` is
 * idempotent — the same trick the queue drain has always used to replay a
 * frozen tuple.
 */
function applyAmendmentsToPayload(
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] },
  execution: ResolvedThreadExecutionOptions,
  amendments: DispatchAmendmentResult | null,
): SendMessageRequest & { inputGroups?: PromptInput[][] } {
  const next: SendMessageRequest & { inputGroups?: PromptInput[][] } = {
    ...payload,
    model: amendments?.model ?? execution.model,
    reasoningLevel: amendments?.reasoningLevel ?? execution.reasoningLevel,
    serviceTier: amendments?.serviceTier ?? execution.serviceTier,
    permissionMode: amendments?.permissionMode ?? execution.permissionMode,
  };
  if (amendments?.input != null) {
    next.input = amendments.input;
    // The grouped view is a presentation of the same blocks; a wholesale
    // replacement has no groups to preserve.
    delete next.inputGroups;
  }
  return next;
}
