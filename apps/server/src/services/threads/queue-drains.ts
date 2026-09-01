import {
  getThread,
  listDueScheduledQueuedThreadMessages,
  listQueuedThreadMessagePluginWaitRefs,
  listQueuedThreadMessagesByWaitHolder,
  listQueuedThreadMessagesWaitingOnKind,
  listThreadIdsWithHostOfflineQueueWaits,
} from "@bb/db";
import {
  QUEUED_MESSAGE_PLUGIN_WAIT_HOLDER_PREFIX,
  type QueuedMessageWaitingOnKind,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { isDispatchRequeuedRecently } from "./dispatch-hooks.js";
import { clearQueuedMessageWait } from "./queue-waits.js";
import { recordQueuedMessageDrainFailure } from "./queue-drain-failure.js";
import {
  runQueuedMessageAutoSendForThread,
  sendQueuedMessage,
} from "./queued-messages.js";

/**
 * Narrow slice of the plugin service the orphan sweep needs: it only asks
 * whether a wait's holder still exists.
 */
export interface QueueWaitPluginDirectory {
  isPluginLoaded(pluginId: string): boolean;
}

type QueueDrainDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * Drops a thread's waits of one kind and re-drives its queue.
 *
 * Clearing rather than dispatching is the whole trick: a cleared row is an
 * ordinary queued row, so the existing idle drain picks it up when the thread
 * is actually able to take it. A row cleared into a thread that is still busy
 * simply re-queues on `thread-busy` at its next attempt, which is correct and
 * costs nothing — so a drain never has to reason about whether its signal was
 * the LAST thing the message was waiting for.
 */
export function clearThreadQueueWaitsOfKind(
  deps: Pick<QueueDrainDeps, "db" | "hub">,
  args: { threadId: string; kind: QueuedMessageWaitingOnKind },
): number {
  const rows = listQueuedThreadMessagesWaitingOnKind(deps.db, {
    kind: args.kind,
    threadId: args.threadId,
  });
  for (const row of rows) {
    clearQueuedMessageWait(deps, {
      queuedMessageId: row.id,
      threadId: args.threadId,
    });
  }
  return rows.length;
}

/**
 * Workspace-ready drain. Replaces the reprovision hold's release: the
 * follow-ups and steers that arrived while the workspace was being
 * (re)provisioned stop waiting on it here.
 */
export function drainThreadQueueOnWorkspaceReady(
  deps: QueueDrainDeps,
  threadId: string,
): void {
  const cleared = clearThreadQueueWaitsOfKind(deps, {
    threadId,
    kind: "provisioning",
  });
  if (cleared === 0) return;
  requestThreadQueueDrain(deps, threadId, "workspace-ready");
}

/**
 * Provisioning ended without a ready workspace (it failed, or the user stopped
 * the thread).
 *
 * The waits are cleared rather than the rows cancelled: the messages are still
 * the user's, and a thread that failed to provision is one the user can retry,
 * at which point these are exactly the messages that should go. Leaving them
 * waiting on a `provisioning` that will never complete is the shape that
 * produced #1789 — a row nothing will ever move.
 */
export function clearThreadQueueProvisioningWaits(
  deps: Pick<QueueDrainDeps, "db" | "hub">,
  threadId: string,
): void {
  clearThreadQueueWaitsOfKind(deps, { threadId, kind: "provisioning" });
}

/**
 * Host-reconnect drain: the release signal for `host-offline` waits. A drain
 * whose dispatch arrived at a disconnected machine parked its row on that
 * wait with no schedule — an offline host is not a clock — so the daemon
 * socket opening for the machine is the one event that can move those rows,
 * and this is where it does.
 */
export function drainThreadQueueOnHostReconnect(
  deps: QueueDrainDeps,
  hostId: string,
): void {
  for (const threadId of listThreadIdsWithHostOfflineQueueWaits(
    deps.db,
    hostId,
  )) {
    const cleared = clearThreadQueueWaitsOfKind(deps, {
      threadId,
      kind: "host-offline",
    });
    if (cleared === 0) continue;
    requestThreadQueueDrain(deps, threadId, "host-reconnected");
  }
}

/**
 * Interaction-settled drain. Replaces the `deferred_thread_messages` flush:
 * messages sent while the thread was awaiting an answer stop waiting here.
 */
export function requestThreadQueueDrainForSettledInteraction(
  deps: QueueDrainDeps,
  threadId: string,
): void {
  // The settle can run inside a database transaction, so nothing here touches
  // the database synchronously.
  deferAfterResponse({
    config: deps.config,
    context: { threadId },
    logger: deps.logger,
    name: "Interaction-settled queue drain",
    work: async () => {
      if (deps.pendingInteractions.hasPendingThreadInteraction(threadId)) {
        return;
      }
      const cleared = clearThreadQueueWaitsOfKind(deps, {
        threadId,
        kind: "interaction",
      });
      if (cleared === 0) return;
      await runQueuedMessageAutoSendForThread(deps, { threadId });
    },
  });
}

function requestThreadQueueDrain(
  deps: QueueDrainDeps,
  threadId: string,
  reason: string,
): void {
  deferAfterResponse({
    config: deps.config,
    context: { threadId, reason },
    logger: deps.logger,
    name: "Queue drain",
    work: () => runQueuedMessageAutoSendForThread(deps, { threadId }),
  });
}

/**
 * The due sweep: rows whose `sendAt` has arrived.
 *
 * This is what makes a scheduled send fire, and it is the only thing that has
 * to survive a restart for `--send-at` to work — the row carries the deadline,
 * so a server that was down at 9am dispatches on its first tick after coming
 * back.
 *
 * A due row is dispatched by claiming it directly rather than by clearing a
 * wait, because "due" is not something the idle drain can see: the row's wait
 * is `time` (or a plugin wait with a `sendAt`), which is deliberately not
 * drainable, and it is this sweep's own clock check that makes it eligible.
 */
export async function runDueScheduledQueueSweep(
  deps: QueueDrainDeps,
  now: number,
): Promise<void> {
  for (const row of listDueScheduledQueuedThreadMessages(deps.db, now)) {
    await dispatchDueQueuedMessage(deps, row);
  }
}

/** The columns a re-attempt needs; both sweeps act strictly by reference. */
interface QueuedMessageDispatchRef {
  id: string;
  threadId: string;
}

async function dispatchDueQueuedMessage(
  deps: QueueDrainDeps,
  row: QueuedMessageDispatchRef,
): Promise<void> {
  if (isDispatchRequeuedRecently(row.threadId)) {
    // This thread turned an attempt straight back into a queue moments ago.
    // Nothing is settled here, so the row stays and the next tick tries again.
    return;
  }
  const thread = getThread(deps.db, row.threadId);
  if (!thread || thread.deletedAt !== null) {
    return;
  }
  try {
    // The row's own `sendAt` has passed, so the attempt's time wait is
    // satisfied and every other wait is re-decided from scratch — including
    // the plugin pass, which is what makes a scheduled send still respect a
    // limiter at 9am rather than jumping it.
    await clearDueWaitAndAttempt(deps, row);
  } catch (error) {
    // A background attempt has no caller left to report to, so the row carries
    // the outcome itself — as a `host-offline` wait when the machine is simply
    // away, or as a failure reason otherwise. Re-queueing the ORIGINAL wait here
    // would let a broken dispatch loop forever; the row was already returned to
    // the queue by the claim release.
    recordQueuedMessageDrainFailure(deps, { error, row, thread });
    deps.logger.warn(
      {
        queuedMessageId: row.id,
        threadId: row.threadId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Failed to dispatch a due scheduled message",
    );
  }
}

async function clearDueWaitAndAttempt(
  deps: QueueDrainDeps,
  row: QueuedMessageDispatchRef,
): Promise<void> {
  clearQueuedMessageWait(deps, {
    queuedMessageId: row.id,
    threadId: row.threadId,
  });
  await sendQueuedMessage(deps, {
    mode: "auto",
    queuedMessageId: row.id,
    threadId: row.threadId,
    // A due row is eligible, not overridden: the plugin pass runs. Send-now is
    // the only thing that bypasses it, and a timer is not a user.
    sendNow: false,
  });
}

let requestedDrainPending = false;

/**
 * Schedules the requested drain. This is what backs
 * `bb.experimental_hooks.recheck()`: core owns the re-draining, a plugin
 * owns the condition and asks for the re-ask.
 *
 * Bursts coalesce into one pass: five turns completing together free five
 * slots, and one walk of the queued rows fills as many of them as the gates
 * allow. The flag clears when the walk starts, so a request arriving while a
 * walk is in progress still gets its own pass.
 */
export function requestQueueDrain(deps: QueueDrainDeps): void {
  if (requestedDrainPending) return;
  requestedDrainPending = true;
  deferAfterResponse({
    config: deps.config,
    context: {},
    logger: deps.logger,
    name: "Requested queue drain",
    work: async () => {
      requestedDrainPending = false;
      await runRequestedQueueDrain(deps);
    },
  });
}

/**
 * Re-attempts every plugin-queued row, oldest first, because a plugin said a
 * condition it holds waits on may have changed.
 *
 * Deliberately global rather than scoped to whatever the caller had in mind: a
 * wait can be expressed over any condition and core does not know which one a
 * plugin used — it does not even know which plugin asked. A row that is still
 * blocked simply re-queues, which costs one gate pass and is exactly what
 * makes the request safe: no plugin has to decide whether its own release was
 * warranted, or whether it was the last thing a message was waiting on.
 *
 * Only plugin waits: core waits each have their own release signal and are
 * core's to clear — the due sweep for `time`, the idle drain for
 * `thread-busy`, the workspace-ready drain for `provisioning`, the
 * interaction-settled drain for `interaction`, and the host-reconnect drain
 * for `host-offline`. Rows are walked in queue order so a full pool drains in
 * the order it filled, and the existing re-queue pacing
 * (`isDispatchRequeuedRecently`, one second per thread) is what keeps a plugin
 * that re-queues everything from being re-asked in a loop.
 */
export async function runRequestedQueueDrain(
  deps: QueueDrainDeps,
): Promise<void> {
  for (const row of listQueuedThreadMessagePluginWaitRefs(deps.db)) {
    if (isDispatchRequeuedRecently(row.threadId)) continue;
    const thread = getThread(deps.db, row.threadId);
    if (!thread || thread.deletedAt !== null) continue;
    try {
      await clearDueWaitAndAttempt(deps, row);
    } catch (error) {
      // Same posture as the due sweep: nobody is listening, so the outcome
      // lands on the row rather than propagating and stopping the walk.
      recordQueuedMessageDrainFailure(deps, { error, row, thread });
      deps.logger.warn(
        {
          queuedMessageId: row.id,
          threadId: row.threadId,
          ...runtimeErrorLogFields(deps.config, error),
        },
        "Failed to re-attempt a plugin-queued message on a requested drain",
      );
    }
  }
}

/**
 * Clears waits whose holding plugin is no longer running, so uninstalling or
 * disabling a plugin can never strand a user's message. Core waits are exempt:
 * their owner is the product itself and cannot go away.
 *
 * Clearing (not cancelling) is deliberate — the user asked for this message,
 * and the plugin that queued it is no longer around to object.
 */
export async function runOrphanedQueueWaitSweep(
  deps: QueueDrainDeps,
  plugins: QueueWaitPluginDirectory,
): Promise<void> {
  const threadIds = new Set<string>();
  for (const row of listQueuedThreadMessagePluginWaitRefs(deps.db)) {
    const holder = row.waitHolder;
    const pluginId = holder.slice(
      QUEUED_MESSAGE_PLUGIN_WAIT_HOLDER_PREFIX.length,
    );
    if (plugins.isPluginLoaded(pluginId)) continue;
    deps.logger.info(
      { queuedMessageId: row.id, pluginId, threadId: row.threadId },
      "Clearing a queue wait: its holding plugin is no longer running",
    );
    clearQueuedMessageWait(deps, {
      queuedMessageId: row.id,
      threadId: row.threadId,
    });
    threadIds.add(row.threadId);
  }
  for (const threadId of threadIds) {
    await runQueuedMessageAutoSendForThread(deps, { threadId });
  }
}

/**
 * Clears every wait one plugin holds, called when it is disabled or removed
 * rather than waiting for the next sweep tick. Deliberately not called on
 * reload: a reloading plugin is coming straight back and still owns its waits.
 */
export async function clearQueueWaitsForUnregisteredPlugin(
  deps: QueueDrainDeps,
  pluginId: string,
): Promise<void> {
  const holder = `${QUEUED_MESSAGE_PLUGIN_WAIT_HOLDER_PREFIX}${pluginId}` as const;
  const threadIds = new Set<string>();
  for (const row of listQueuedThreadMessagesByWaitHolder(deps.db, holder)) {
    deps.logger.info(
      { queuedMessageId: row.id, pluginId, threadId: row.threadId },
      "Clearing a queue wait: its holding plugin was unregistered",
    );
    clearQueuedMessageWait(deps, {
      queuedMessageId: row.id,
      threadId: row.threadId,
    });
    threadIds.add(row.threadId);
  }
  for (const threadId of threadIds) {
    await runQueuedMessageAutoSendForThread(deps, { threadId });
  }
}
