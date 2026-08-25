import { listDispatchHolds, listDueDispatchHolds } from "@bb/db";
import { DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX } from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { releaseDispatchHoldInBackground } from "./dispatch-hold-release.js";

/**
 * Narrow slice of the plugin service the orphan sweep needs: it only asks
 * whether a holder still exists.
 */
export interface DispatchHoldPluginDirectory {
  isPluginLoaded(pluginId: string): boolean;
}

type DispatchHoldSweepDeps = LoggedPendingInteractionWorkSessionDeps;

/** The plugin id in a `plugin:<id>` holder, or null for user/core holders. */
export function dispatchHoldOwnerPluginId(holder: string): string | null {
  return holder.startsWith(DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX)
    ? holder.slice(DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX.length)
    : null;
}

/**
 * Releases holds whose `resumeAt` has arrived. This is what makes a scheduled
 * send fire, and it is the only thing that has to survive a restart for
 * `--hold-until` to work: the row carries the deadline, so a server that was
 * down at 9am releases on its first tick after coming back.
 */
export async function runDueDispatchHoldSweep(
  deps: DispatchHoldSweepDeps,
  now: number,
): Promise<void> {
  for (const hold of listDueDispatchHolds(deps.db, now)) {
    await releaseDispatchHoldInBackground(deps, {
      hold,
      releaseKind: "timer",
    });
  }
}

/**
 * Releases holds whose owning plugin is no longer running, so uninstalling or
 * disabling a plugin can never strand the user's turn. `user` and `core:`
 * holders are exempt: their owner is the product itself and cannot go away.
 *
 * Releasing (not cancelling) is deliberate — the user asked for this turn, and
 * the plugin that deferred it is no longer around to object.
 */
export async function runOrphanedDispatchHoldSweep(
  deps: DispatchHoldSweepDeps,
  plugins: DispatchHoldPluginDirectory,
): Promise<void> {
  for (const hold of listDispatchHolds(deps.db, { liveOnly: true })) {
    const pluginId = dispatchHoldOwnerPluginId(hold.holder);
    if (pluginId === null || plugins.isPluginLoaded(pluginId)) {
      continue;
    }
    deps.logger.info(
      { holdId: hold.id, pluginId, threadId: hold.threadId },
      "Releasing dispatch hold: its owning plugin is no longer running",
    );
    await releaseDispatchHoldInBackground(deps, {
      hold,
      releaseKind: "orphaned",
    });
  }
}

/**
 * Prompt orphan release for one plugin, called when it is disabled or removed
 * rather than waiting for the next sweep tick. Deliberately not called on
 * reload: a reloading plugin is coming straight back and still owns its holds.
 */
export async function releaseDispatchHoldsForUnregisteredPlugin(
  deps: DispatchHoldSweepDeps,
  pluginId: string,
): Promise<void> {
  const holder = `${DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX}${pluginId}` as const;
  for (const hold of listDispatchHolds(deps.db, {
    holder,
    liveOnly: true,
  })) {
    deps.logger.info(
      { holdId: hold.id, pluginId, threadId: hold.threadId },
      "Releasing dispatch hold: its owning plugin was unregistered",
    );
    await releaseDispatchHoldInBackground(deps, {
      hold,
      releaseKind: "orphaned",
    });
  }
}
