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

async function deliverDeferredThreadMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DeliverDeferredThreadMessageArgs,
): Promise<boolean> {
  const { payload, row, thread } = args;
  switch (payload.kind) {
    case "send": {
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

function isDeferredThreadMessageRequestInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 400 || error.status === 404)
  );
}

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
        deleteDeferredThreadMessage(deps.db, { id: row.id, threadId });
        deps.logger.warn(
          fields,
          "Dropped deferred thread message: request is no longer valid",
        );
        continue;
      }
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

export async function flushDeferredThreadMessages(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
): Promise<void> {
  await deps.lifecycleDedupers.deferredThreadMessageFlush.run(threadId, () =>
    flushDeferredThreadMessagesNow(deps, threadId),
  );
}

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
