import {
  createQueuedThreadMessage,
  deleteQueuedThreadMessage,
  getEnvironment,
  getQueuedThreadMessage,
  listActiveVisiblePinnedThreadRootsWithPendingInteractionState,
  pinThread,
  reorderPinnedThread,
  reorderQueuedThreadMessage,
  setQueuedThreadMessageGroupBoundary,
  unarchiveThread,
  unpinThread,
  updateQueuedThreadMessage,
  updateThread,
  type ReorderPinnedThreadResult,
  type ReorderQueuedThreadMessageResult,
  type SetQueuedThreadMessageGroupBoundaryResult,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type CreateQueuedMessageRequest,
  type ThreadListResponse,
  type PublicApiSchema,
  type SendMessageRequest,
} from "@bb/server-contract";
import type { Hono } from "hono";
import {
  createStandaloneBuiltinCompactCommandInput,
  type Thread,
  type ThreadQueuedMessage,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
} from "../../services/environments/environment-cleanup-internal.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../../services/environments/lifecycle-outcome.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { parseSafeRelativeRoutePath } from "../relative-route-path.js";
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
import { editThreadMessage } from "../../services/threads/thread-edit-message.js";
import {
  buildExecutionOptions,
  dispatchThreadUnarchiveCommand,
  prepareTurnSubmitCommandPayload,
} from "../../services/threads/thread-commands.js";
import {
  getLastProviderThreadId,
  isManualCompactionActive,
} from "../../services/threads/thread-events.js";
import { stopThreadForCurrentState } from "../../services/threads/thread-lifecycle.js";
import {
  getThreadPromptBannerActivity,
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import {
  archiveThreadAndChildren,
  archiveThreadAndHiddenSourceForks,
} from "../../services/threads/thread-archive.js";
import {
  requireThreadCommandEnvironment,
  requireThreadHostCommandEnvironment,
} from "../../services/threads/thread-command-environment.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../../services/hosts/live-command.js";

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
    case "invalid_sender":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages from different senders cannot be grouped",
      );
    case "invalid_execution_options":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages with different execution options cannot be grouped",
      );
  }
}

async function compactThreadContext(
  deps: AppDeps,
  thread: Thread,
): Promise<void> {
  ensureThreadIsWritable(thread);
  if (!deps.providerRegistry.supportsManualCompaction(thread.providerId)) {
    throw new ApiError(
      409,
      "invalid_request",
      `Provider "${thread.providerId}" does not support manual context compaction`,
    );
  }
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "invalid_request",
      "Context can only be compacted while the thread is idle or errored",
    );
  }

  const environment = await requireThreadCommandEnvironment(deps, { thread });
  await sendThreadMessage(deps, {
    environment,
    payload: {
      input: createStandaloneBuiltinCompactCommandInput(),
      mode: "start",
    },
    thread,
    trigger: "user",
  });
}

function toQueuedMessageGroupBoundaryResponse(
  result: SetQueuedThreadMessageGroupBoundaryResult,
): ThreadQueuedMessage[] {
  switch (result.kind) {
    case "updated":
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
    case "invalid_sender":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages from different senders cannot be grouped",
      );
    case "invalid_execution_options":
      throw new ApiError(
        409,
        "invalid_request",
        "Queued messages with different execution options cannot be grouped",
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
  if (senderThreadId === null && payload.input.length > 0) {
    deps.telemetry.capture({
      name: "user_message_sent",
      properties: {
        is_child_thread: thread.parentThreadId !== null,
        message_source: "queued_message",
        provider: thread.providerId,
      },
    });
  }
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
  const routes = publicApiRoutes.threads;

  post(routes.send, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const shouldQueue =
      thread.status === "active" &&
      (payload.mode === "queue-if-active" ||
        (payload.mode !== "start" && isManualCompactionActive(deps, thread)));
    if (shouldQueue) {
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
  });

  post(routes.editMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment = await requireThreadCommandEnvironment(deps, {
      thread,
    });
    const result = await editThreadMessage(deps, {
      environment,
      payload,
      thread,
    });
    return context.json(result);
  });

  post(routes.createQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const queuedMessage = await createQueuedMessageForThread(deps, {
      payload,
      thread,
    });
    return context.json(queuedMessage, 201);
  });

  post(routes.sendQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
    const queuedMessage = await sendQueuedMessage(deps, {
      queuedMessageId: context.req.param("queuedMessageId"),
      mode: payload.mode,
      threadId: context.req.param("id"),
    });
    return context.json({ ok: true, queuedMessage });
  });

  patch(routes.reorderQueuedMessage, (context, payload) => {
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
          groupBoundaryQueuedMessageId: payload.groupBoundaryQueuedMessageId,
        }),
      ),
    );
  });

  patch(routes.setQueuedMessageGroupBoundary, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    return context.json(
      toQueuedMessageGroupBoundaryResponse(
        setQueuedThreadMessageGroupBoundary({
          db: deps.db,
          notifier: deps.hub,
          threadId: thread.id,
          expectedGroupedPrefixQueuedMessageIds:
            payload.expectedGroupedPrefixQueuedMessageIds,
          groupBoundaryQueuedMessageId: payload.groupBoundaryQueuedMessageId,
        }),
      ),
    );
  });

  patch(routes.updateQueuedMessage, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    ensureThreadIsWritable(thread);
    await validatePromptAttachmentReferences({
      dataDir: deps.config.dataDir,
      input: payload.input,
      projectId: thread.projectId,
    });
    const result = updateQueuedThreadMessage(deps.db, deps.hub, {
      content: payload.input,
      expectedUpdatedAt: payload.expectedUpdatedAt,
      id: context.req.param("queuedMessageId"),
      threadId: thread.id,
    });
    if (result.kind === "not_found") {
      throw new ApiError(404, "invalid_request", "Queued message not found");
    }
    if (result.kind === "claimed") {
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message is already being sent",
      );
    }
    if (result.kind === "stale") {
      throw new ApiError(
        409,
        "invalid_request",
        "Queued message changed since editing began",
      );
    }
    return context.json(toThreadQueuedMessage(result.queuedMessage));
  });

  del(routes.deleteQueuedMessage, (context) => {
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

  post(routes.stop, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const environment =
      thread.environmentId === null
        ? null
        : requireThreadHostCommandEnvironment({
            db: deps.db,
            thread,
          });
    await stopThreadForCurrentState(deps, thread, environment);
    return context.json({ ok: true });
  });

  post(routes.compact, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    await compactThreadContext(deps, thread);
    return context.json({ ok: true });
  });

  post(routes.cancelPlan, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const activity = getThreadPromptBannerActivity(deps, thread);
    if (activity.activePlanModeCount === 0) {
      throw new ApiError(409, "invalid_request", "Plan mode is not active");
    }
    if (activity.activePlanTurnId === null) {
      throw new ApiError(
        409,
        "invalid_request",
        "The active Plan turn could not be identified",
      );
    }
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    await runLiveHostCommand(deps, {
      command: {
        type: "thread.plan.cancel",
        environmentId: environment.id,
        threadId: thread.id,
        expectedTurnId: activity.activePlanTurnId,
      },
      hostId: environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    });
    const updatedThread = requirePublicThread(deps.db, thread.id);
    if (
      getThreadPromptBannerActivity(deps, updatedThread).activePlanModeCount > 0
    ) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not confirm that Plan mode exited",
      );
    }
    return context.json({ ok: true });
  });

  post(routes.clearGoal, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (thread.providerId !== "codex") {
      throw new ApiError(
        409,
        "invalid_request",
        "This provider does not support active Goals",
      );
    }
    const activity = getThreadPromptBannerActivity(deps, thread);
    if (activity.activeGoalCount === 0) {
      throw new ApiError(409, "invalid_request", "No active Goal to clear");
    }
    const environment = await requireThreadCommandEnvironment(deps, {
      thread,
    });
    const execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
      "client/turn/requested",
    );
    const preparedRuntimeCommand = await prepareTurnSubmitCommandPayload(deps, {
      environment,
      execution,
      input: [],
      permissionEscalation: "deny",
      target: { mode: "auto", expectedTurnId: null },
      thread,
    });
    const result = await runLiveHostCommand(deps, {
      command: {
        type: "thread.goal.clear",
        environmentId: environment.id,
        threadId: thread.id,
        options: preparedRuntimeCommand.options,
        resumeContext: preparedRuntimeCommand.resumeContext,
        ...(preparedRuntimeCommand.acpLaunchSpec !== undefined
          ? { acpLaunchSpec: preparedRuntimeCommand.acpLaunchSpec }
          : {}),
        bridgeLaunch: preparedRuntimeCommand.bridgeLaunch,
      },
      hostId: environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    });
    const updatedThread = requirePublicThread(deps.db, thread.id);
    const updatedActivity = getThreadPromptBannerActivity(deps, updatedThread);
    if (updatedActivity.activeGoalCount > 0 && !result.cleared) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not clear the active Goal",
      );
    }
    if (updatedActivity.activeGoalCount > 0) {
      throw new ApiError(
        409,
        "invalid_request",
        "The provider did not confirm that the active Goal was cleared",
      );
    }
    return context.json({ ok: true });
  });

  post(routes.open, (context, payload) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    if (payload.file !== null) {
      parseSafeRelativeRoutePath(payload.file.path);
    }
    const delivered = deps.hub.notifyThreadOpen(
      { projectId: publicThread.projectId, threadId: publicThread.id },
      { split: payload.split ?? "replace", file: payload.file },
    );
    return context.json({ delivered });
  });

  post(routes.paneAction, (context, payload) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const delivered = deps.hub.notifyThreadPaneAction(
      { projectId: publicThread.projectId, threadId: publicThread.id },
      payload.action,
    );
    return context.json({ delivered });
  });

  post(routes.pin, (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = pinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post(routes.unpin, (context) => {
    const publicThread = requirePublicThread(deps.db, context.req.param("id"));
    const thread = unpinThread(deps.db, deps.hub, {
      threadId: publicThread.id,
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  patch(routes.pinOrder, (context, payload) => {
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
  });

  post(routes.archive, async (context) => {
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
    const archiveResult = archiveThreadAndHiddenSourceForks(deps, {
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

  post(routes.archiveAll, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const archivedThreadIds = archiveThreadAndChildren(deps, {
      parentThread: thread,
    });
    return context.json({
      ok: true,
      archivedThreadIds,
    });
  });

  // Un-archive clears archivedAt. When the thread's managed environment is still
  // inside its archive grace window (`retiring`), un-archiving revives it via the
  // existing `retire.cancelled` event so the intact worktree is restored — the
  // lossless undo of an accidental archive. If the grace window already elapsed
  // and the environment was destroyed, `retire.cancelled` is a no-op (illegal
  // from destroying/destroyed) and the thread remains read-only. The user can
  // hand its context and surviving branch off to a new thread instead.
  post(routes.unarchive, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const providerThreadId = getLastProviderThreadId(deps, thread.id);
    unarchiveThread(deps.db, deps.hub, thread.id);
    const environment = thread.environmentId
      ? getEnvironment(deps.db, thread.environmentId)
      : null;
    if (environment?.status === "retiring") {
      applyLoggedEnvironmentLifecycleEvent(deps, {
        environmentId: environment.id,
        event: { type: "retire.cancelled" },
      });
    }
    if (providerThreadId && environment) {
      dispatchThreadUnarchiveCommand(deps, {
        environment,
        providerThreadId,
        thread,
      });
    }
    return context.json({ ok: true });
  });

  post(routes.read, (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    const thread = updateThread(deps.db, deps.hub, context.req.param("id"), {
      lastReadAt: Date.now(),
    });
    if (!thread) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return context.json(toThreadResponseFromThread(deps, { thread }));
  });

  post(routes.unread, (context) => {
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
