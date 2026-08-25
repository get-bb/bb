import { getThread, type DispatchHoldRow } from "@bb/db";
import type {
  DispatchHoldInlinePayload,
  DispatchHoldReleaseKind,
  Thread,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { isHostUnavailableApiError } from "../hosts/online-rpc.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  CORE_REPROVISION_DISPATCH_HOLDER,
  listLiveHostOfflineDispatchHoldsForHost,
  parkDispatchHoldForOfflineHost,
} from "./dispatch-hold-core.js";
import {
  parseDispatchHoldPayload,
  parseDispatchHoldThreadStartContext,
  settleDispatchHold,
  type DispatchHoldThreadStartContext,
} from "./dispatch-holds.js";
import { applyLoggedThreadLifecycleEvent } from "./lifecycle-outcome.js";
import { resolveThreadHostCommandEnvironment } from "./thread-command-environment.js";
import { stopThreadForCurrentState } from "./thread-lifecycle.js";
import {
  requestThreadProvision,
  scheduleThreadProvisioningAdvance,
} from "./thread-provisioning.js";
import { acceptThreadSendRequest } from "./thread-send-request.js";

type DispatchHoldReleaseDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * Release kinds that dispatch what the hold was holding. `cancelled` is the
 * only kind that discards it, which is why cancelling is always safe.
 */
type DispatchingReleaseKind = Exclude<DispatchHoldReleaseKind, "cancelled">;

/**
 * Rebuilds the send request a released inline hold dispatches.
 *
 * The execution tuple was resolved and frozen when the hold was created, so it
 * is replayed verbatim rather than re-derived — the model the user picked at
 * 5pm is the model that runs at 9am. `executionInputSources` is deliberately
 * omitted, matching how the queue drain replays a frozen tuple
 * (`sendQueuedMessagePayload`): the values are explicit inputs to this send.
 *
 * `queue-if-active` is what makes a release safe on a busy thread: the send
 * path queues instead of interrupting the running turn.
 */
function releasedHoldSendRequest(
  payload: DispatchHoldInlinePayload,
): SendMessageRequest {
  return {
    input: payload.input,
    mode: "queue-if-active",
    model: payload.execution.model,
    permissionMode: payload.execution.permissionMode,
    reasoningLevel: payload.execution.reasoningLevel,
    serviceTier: payload.execution.serviceTier,
  };
}

/**
 * Cold-start dispatch: the thread exists but has never run, so the release
 * does what creation would have done — moves it `idle → starting`, records the
 * provisioning intent frozen at create time, and drives provisioning off this
 * stack. Workspace readiness and the first turn are then ordered by the
 * existing provisioning machinery, unchanged.
 */
function dispatchHeldThreadStart(
  deps: DispatchHoldReleaseDeps,
  args: {
    payload: DispatchHoldInlinePayload;
    startContext: DispatchHoldThreadStartContext;
    thread: Thread;
  },
): void {
  const prepared = applyLoggedThreadLifecycleEvent(deps, {
    threadId: args.thread.id,
    event: { type: "run.preparing" },
  });
  if (!prepared.applied) {
    // The thread was archived, deleted or already started under the release.
    // The hold row is already released; re-dispatching into a thread that
    // moved on would be worse than dropping the turn.
    deps.logger.warn(
      { threadId: args.thread.id, status: args.thread.status },
      "Released cold-start hold could not move the thread to starting",
    );
    return;
  }
  const startingThread = getThread(deps.db, args.thread.id);
  if (!startingThread) {
    return;
  }
  const context = requestThreadProvision(deps, {
    thread: startingThread,
    environmentIntent: args.startContext.environmentIntent,
    execution: args.payload.execution,
    fork: args.startContext.fork,
    input: args.payload.input,
    ...(args.startContext.providerInput !== undefined
      ? { providerInput: args.startContext.providerInput }
      : {}),
    startedOnBehalfOf: args.startContext.startedOnBehalfOf,
    titleProvided: args.startContext.titleProvided,
  });
  scheduleThreadProvisioningAdvance(deps, context, startingThread.id);
}

/**
 * Runs the dispatch a released hold described. Phase 2 re-runs the gate
 * pipeline and applies `amend` here, before anything dispatches; until then a
 * release is unconditional.
 */
async function dispatchReleasedHold(
  deps: DispatchHoldReleaseDeps,
  hold: DispatchHoldRow,
): Promise<void> {
  const payload = parseDispatchHoldPayload(hold);
  if (payload.kind === "retry") {
    // Retry holds arrive with `turn.failed` in phase 3; nothing creates one
    // yet, so a release has no original request to re-submit.
    deps.logger.warn(
      { holdId: hold.id, threadId: hold.threadId },
      "Released a retry hold, which has no dispatch path yet",
    );
    return;
  }
  const thread = getThread(deps.db, hold.threadId);
  if (!thread || thread.deletedAt !== null) {
    return;
  }
  const startContext = parseDispatchHoldThreadStartContext(hold);
  if (startContext !== null) {
    dispatchHeldThreadStart(deps, { payload, startContext, thread });
    return;
  }
  await acceptThreadSendRequest(deps, {
    payload: releasedHoldSendRequest(payload),
    thread,
  });
}

/**
 * Releases a hold and dispatches it. Returns the released row, or null when
 * the compare-and-set lost to a concurrent release — a timer firing as the
 * user hits "Release now" dispatches once, and the loser returns quietly
 * because the work it wanted done is already happening.
 */
export async function releaseDispatchHoldAndDispatch(
  deps: DispatchHoldReleaseDeps,
  args: { hold: DispatchHoldRow; releaseKind: DispatchingReleaseKind },
): Promise<DispatchHoldRow | null> {
  const released = settleDispatchHold(deps, {
    row: args.hold,
    releaseKind: args.releaseKind,
  });
  if (!released) {
    return null;
  }
  await dispatchReleasedHold(deps, released);
  return released;
}

/**
 * Background release (timer sweep, orphan sweep, plugin teardown, host
 * reconnect). The row is already released when a dispatch failure surfaces, so
 * a failure is logged rather than thrown: there is no caller left to receive
 * it, and re-holding would let a broken dispatch loop forever.
 *
 * The one exception is a host that is simply away. That is not a broken
 * dispatch, it is a dispatch with nowhere to land yet, and it has a definite
 * wake-up signal (the daemon reconnecting), so it re-parks as a
 * `core:host-offline` hold instead of vanishing with a log line. The loop the
 * general rule guards against cannot form: only a host connecting releases
 * those rows, so a host that keeps flapping costs one hold per connection, not
 * a spin.
 *
 * Interactive paths are deliberately excluded — a user releasing or sending to
 * an offline host still gets today's synchronous 502.
 */
export async function releaseDispatchHoldInBackground(
  deps: DispatchHoldReleaseDeps,
  args: { hold: DispatchHoldRow; releaseKind: DispatchingReleaseKind },
): Promise<void> {
  try {
    await releaseDispatchHoldAndDispatch(deps, args);
  } catch (error) {
    if (isHostUnavailableApiError(error)) {
      const parked = reparkReleasedHoldForOfflineHost(deps, args.hold);
      if (parked) {
        return;
      }
    }
    deps.logger.warn(
      {
        holdId: args.hold.id,
        releaseKind: args.releaseKind,
        threadId: args.hold.threadId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to dispatch a released hold",
    );
  }
}

/** Moves a failed background dispatch into a `core:host-offline` hold. */
function reparkReleasedHoldForOfflineHost(
  deps: DispatchHoldReleaseDeps,
  hold: DispatchHoldRow,
): boolean {
  const parked = parkDispatchHoldForOfflineHost(deps, hold);
  if (!parked) {
    return false;
  }
  deps.logger.info(
    {
      holdId: parked.id,
      previousHoldId: hold.id,
      threadId: hold.threadId,
    },
    "Re-parked a released hold: its host is not connected",
  );
  return true;
}

/**
 * Host-connected trigger. A `core:host-offline` hold has no timer and is not
 * user-releasable, so this is the only thing that dispatches it — the daemon
 * websocket opening is what makes the host able to accept the work again.
 */
export async function releaseDispatchHoldsForConnectedHost(
  deps: DispatchHoldReleaseDeps,
  hostId: string,
): Promise<void> {
  for (const hold of listLiveHostOfflineDispatchHoldsForHost(deps, hostId)) {
    await releaseDispatchHoldInBackground(deps, {
      hold,
      releaseKind: "owner",
    });
  }
}

/**
 * Discards the held dispatch. Always permitted, including for `core:` holds
 * the user cannot release: cancelling never runs anything, so the worst case
 * is a turn that does not happen.
 *
 * A `core:reprovision` hold is the one kind whose turn is not stored in the
 * row — it was persisted as a deferred turn request and will replay when the
 * workspace is ready — so discarding it means abandoning the provisioning that
 * would replay it. That is exactly what the thread's own Stop button does, and
 * cancelling routes through it rather than reimplementing it, so the timeline,
 * the environment provision-cancel RPC and the `stopping → idle` landing are
 * identical either way.
 */
export async function cancelDispatchHold(
  deps: DispatchHoldReleaseDeps,
  hold: DispatchHoldRow,
): Promise<DispatchHoldRow> {
  const cancelled = settleDispatchHold(deps, {
    row: hold,
    releaseKind: "cancelled",
  });
  if (!cancelled) {
    throw new ApiError(
      409,
      "hold_already_released",
      "This hold has already been released",
    );
  }
  if (hold.holder === CORE_REPROVISION_DISPATCH_HOLDER) {
    await stopParkedReprovisionTurn(deps, hold.threadId);
  }
  return cancelled;
}

function stopParkedReprovisionTurn(
  deps: DispatchHoldReleaseDeps,
  threadId: string,
): Promise<void> {
  const thread = getThread(deps.db, threadId);
  if (!thread || thread.deletedAt !== null) {
    return Promise.resolve();
  }
  return stopThreadForCurrentState(
    deps,
    thread,
    resolveThreadHostCommandEnvironment({ db: deps.db, thread }),
  );
}

/**
 * Route entry: "Release now". Dispatches before responding rather than
 * deferring, for two reasons — the caller learns synchronously that its turn
 * could not run (the same failure a plain send would report), and a restart
 * between the release and the dispatch cannot lose the turn, because the row
 * is already released and no sweep would pick it up again.
 *
 * A cold start still does not block on the daemon: provisioning is driven off
 * this stack by `scheduleThreadProvisioningAdvance`.
 */
export async function releaseDispatchHoldFromRequest(
  deps: DispatchHoldReleaseDeps,
  args: { hold: DispatchHoldRow; releaseKind: DispatchingReleaseKind },
): Promise<DispatchHoldRow> {
  const released = await releaseDispatchHoldAndDispatch(deps, args);
  if (!released) {
    throw new ApiError(
      409,
      "hold_already_released",
      "This hold has already been released",
    );
  }
  return released;
}
