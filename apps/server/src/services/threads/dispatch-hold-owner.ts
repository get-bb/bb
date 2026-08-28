import { getThread, type DispatchHoldRow } from "@bb/db";
import type { DispatchHoldReportUpdate } from "@bb/domain";
import type { PluginDispatchReleaseAmendments } from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  dispatchHoldOwnerPluginId,
  releaseDispatchHoldAndDispatch,
} from "./dispatch-hold-release.js";
import {
  applyDispatchHoldReleaseAmendment,
  reportDispatchHoldProgress,
  requireLiveDispatchHold,
  type DispatchHoldReleaseAmendment,
} from "./dispatch-holds.js";
import { applyThreadProviderAmendment } from "./thread-provider-amendment.js";

type DispatchHoldOwnerDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * The live hold `pluginId` owns, or a 403.
 *
 * Ownership is the whole authorization model for holds: a plugin may act on
 * the dispatches it parked and on nothing else. Refusing another plugin's hold
 * matters more than it looks — a hold is a user's pending message, and
 * releasing one early is indistinguishable from sending it.
 */
function requireOwnedDispatchHold(
  deps: DispatchHoldOwnerDeps,
  args: { pluginId: string; holdId: string },
): DispatchHoldRow {
  const hold = requireLiveDispatchHold(deps, args.holdId);
  if (dispatchHoldOwnerPluginId(hold) !== args.pluginId) {
    throw new ApiError(
      403,
      "hold_not_owned",
      `Dispatch hold ${args.holdId} is not owned by the "${args.pluginId}" plugin`,
    );
  }
  return hold;
}

/**
 * `bb.experimental_dispatch.release`. The amendment is applied to the hold's
 * frozen payload before it dispatches, and the gate pipeline then re-runs —
 * including the caller's own gate, so a limiter that releases while still at
 * capacity re-holds rather than exceeding its limit.
 *
 * `providerId` is the one amended field that does not live in that payload:
 * the provider is a column on the thread row, so it is applied there, and only
 * while the thread has never started. Everything it can refuse is refused
 * before the hold is settled, so a plugin whose provider choice is rejected
 * still holds a live hold it can release unamended.
 */
export async function releaseDispatchHoldForOwnerPlugin(
  deps: DispatchHoldOwnerDeps,
  args: {
    pluginId: string;
    holdId: string;
    amend: PluginDispatchReleaseAmendments | undefined;
  },
): Promise<void> {
  const hold = requireOwnedDispatchHold(deps, args);
  const payloadAmend =
    args.amend === undefined
      ? undefined
      : await resolveOwnerReleaseAmendment(deps, {
          amend: args.amend,
          hold,
        });
  const amended =
    payloadAmend === undefined
      ? hold
      : applyDispatchHoldReleaseAmendment(deps, {
          hold,
          amend: payloadAmend,
        });
  await releaseDispatchHoldAndDispatch(deps, {
    hold: amended,
    // `owner` is the release kind that means "the plugin that held this is
    // letting it go", which is what keeps its own gate in the re-run — unlike
    // a user "Release now", which is an override.
    releaseKind: "owner",
  });
}

/**
 * Splits an owner's amendment into the part that changes the thread (the
 * provider, applied here) and the part that changes the held payload (returned
 * for {@link applyDispatchHoldReleaseAmendment}).
 *
 * A `providerId` amendment must carry a `model`, and refusing a provider-only
 * one is not pedantry: the payload's frozen tuple names a model of the OLD
 * provider and a resolved tuple cannot express "re-resolve this", so a
 * provider without a model would dispatch a model the new provider does not
 * have. The reasoning level travels with them and comes back reconciled to
 * what the chosen model actually supports.
 */
async function resolveOwnerReleaseAmendment(
  deps: DispatchHoldOwnerDeps,
  args: { amend: PluginDispatchReleaseAmendments; hold: DispatchHoldRow },
): Promise<DispatchHoldReleaseAmendment> {
  const { providerId, ...payloadAmend } = args.amend;
  if (providerId === undefined) {
    return payloadAmend;
  }
  if (payloadAmend.model === undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      `Changing this hold's provider to "${providerId}" also needs a model: the held turn's model belongs to the provider it is leaving.`,
    );
  }
  const thread = getThread(deps.db, args.hold.threadId);
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(
      404,
      "thread_not_found",
      `Thread ${args.hold.threadId} no longer exists`,
    );
  }
  const { reasoningLevel } = await applyThreadProviderAmendment(deps, {
    amendment: {
      model: payloadAmend.model,
      providerId,
      reasoningLevel: payloadAmend.reasoningLevel,
    },
    hold: args.hold,
    thread,
  });
  return {
    ...payloadAmend,
    ...(reasoningLevel === undefined ? {} : { reasoningLevel }),
  };
}

/** `bb.experimental_dispatch.report`; false when the hold is already gone. */
export function reportDispatchHoldForOwnerPlugin(
  deps: DispatchHoldOwnerDeps,
  args: {
    pluginId: string;
    holdId: string;
    update: DispatchHoldReportUpdate;
  },
): boolean {
  requireOwnedDispatchHold(deps, args);
  return reportDispatchHoldProgress(deps, {
    holdId: args.holdId,
    update: args.update,
  });
}
