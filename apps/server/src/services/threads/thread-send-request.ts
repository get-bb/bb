import {
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  getEnvironment,
  getThread,
  listDeferredThreadMessages,
  listThreadIdsWithDeliverableDeferredThreadMessages,
  listThreadIdsWithUndeliverableDeferredThreadMessages,
  type DeferredThreadMessageRow,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { goneThreadEnvironmentDetails } from "../lib/lifecycle-api-errors.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import {
  deferThreadMessage,
  parseDeferredThreadMessagePayload,
  type DeferredThreadMessagePayload,
} from "./deferred-thread-messages.js";
import { queueParentSystemMessage } from "./parent-system-messages.js";
import {
  createQueuedMessageForThread,
  queuedMessagePayloadFromSendRequest,
} from "./queued-messages.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { isManualCompactionActive } from "./thread-events.js";
import {
  ensureThreadIsWritable,
  resolveMessageSenderThreadId,
  sendThreadMessage,
} from "./thread-send.js";

interface AcceptThreadSendRequestArgs {
  payload: SendMessageRequest;
  thread: Thread;
}

/**
 * Takes a public `send` request (the `/threads/:id/send` route, `bb thread
 * tell`, `sdk.threads.send`) and decides how it reaches the thread:
 *
 * - the thread queue when the sender asked for `queue-if-active` on an active
 *   thread, or the thread is compacting;
 * - a deferred message when the thread awaits user interaction (#1650): a
 *   prompt cannot interrupt an open question or approval, so the message waits
 *   and {@link flushDeferredThreadMessages} delivers it through this same
 *   function once the interaction settles. `start` is the exception: it asks
 *   for a fresh turn on an idle thread and keeps its 409.
 * - otherwise an immediate start or steer.
 */
export async function acceptThreadSendRequest(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AcceptThreadSendRequestArgs,
): Promise<SendMessageResponse> {
  const { payload, thread } = args;
  const shouldQueue =
    thread.status === "active" &&
    (payload.mode === "queue-if-active" ||
      (payload.mode !== "start" && isManualCompactionActive(deps, thread)));
  if (shouldQueue) {
    await createQueuedMessageForThread(deps, {
      payload: queuedMessagePayloadFromSendRequest(payload),
      thread,
    });
    return { ok: true, delivery: "queued" };
  }
  if (
    payload.mode !== "start" &&
    deps.pendingInteractions.hasPendingThreadInteraction(thread.id)
  ) {
    ensureThreadIsWritable(thread);
    // Reject what can never deliver while the sender is still listening; the
    // rest of the send pipeline (execution options, plugin mentions) resolves
    // at delivery time, exactly like a queued message.
    resolveMessageSenderThreadId(deps, {
      senderThreadId: payload.senderThreadId,
      targetThread: thread,
    });
    await validatePromptAttachmentReferences({
      dataDir: deps.config.dataDir,
      input: payload.input,
      projectId: thread.projectId,
    });
    deferThreadMessage(deps, {
      threadId: thread.id,
      payload: { kind: "send", request: payload },
    });
    return { ok: true, delivery: "deferred" };
  }
  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload,
    thread,
    trigger: "user",
  });
  return { ok: true, delivery: "sent" };
}

interface DeliverDeferredThreadMessageArgs {
  payload: DeferredThreadMessagePayload;
  row: DeferredThreadMessageRow;
  thread: Thread;
}

/** Returns false when delivery must wait for a later flush. */
async function deliverDeferredThreadMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DeliverDeferredThreadMessageArgs,
): Promise<boolean> {
  const { payload, row, thread } = args;
  switch (payload.kind) {
    case "send": {
      // Re-enters the normal send policy: a thread that blocked again between
      // the settle and this flush re-defers the message as a new row.
      const result = await acceptThreadSendRequest(deps, {
        payload: payload.request,
        thread,
      });
      deleteDeferredThreadMessage(deps.db, { id: row.id, threadId: thread.id });
      deps.logger.info(
        {
          deferredMessageId: row.id,
          delivery: result.delivery,
          kind: payload.kind,
          threadId: thread.id,
        },
        "Delivered deferred thread message",
      );
      return true;
    }
    case "parent-system": {
      // `false` means the thread changed under the send (for example it went
      // idle between the prepared command and its transaction); the row stays
      // and the next flush takes the matching path.
      const delivered = await queueParentSystemMessage(deps, {
        input: payload.input,
        parentThreadId: thread.id,
        systemMessageKind: payload.systemMessageKind,
        systemMessageSubject: payload.systemMessageSubject,
      });
      if (!delivered) {
        return false;
      }
      deleteDeferredThreadMessage(deps.db, { id: row.id, threadId: thread.id });
      deps.logger.info(
        {
          deferredMessageId: row.id,
          kind: payload.kind,
          systemMessageKind: payload.systemMessageKind,
          threadId: thread.id,
        },
        "Delivered deferred thread message",
      );
      return true;
    }
  }
}

/**
 * A 400/404 from the send pipeline means the request references something that
 * no longer exists. Everything else (409 stopping or environment unavailable,
 * 422 plugin mention, 502 host away, timeouts) can clear on a later flush.
 */
function isDeferredThreadMessageRequestInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 400 || error.status === 404)
  );
}

/**
 * Why this thread can never take its held messages, or null while it still can.
 *
 * A destroyed environment is never reprovisioned (#1789), so a row waiting on
 * one would otherwise sit unsent until somebody archived the thread while every
 * sweep re-ran the send pipeline for it. A held row is only ever created for a
 * thread that had a live provider session, so a thread that now has no
 * environment row lost it to a post-destroy prune.
 */
function undeliverableDeferredThreadMessageReason(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): string | null {
  if (thread.deletedAt !== null) {
    return "thread_deleted";
  }
  if (thread.archivedAt !== null) {
    return "thread_archived";
  }
  if (thread.environmentId === null) {
    return "environment_pruned";
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  if (!environment) {
    return "environment_pruned";
  }
  return goneThreadEnvironmentDetails(environment)?.reason ?? null;
}

function dropUndeliverableDeferredThreadMessages(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "db" | "logger">,
  threadId: string,
  reason: string,
): void {
  const dropped = deleteDeferredThreadMessagesForThread(deps.db, threadId);
  // Warn, not info: every sender was told its message would be delivered.
  deps.logger.warn(
    { dropped, reason, threadId },
    "Dropped deferred thread messages: they can no longer be delivered",
  );
}

async function flushDeferredThreadMessagesNow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): Promise<void> {
  for (const row of listDeferredThreadMessages(deps.db, threadId)) {
    const thread = getThread(deps.db, threadId);
    if (!thread) {
      dropUndeliverableDeferredThreadMessages(deps, threadId, "thread_missing");
      return;
    }
    const undeliverableReason = undeliverableDeferredThreadMessageReason(
      deps,
      thread,
    );
    if (undeliverableReason !== null) {
      dropUndeliverableDeferredThreadMessages(
        deps,
        threadId,
        undeliverableReason,
      );
      return;
    }
    if (deps.pendingInteractions.hasPendingThreadInteraction(threadId)) {
      return;
    }
    let payload: DeferredThreadMessagePayload;
    try {
      payload = parseDeferredThreadMessagePayload(row);
    } catch (error) {
      deleteDeferredThreadMessage(deps.db, { id: row.id, threadId });
      deps.logger.error(
        { err: error, deferredMessageId: row.id, threadId },
        "Dropped malformed deferred thread message",
      );
      continue;
    }
    try {
      if (
        !(await deliverDeferredThreadMessage(deps, { payload, row, thread }))
      ) {
        return;
      }
    } catch (error) {
      const fields = {
        deferredMessageId: row.id,
        kind: payload.kind,
        ...runtimeErrorLogFields(deps.config, error),
        threadId,
      };
      if (isDeferredThreadMessageRequestInvalid(error)) {
        // The request itself can no longer be honored (its sender thread was
        // deleted, its attachment is gone): the same 400 the sender would have
        // received synchronously. Retrying cannot change that, and leaving the
        // row would block every later message for this thread.
        deleteDeferredThreadMessage(deps.db, { id: row.id, threadId });
        deps.logger.warn(
          fields,
          "Dropped deferred thread message: request is no longer valid",
        );
        continue;
      }
      // Keep this row and the ones behind it so arrival order survives; the
      // next settle or sweep retries. A thread that is stopping, a host that
      // is reconnecting, or a fresh interaction all clear on their own.
      if (isCommandTimeoutError(error)) {
        deps.logger.debug(
          fields,
          "Deferred thread message delivery deferred by host timeout",
        );
      } else {
        deps.logger.warn(
          fields,
          "Deferred thread message delivery failed; will retry",
        );
      }
      return;
    }
  }
}

/**
 * Delivers the messages deferred while `threadId` awaited user interaction.
 * A no-op while the thread still has a pending interaction. Flushes for one
 * thread never overlap, so a settle and a sweep cannot deliver a row twice.
 */
export async function flushDeferredThreadMessages(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): Promise<void> {
  await deps.lifecycleDedupers.deferredThreadMessageFlush.run(threadId, () =>
    flushDeferredThreadMessagesNow(deps, threadId),
  );
}

/**
 * Settle hook: schedules a flush off the caller's stack. The settle can run
 * inside a database transaction, so nothing here touches the database.
 */
export function requestDeferredThreadMessageFlush(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): void {
  deferAfterResponse({
    config: deps.config,
    context: { threadId },
    logger: deps.logger,
    name: "Deferred thread message flush",
    work: () => flushDeferredThreadMessages(deps, threadId),
  });
}

/**
 * Sweep entry: re-drives rows whose settle flush did not deliver (a restart
 * before the settle, a thread that was still stopping, a host that was away),
 * and drops rows that can never deliver.
 *
 * It visits only threads that can act on their rows now. A thread in `error`,
 * `starting` or `stopping` refuses every send, and its state only changes when
 * a user retries it, a start lands, or a stop finishes; driving it on each tick
 * would re-run the send pipeline and log a failure every ten seconds for as
 * long as it sat there. The rows wait instead, and the tick after the status
 * changes delivers them.
 */
export async function runDeferredThreadMessageSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  for (const threadId of listThreadIdsWithUndeliverableDeferredThreadMessages(
    deps.db,
  )) {
    await flushDeferredThreadMessages(deps, threadId);
  }
  for (const threadId of listThreadIdsWithDeliverableDeferredThreadMessages(
    deps.db,
  )) {
    await flushDeferredThreadMessages(deps, threadId);
  }
}
