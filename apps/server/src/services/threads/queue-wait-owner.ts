import {
  getQueuedThreadMessage,
  getThread,
  setThreadProvider,
  updateQueuedThreadMessageExecution,
  type QueuedThreadMessageRow,
} from "@bb/db";
import type { QueuedMessageReportUpdate, Thread } from "@bb/domain";
import type { PluginDispatchAmendments } from "@get-bb/plugin-sdk";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { threadProviderAmendmentRefusal } from "./dispatch-gates.js";
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
 * exceeding its limit.
 *
 * `providerId` is the one amended field that does not live on the row: the
 * provider is a column on the thread, so it is applied there, and only while
 * the thread has never started. Everything that can be refused is refused
 * before the wait is cleared, so a plugin whose provider choice is rejected
 * still has a parked row it can clear unamended.
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
    applyQueueWaitAmendment(deps, { amend: args.amend, row, thread });
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
    thread: Thread;
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
  if (amend.providerId !== undefined) {
    if (amend.model === undefined) {
      // The row's frozen tuple names a model of the provider being left, and a
      // resolved tuple cannot say "re-resolve this", so a provider without a
      // model would dispatch a model the new provider does not have.
      throw new ApiError(
        400,
        "invalid_request",
        `Changing this message's provider to "${amend.providerId}" also needs a model: the parked turn's model belongs to the provider it is leaving.`,
      );
    }
    const refusal = threadProviderAmendmentRefusal(deps, {
      thread: args.thread,
    });
    if (refusal !== null) {
      throw new ApiError(
        409,
        "provider_not_amendable",
        `Cannot change this thread's provider to "${amend.providerId}": ${refusal}.`,
      );
    }
    const registration = deps.providerRegistry.get(amend.providerId);
    if (registration === null || !registration.info.available) {
      throw new ApiError(
        409,
        "provider_unavailable",
        `Provider "${amend.providerId}" is not available.`,
      );
    }
    setThreadProvider(deps.db, {
      threadId: args.thread.id,
      providerId: amend.providerId,
    });
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
