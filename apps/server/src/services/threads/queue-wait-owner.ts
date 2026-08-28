import {
  getQueuedThreadMessage,
  getThread,
  updateQueuedThreadMessageExecution,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type { QueuedMessageReportUpdate } from "@bb/domain";
import type { PluginDispatchAmendments } from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  clearQueuedMessageWait,
  queuedMessageWaitingOn,
  reportQueuedMessageProgress,
} from "./queue-parking.js";
import { sendQueuedMessage } from "./queued-messages.js";

type QueueWaitOwnerDeps = LoggedPendingInteractionWorkSessionDeps;

/**
 * The live row `pluginId` is holding the wait on, or a 403.
 *
 * Holding the wait is the whole authorization model: a plugin may act on the
 * dispatches it parked and on nothing else. Refusing another plugin's row
 * matters more than it looks — a parked row is a user's pending message, and
 * clearing someone else's wait is indistinguishable from sending it.
 */
function requireOwnedQueueWait(
  deps: Pick<QueueWaitOwnerDeps, "db">,
  args: { pluginId: string; queuedMessageId: string },
): QueuedThreadMessageRow {
  const row = getQueuedThreadMessage(deps.db, args.queuedMessageId);
  if (row === null) {
    throw new ApiError(
      404,
      "queued_message_not_found",
      `Queued message ${args.queuedMessageId} not found`,
    );
  }
  const waitingOn = queuedMessageWaitingOn(row);
  if (waitingOn.kind !== "plugin" || waitingOn.pluginId !== args.pluginId) {
    throw new ApiError(
      403,
      "queue_wait_not_owned",
      `Queued message ${args.queuedMessageId} is not waiting on the "${args.pluginId}" plugin`,
    );
  }
  return row;
}

/**
 * `bb.experimental_dispatch.clearWait`. The amendment is applied to the parked
 * row first, and the full gate pass then re-runs — including the caller's own
 * gate, so a limiter that clears while still at capacity re-parks rather than
 * exceeding its limit. Everything that can be refused is refused before the
 * wait is cleared, so a plugin whose amendment is rejected still has a parked
 * row it can clear unamended.
 */
export async function clearQueueWaitForPlugin(
  deps: QueueWaitOwnerDeps,
  args: {
    pluginId: string;
    queuedMessageId: string;
    amend: PluginDispatchAmendments | undefined;
  },
): Promise<void> {
  const row = requireOwnedQueueWait(deps, args);
  const thread = getThread(deps.db, row.threadId);
  if (!thread || thread.deletedAt !== null) {
    throw new ApiError(
      404,
      "thread_not_found",
      `Thread ${row.threadId} no longer exists`,
    );
  }
  if (args.amend !== undefined) {
    applyQueueWaitAmendment(deps, { amend: args.amend, row });
  }
  clearQueuedMessageWait(deps, {
    queuedMessageId: row.id,
    threadId: row.threadId,
  });
  await sendQueuedMessage(deps, {
    mode: "auto",
    queuedMessageId: row.id,
    threadId: row.threadId,
    // A cleared wait makes the row ELIGIBLE, not exempt: the pass runs again.
    // That is what makes a stale `clearWait` safe rather than a way past the
    // checkpoint.
    sendNow: false,
  });
}

function applyQueueWaitAmendment(
  deps: QueueWaitOwnerDeps,
  args: {
    amend: PluginDispatchAmendments;
    row: QueuedThreadMessageRow;
  },
): void {
  const { amend } = args;
  if (amend.environment !== undefined) {
    throw new ApiError(
      400,
      "invalid_request",
      "A thread's workspace can only be chosen on the attempt that creates it, so `environment` cannot be amended when clearing a wait.",
    );
  }
  updateQueuedThreadMessageExecution(deps.db, deps.hub, {
    id: args.row.id,
    threadId: args.row.threadId,
    ...(amend.input !== undefined ? { content: amend.input } : {}),
    ...(amend.model !== undefined ? { model: amend.model } : {}),
    ...(amend.reasoningLevel !== undefined
      ? { reasoningLevel: amend.reasoningLevel }
      : {}),
    ...(amend.serviceTier !== undefined
      ? { serviceTier: amend.serviceTier }
      : {}),
    ...(amend.permissionMode !== undefined
      ? { permissionMode: amend.permissionMode }
      : {}),
  });
}

/** `bb.experimental_dispatch.report`; false when the row is already gone. */
export function reportQueueWaitForPlugin(
  deps: QueueWaitOwnerDeps,
  args: {
    pluginId: string;
    queuedMessageId: string;
    update: QueuedMessageReportUpdate;
  },
): boolean {
  requireOwnedQueueWait(deps, args);
  return reportQueuedMessageProgress(deps, {
    queuedMessageId: args.queuedMessageId,
    update: args.update,
  });
}
