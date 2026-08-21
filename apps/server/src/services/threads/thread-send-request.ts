import {
  deleteDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  getThread,
  listDeferredThreadMessages,
  listThreadIdsWithDeferredThreadMessages,
  type DeferredThreadMessageRow,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  SendMessageRequest,
  SendMessageResponse,
} from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
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

async function flushDeferredThreadMessagesNow(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): Promise<void> {
  for (const row of listDeferredThreadMessages(deps.db, threadId)) {
    const thread = getThread(deps.db, threadId);
    if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) {
      const dropped = deleteDeferredThreadMessagesForThread(deps.db, threadId);
      deps.logger.info(
        { dropped, threadId },
        "Dropped deferred thread messages: thread is gone",
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
      // Keep this row and the ones behind it so arrival order survives; the
      // next settle or sweep retries. A thread that is stopping, a host that
      // is reconnecting, or a fresh interaction all clear on their own.
      const fields = {
        deferredMessageId: row.id,
        kind: payload.kind,
        ...runtimeErrorLogFields(deps.config, error),
        threadId,
      };
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
 * before the settle, a thread that was still stopping, a host that was away).
 */
export async function runDeferredThreadMessageSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  for (const threadId of listThreadIdsWithDeferredThreadMessages(deps.db)) {
    await flushDeferredThreadMessages(deps, threadId);
  }
}
