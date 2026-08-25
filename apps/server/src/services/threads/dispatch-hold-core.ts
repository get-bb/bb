import {
  getEnvironment,
  getHost,
  getThread,
  listDispatchHolds,
  type DispatchHoldRow,
} from "@bb/db";
import {
  DISPATCH_HOLD_REASON_MAX_LENGTH,
  type DispatchHoldReleaseKind,
  type PromptInput,
  type ResolvedThreadExecutionOptions,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  createThreadDispatchHold,
  parseDispatchHoldPayload,
  parseDispatchHoldThreadStartContext,
  settleDispatchHold,
} from "./dispatch-holds.js";

type CoreDispatchHoldDeps = Pick<AppDeps, "db" | "hub">;

/**
 * Core's two wait mechanisms as holder strings. They are `const` rather than
 * inline literals so a rename in `coreDispatchHoldMechanismValues` fails at
 * every use site instead of silently orphaning rows nothing queries for.
 */
export const CORE_REPROVISION_DISPATCH_HOLDER = "core:reprovision";
export const CORE_HOST_OFFLINE_DISPATCH_HOLDER = "core:host-offline";

export const REPROVISION_DISPATCH_HOLD_REASON =
  "Waiting for workspace to be ready";

interface CreateReprovisionDispatchHoldArgs {
  environmentId: string;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  threadId: string;
}

interface SettleReprovisionDispatchHoldsArgs {
  releaseKind: Extract<DispatchHoldReleaseKind, "owner" | "cancelled">;
  threadId: string;
}

/**
 * Records the turn a reprovision just parked.
 *
 * This hold is a *tracking record*, not the dispatch carrier. The reprovision
 * path already persists the turn as a deferred `client/turn/requested` event
 * and replays it through the provisioning machinery on workspace-ready, and
 * that ordering is the sequencing invariant the extraction boundary keeps in
 * core. So the row exists to give the wait a holder, a reason, a timeline entry
 * and a Cancel affordance — never to re-dispatch. Nothing releases it into a
 * send: it is not `userReleasable`, it carries no `resumeAt` for the timer
 * sweep, and `core:` holders are exempt from the orphan sweep.
 *
 * The payload still carries the real input and the frozen execution tuple so
 * the hold renders like every other held turn.
 */
export function createReprovisionDispatchHold(
  deps: CoreDispatchHoldDeps,
  args: CreateReprovisionDispatchHoldArgs,
): DispatchHoldRow {
  return createThreadDispatchHold(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    holder: CORE_REPROVISION_DISPATCH_HOLDER,
    payload: {
      kind: "inline",
      input: args.input,
      execution: args.execution,
      pluginInputs: {},
    },
    reason: REPROVISION_DISPATCH_HOLD_REASON,
    // There is nothing to release into until the workspace exists, so neither
    // the user nor the timer sweep may act on this row.
    resumeAt: null,
    userReleasable: false,
  });
}

/**
 * Ends the reprovision wait for a thread. `owner` is the workspace becoming
 * ready — the parked turn is dispatching right now by the deferred event.
 * `cancelled` is every way the parked turn is dropped instead: provisioning
 * failed, or the user stopped the thread (from the hold card or the thread's
 * own Stop button).
 *
 * Idempotent by construction: it only sees live rows, and `settleDispatchHold`
 * compare-and-sets, so a stop that races the workspace-ready settle produces
 * one outcome and the loser does nothing.
 */
export function settleReprovisionDispatchHolds(
  deps: CoreDispatchHoldDeps,
  args: SettleReprovisionDispatchHoldsArgs,
): void {
  for (const row of listDispatchHolds(deps.db, {
    threadId: args.threadId,
    holder: CORE_REPROVISION_DISPATCH_HOLDER,
    liveOnly: true,
  })) {
    settleDispatchHold(deps, { row, releaseKind: args.releaseKind });
  }
}

/** The host a thread's work would run on, or null when it has no environment. */
function threadHostId(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): string | null {
  const thread = getThread(deps.db, threadId);
  if (!thread || thread.deletedAt !== null || thread.environmentId === null) {
    return null;
  }
  return getEnvironment(deps.db, thread.environmentId)?.hostId ?? null;
}

function hostOfflineDispatchHoldReason(
  deps: Pick<AppDeps, "db">,
  hostId: string | null,
): string {
  const name = hostId === null ? null : (getHost(deps.db, hostId)?.name ?? null);
  const reason = `Waiting for ${name ?? "the host"} to reconnect`;
  return reason.length > DISPATCH_HOLD_REASON_MAX_LENGTH
    ? `${reason.slice(0, DISPATCH_HOLD_REASON_MAX_LENGTH - 1)}…`
    : reason;
}

/**
 * Re-parks a dispatch whose background release could not reach the host.
 *
 * A background release has no caller left to report to, so failing would drop
 * the turn silently — the user scheduled a message for 9am, the laptop was
 * asleep at 9am, and nothing would ever run it. Instead the whole dispatch
 * (payload and cold-start context alike) moves into a fresh `core:host-offline`
 * hold that the host's next daemon connection releases.
 *
 * Returns null when there is nothing left to wait for (the thread is gone).
 */
export function parkDispatchHoldForOfflineHost(
  deps: CoreDispatchHoldDeps,
  hold: DispatchHoldRow,
): DispatchHoldRow | null {
  const thread = getThread(deps.db, hold.threadId);
  if (!thread || thread.deletedAt !== null) {
    return null;
  }
  const startContext = parseDispatchHoldThreadStartContext(hold);
  return createThreadDispatchHold(deps, {
    threadId: hold.threadId,
    environmentId: thread.environmentId,
    holder: CORE_HOST_OFFLINE_DISPATCH_HOLDER,
    payload: parseDispatchHoldPayload(hold),
    reason: hostOfflineDispatchHoldReason(
      deps,
      threadHostId(deps, hold.threadId),
    ),
    // The host coming back is the release signal; a deadline would fire the
    // same failing dispatch again while it is still away.
    resumeAt: null,
    userReleasable: false,
    ...(startContext !== null ? { threadStartContext: startContext } : {}),
  });
}

/**
 * The `core:host-offline` holds waiting on one host.
 *
 * `holder` narrows the scan to rows core parked for this reason — a set that is
 * empty on a healthy server and never larger than the number of dispatches that
 * missed one host — and the host is then resolved per row because a hold names
 * its thread, not its host. There is no thread→host column to join on.
 */
export function listLiveHostOfflineDispatchHoldsForHost(
  deps: Pick<AppDeps, "db">,
  hostId: string,
): DispatchHoldRow[] {
  return listDispatchHolds(deps.db, {
    holder: CORE_HOST_OFFLINE_DISPATCH_HOLDER,
    liveOnly: true,
  }).filter((hold) => threadHostId(deps, hold.threadId) === hostId);
}
