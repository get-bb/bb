import type { DispatchHoldRow } from "@bb/db";
import type { DispatchHoldReportUpdate } from "@bb/domain";
import type { PluginDispatchAmendments } from "@get-bb/plugin-sdk";
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
} from "./dispatch-holds.js";

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
 */
export async function releaseDispatchHoldForOwnerPlugin(
  deps: DispatchHoldOwnerDeps,
  args: {
    pluginId: string;
    holdId: string;
    amend: PluginDispatchAmendments | undefined;
  },
): Promise<void> {
  const hold = requireOwnedDispatchHold(deps, args);
  const amended =
    args.amend === undefined
      ? hold
      : applyDispatchHoldReleaseAmendment(deps, {
          hold,
          amend: args.amend,
        });
  await releaseDispatchHoldAndDispatch(deps, {
    hold: amended,
    // `owner` is the release kind that means "the plugin that held this is
    // letting it go", which is what keeps its own gate in the re-run — unlike
    // a user "Release now", which is an override.
    releaseKind: "owner",
  });
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
