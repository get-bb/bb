import {
  deleteClaimedQueuedThreadMessageBatchInTransaction,
  getThread,
  getThreadPendingStartContext,
  setThreadPendingStartContext,
  type ClaimedQueuedThreadMessageRow,
} from "@bb/db";
import {
  promptInputSchema,
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

export interface DispatchAttemptArgs {
  thread: Thread;
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] };
  source: DispatchAttemptSource;
  /**
   * The start context creation just wrote, on the attempt that is creating the
   * thread. Absent on a drain re-attempt, which reads it back off the thread.
   */
  startContext?: PendingThreadStartContext;
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
  const resolvedPayload = resolveExecutionIntoPayload(payload, execution);

  const park = (
    waitingOn: QueuedMessageWaitingOn,
    sendAt: number | null,
  ): DispatchAttemptOutcome => {
    const entry = parkDispatch(deps, {
      thread,
      message: {
        input: payload.input,
        execution,
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

  /**
   * Filled by `commitAdmission` while the pass still holds the evaluation
   * lock. A holder rather than a bare `let` because the write happens in a
   * callback, which narrowing cannot see.
   */
  const admitted: { value: PendingThreadAdmission | null } = { value: null };

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
      origin: args.origin,
      originPluginId: args.originPluginId,
      startedOnBehalfOf: args.startedOnBehalfOf,
      parentThreadId: thread.parentThreadId,
      queuedMessage:
        claimed?.[0] === undefined ? null : toThreadQueuedMessage(claimed[0]),
      // A first dispatch is the admission a limiter is deciding about, so its
      // `pending → starting` flip is committed here, inside the lock, and the
      // next gate in line sees it. A follow-up has no transition this side of
      // the send transaction, so it has nothing to commit.
      ...(firstDispatch
        ? {
            commitAdmission: async () => {
              admitted.value = await admitPendingThread(deps, {
                claimed,
                payload: resolvedPayload,
                startContext: args.startContext ?? null,
                thread,
              });
            },
          }
        : {}),
    });
    if (outcome.kind === "wait") {
      if (claimed !== null) {
        noteDispatchReparked(thread.id);
      }
      return park(
        {
          kind: "plugin",
          pluginId: outcome.waiter.pluginId,
          reason: dispatchWaitReasonForPass(outcome),
        },
        outcome.waiter.retryAt,
      );
    }
  }

  // --- 3. dispatch --------------------------------------------------------

  if (firstDispatch) {
    // Already admitted under the lock when a gate pass ran; admitted here when
    // no gate is installed or send-now skipped the pass entirely.
    const admission =
      admitted.value ??
      (await admitPendingThread(deps, {
        claimed,
        payload: resolvedPayload,
        startContext: args.startContext ?? null,
        thread,
      }));
    if (admission !== null) {
      await launchAdmittedThread(deps, admission);
    }
    return { kind: "dispatched" };
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: resolvedPayload,
    thread,
    trigger: args.trigger,
    ...(args.retryOf !== undefined ? { retryOf: args.retryOf } : {}),
    ...(claimed === null
      ? {}
      : { beforeAppendInTransaction: consumeClaimedRows(claimed) }),
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

interface AdmitPendingThreadArgs {
  claimed: ClaimedQueuedThreadMessageRow[] | null;
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] };
  /** Creation's own record; null on a re-attempt, which reads it back. */
  startContext: PendingThreadStartContext | null;
  thread: Thread;
}

/**
 * What a committed admission hands to the launch half: everything already
 * resolved, so launching cannot fail its way back into `pending`.
 */
interface PendingThreadAdmission {
  claimedRow: ClaimedQueuedThreadMessageRow | null;
  execution: Awaited<ReturnType<typeof buildExecutionOptions>>;
  input: PromptInput[];
  startContext: PendingThreadStartContext;
  startingThread: Thread;
}

/**
 * The committing half of a cleared FIRST attempt: the thread leaves `pending`
 * for `starting`, and the parked row that carried the message is consumed.
 *
 * This runs INSIDE the gate evaluation lock whenever a gate pass ran, which is
 * the whole flip-before-unlock invariant — the next attempt in the queue reads
 * a database that already contains this admission, so a limiter can answer
 * from `listRunning()` instead of tracking its own in-flight `proceed`s.
 *
 * Everything that can legitimately refuse the admission therefore happens
 * before the flip, in this order and deliberately: a missing start context,
 * the execution tuple, then the row consumption whose claim CAS can be lost. A
 * failure at any of those leaves the thread in `pending`, exactly as it did
 * when this ran unlocked. Returns null when the thread moved on underneath the
 * attempt.
 */
async function admitPendingThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitPendingThreadArgs,
): Promise<PendingThreadAdmission | null> {
  const startContext =
    args.startContext ?? readPendingThreadStartContext(deps, args.thread.id);
  if (startContext === null) {
    throw new ApiError(
      500,
      "internal_error",
      `Thread ${args.thread.id} is pending but has no start context to dispatch`,
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
    return null;
  }
  const startingThread = getThread(deps.db, args.thread.id);
  if (!startingThread) {
    return null;
  }
  setThreadPendingStartContext(deps.db, {
    threadId: args.thread.id,
    pendingStartContext: null,
  });
  return {
    claimedRow,
    execution,
    input: args.payload.input,
    startContext,
    startingThread,
  };
}

/**
 * The launching half: the existing provisioning machinery takes over with the
 * message riding the cold-start command, exactly as creation has always done
 * it. Deliberately outside the evaluation lock — provisioning can take as long
 * as a clone, and holding the lock across it would stall every other dispatch
 * in the server.
 */
async function launchAdmittedThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  admission: PendingThreadAdmission,
): Promise<void> {
  const { claimedRow, startContext, startingThread } = admission;
  const context = requestThreadProvision(deps, {
    thread: startingThread,
    environmentIntent: startContext.environmentIntent,
    execution: admission.execution,
    fork: startContext.fork,
    input: admission.input,
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
 * Writes the resolved execution tuple back onto the request the executor will
 * run, as EXPLICIT fields rather than leaving it to be re-derived, so the
 * executor's own `buildExecutionOptions` is idempotent — the same trick the
 * queue drain has always used to replay a frozen tuple.
 */
function resolveExecutionIntoPayload(
  payload: SendMessageRequest & { inputGroups?: PromptInput[][] },
  execution: ResolvedThreadExecutionOptions,
): SendMessageRequest & { inputGroups?: PromptInput[][] } {
  return {
    ...payload,
    model: execution.model,
    reasoningLevel: execution.reasoningLevel,
    serviceTier: execution.serviceTier,
    permissionMode: execution.permissionMode,
  };
}
