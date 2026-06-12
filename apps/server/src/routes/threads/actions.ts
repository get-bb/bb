import {
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  getEnvironment,
  getQueuedThreadMessage,
  listActiveVisiblePinnedThreadRootsWithPendingInteractionState,
  pinThread,
  reorderPinnedThread,
  reorderQueuedThreadMessage,
  unarchiveThread,
  unpinThread,
  updateThread,
  type ReorderPinnedThreadResult,
  type ReorderQueuedThreadMessageResult,
} from "@bb/db";
import {
  createQueuedMessageRequestSchema,
  reorderPinnedThreadRequestSchema,
  reorderQueuedMessageRequestSchema,
  sendQueuedMessageRequestSchema,
  sendMessageRequestSchema,
  typedRoutes,
  type CreateQueuedMessageRequest,
  type ThreadListResponse,
  type PublicApiSchema,
  type SendMessageRequest,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { Thread, ThreadQueuedMessage } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import {
  cancelPendingEnvironmentCleanup,
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
} from "../../services/environments/environment-cleanup-internal.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { validatePromptAttachmentReferences } from "../../services/projects/attachments.js";
import {
  requestQueuedMessageAutoSendForThread,
  sendQueuedMessage,
} from "../../services/threads/queued-messages.js";
import {
  ensureThreadIsNotAwaitingUserInteraction,
  ensureThreadIsWritable,
  resolveMessageSenderThreadId,
  sendThreadMessage,
} from "../../services/threads/thread-send.js";
import {
  buildExecutionOptions,
  dispatchThreadUnarchiveCommand,
} from "../../services/threads/thread-commands.js";
import { getLastProviderThreadId } from "../../services/threads/thread-events.js";
import { requestThreadStopForCurrentState } from "../../services/threads/thread-lifecycle.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import {
  archiveThreadAndChildren,
  archiveThreadWithLifecycleEffects,
} from "../../services/threads/thread-archive.js";
import {
  requireThreadCommandEnvironment,
  requireThreadHostCommandEnvironment,
} from "../../services/threads/thread-command-environment.js";

function toQueuedMessageOrderResponse(
  result: ReorderQueuedThreadMessageResult,
): ThreadQueuedMessage[] {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return result.queuedMessages.map(toThreadQueuedMessage);
    case "not_found":
      throw new ApiError(404, "invalid_request", "Queued message not found");
    case "claimed":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message is already being sent",
      );
    case "stale_neighbor":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message order changed",
      );
    case "invalid_neighbor_order":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message order is invalid",
      );
  }
}

function buildActivePinnedThreadRootListResponse(
  deps: AppDeps,
): ThreadListResponse {
  return toThreadListEntryResponses(deps, {
    threads: listActiveVisiblePinnedThreadRootsWithPendingInteractionState(
      deps.db,
    ),
  });
}

function assertPinnedThreadOrderResult(
  result: ReorderPinnedThreadResult,
): void {
  switch (result.kind) {
    case "reordered":
    case "unchanged":
      return;
    case "not_found":
      throw new ApiError(404, "thread_not_found", "Thread not found");
    case "not_pinned":
      throw new ApiError(409, "invalid_request", "Thread is not pinned");
    case "stale_neighbor":
      throw new ApiError(409, "invalid_request", "Pinned thread order changed");
    case "invalid_neighbor_order":
      throw new ApiError(
        409,
        "invalid_request",
        "Pinned thread order is invalid",
      );
  }
}

interface CreateQueuedMessageForThreadArgs {
  payload: CreateQueuedMessageRequest;
  thread: Thread;
}

function queuedMessagePayloadFromSendRequest(
  payload: SendMessageRequest,
): CreateQueuedMessageRequest {
  return {
    input: payload.input,
    ...(payload.model !== undefined ? { model: payload.model } : {}),
    ...(payload.serviceTier !== undefined
      ? { serviceTier: payload.serviceTier }
      : {}),
    ...(payload.reasoningLevel !== undefined
      ? { reasoningLevel: payload.reasoningLevel }
      : {}),
    ...(payload.permissionMode !== undefined
      ? { permissionMode: payload.permissionMode }
      : {}),
    ...(payload.executionInputSources !== undefined
      ? { executionInputSources: payload.executionInputSources }
      : {}),
    ...(payload.senderThreadId !== undefined
      ? { senderThreadId: payload.senderThreadId }
      : {}),
  };
}

async function createQueuedMessageForThread(
  deps: AppDeps,
  args: CreateQueuedMessageForThreadArgs,
): Promise<ThreadQueuedMessage> {
  const { payload, thread } = args;
  ensureThreadIsWritable(thread);
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input: payload.input,
    projectId: thread.projectId,
  });
  const execution = await buildExecutionOptions(
    deps,
    payload,
    {
      threadId: thread.id,
    },
    "client/turn/requested",
  );
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: payload.senderThreadId,
    targetThread: thread,
  });
  const queuedMessage = createQueuedThreadMessage(deps.db, deps.hub, {
    threadId: thread.id,
    content: payload.input,
    senderThreadId,
    model: execution.model,
    reasoningLevel: execution.reasoningLevel,
    permissionMode: execution.permissionMode,
    serviceTier: execution.serviceTier,
  });
  if (
    thread.status === "idle" &&
    getLastProviderThreadId(deps, thread.id) !== null
  ) {
    requestQueuedMessageAutoSendForThread(deps, {
      queuedMessageId: queuedMessage.id,
      threadId: thread.id,
    });
  }
  return toThreadQueuedMessage(queuedMessage);
}

export function registerThreadActionRoutes(app: Hono, deps: AppDeps): void {
  const { post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(
    "/threads/:id/send",
    sendMessageRequestSchema,
    async (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      if (payload.mode === "queue-if-active" && thread.status === "active") {
        ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
        await createQueuedMessageForThread(deps, {
          payload: queuedMessagePayloadFromSendRequest(payload),
          thread,
        });
        return context.json({ ok: true });
      }
      const environment = await requireThreadCommandEnvironment(deps, {
        thread,
      });
      await sendThreadMessage(deps, {
        environment,
        payload,
        thread,
        trigger: "user",
      });
      return context.json({ ok: true });
    },
  );

  post(
    "/threads/:id/queued-messages",
    createQueuedMessageRequestSchema,
    async (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      const queuedMessage = await createQueuedMessageForThread(deps, {
        payload,
        thread,
      });
      return context.json(queuedMessage, 201);
    },
  );

  post(
    "/threads/:id/queued-messages/:queuedMessageId/send",
    sendQueuedMessageRequestSchema,
    async (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      ensureThreadIsWritable(thread);
      ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
      const queuedMessage = await sendQueuedMessage(deps, {
        queuedMessageId: context.req.param("queuedMessageId"),
        mode: payload.mode,
        threadId: context.req.param("id"),
      });
      return context.json({ ok: true, queuedMessage });
    },
  );

  patch(
    "/threads/:id/queued-messages/:queuedMessageId/order",
    reorderQueuedMessageRequestSchema,
    (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      ensureThreadIsWritable(thread);
      return context.json(
        toQueuedMessageOrderResponse(
          reorderQueuedThreadMessage({
            db: deps.db,
            notifier: deps.hub,
            threadId: thread.id,
            queuedMessageId: context.req.param("queuedMessageId"),
            previousQueuedMessageId: payload.previousQueuedMessageId,
            nextQueuedMessageId: payload.nextQueuedMessageId,
          }),
        ),
      );
    },
  );

  del("/threads/:id/queued-messages/:queuedMessageId", (context) => {
    const queuedMessage = getQueuedThreadMessage(
      deps.db,
      context.req.param("queuedMessageId"),
    );
    if (!queuedMessage || queuedMessage.threadId !== context.req.param("id")) {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    const deleted = deleteQueuedThreadMessage(
      deps.db,
      deps.hub,
      context.req.param("queuedMessageId"),
    );
    if (!deleted) {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    return context.json({ ok: true });
  });

  post("/threads/:id/stop", async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment =
      thread.environmentId === null
        ? null
        : requireThreadHostCommandEnvironment({
            db: deps.db,
            thread,
          });
    requestThreadStopForCurrentState(deps, thread, environment);
    return context.json({ ok: true });
  });

  post("/threads/:id/pin", (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = pinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post("/threads/:id/unpin", (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = unpinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  patch(
    "/threads/:id/pin-order",
    reorderPinnedThreadRequestSchema,
    (context, payload) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      assertPinnedThreadOrderResult(
        reorderPinnedThread({
          db: deps.db,
          notifier: deps.hub,
          threadId: thread.id,
          previousThreadId: payload.previousThreadId,
          nextThreadId: payload.nextThreadId,
        }),
      );
      return context.json(buildActivePinnedThreadRootListResponse(deps));
    },
  );

  post("/threads/:id/archive", async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (thread.archivedAt !== null) {
      deps.terminalSessions.closeArchivedThreadTerminals({
        threadId: thread.id,
      });
      return context.json({ ok: true });
    }
    const shouldRequestCleanup = wouldCleanupEnvironment(deps, {
      environmentId: thread.environmentId,
      excludeThreadId: thread.id,
    });
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    const archiveResult = archiveThreadWithLifecycleEffects(deps, {
      environment,
      thread,
    });
    if (!archiveResult) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    if (shouldRequestCleanup) {
      requestEnvironmentCleanup(deps, {
        environmentId: thread.environmentId,
      });
      requestEnvironmentCleanupAdvance(deps, {
        environmentId: thread.environmentId,
      });
    }
    return context.json({ ok: true });
  });

  post("/threads/:id/archive-all", (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const archivedThreadIds = archiveThreadAndChildren(deps, {
      parentThread: thread,
    });
    return context.json({
      ok: true,
      archivedThreadIds,
    });
  });

  post("/threads/:id/unarchive", (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const providerThreadId = getLastProviderThreadId(deps, thread.id);
    const cleanupCancellation = cancelPendingEnvironmentCleanup(deps, {
      environmentId: thread.environmentId,
    });
    if (cleanupCancellation === "in_progress") {
      throw new ApiError(
        409,
        "environment_cleanup_in_progress",
        "Environment cleanup is already in progress",
      );
    }
    unarchiveThread(deps.db, deps.hub, thread.id);
    const environment = thread.environmentId
      ? getEnvironment(deps.db, thread.environmentId)
      : null;
    if (providerThreadId && environment) {
      dispatchThreadUnarchiveCommand(deps, {
        environment,
        providerThreadId,
        thread,
      });
    }
    return context.json({ ok: true });
  });

  post("/threads/:id/read", (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: Date.now(),
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post("/threads/:id/unread", (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: null,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });
}
