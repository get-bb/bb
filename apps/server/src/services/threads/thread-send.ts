import {
  getEnvironment,
  getThread,
  requireThreadLifecycleEventApplied,
} from "@bb/db";
import type { DbConnection, DbTransaction } from "@bb/db";
import type {
  ClientTurnRequestId,
  Environment,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
  TurnRequestTarget,
} from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
} from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  type AppendedClientTurnRequestWithNotification,
  createClientTurnRequestId,
  getActiveTurnId,
} from "./thread-events.js";
import {
  ensureThreadCanStartRequest,
  prepareReadyThreadTurnCommand,
  prepareReadyThreadTurnDispatchInTransaction,
} from "./thread-lifecycle.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import {
  dispatchTurnDuringReprovision,
  requireReadyThreadEnvironment,
} from "./thread-turn-dispatch.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { resolveThreadRuntimeState } from "./thread-runtime-display.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import {
  disconnectedHostUnavailableDetails,
  threadNotWritableReasonForStatus,
  throwHostUnavailable,
  throwSenderThreadInvalid,
  throwThreadNotWritable,
} from "../lib/lifecycle-api-errors.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { resolvePluginMentionContextInputs } from "../plugins/plugin-mentions.js";

type SendThreadMessageMode = SendMessageRequest["mode"];
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
export type SendThreadMessageTrigger = "auto-dispatch" | "user";

type SendThreadMessagePayload = SendMessageRequest & {
  inputGroups?: PromptInput[][];
};

export interface SendThreadMessageArgs {
  beforeAppendInTransaction?: SendThreadMessageTransactionPreflight;
  environment: Environment;
  payload: SendThreadMessagePayload;
  thread: Thread;
  trigger: SendThreadMessageTrigger;
}

export interface ResolveMessageSenderArgs {
  senderThreadId?: string;
  targetThread: Thread;
}

export interface FormatAgentThreadInputArgs {
  input: PromptInput[];
  senderThreadId: string;
}

interface BuildAgentThreadMessageTextArgs {
  messageText: string;
  senderThreadId: string;
}

export interface SendThreadMessageTransactionPreflightArgs {
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestArgs {
  requestEventSequence: number;
  tx: DbTransaction;
}

interface SendThreadMessageQueueRequestResult {
  threadBecameActive: boolean;
}

export interface SendThreadMessageTransactionPreflight {
  (args: SendThreadMessageTransactionPreflightArgs): void;
}

interface SendThreadMessageQueueRequest {
  (
    args: SendThreadMessageQueueRequestArgs,
  ): SendThreadMessageQueueRequestResult;
}

interface AppendAndQueueSendThreadMessageArgs {
  beforeAppendInTransaction?: SendThreadMessageTransactionPreflight;
  db: DbConnection;
  environmentId: string | null;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  queueInTransaction: SendThreadMessageQueueRequest;
  requestId: ClientTurnRequestId;
  senderThreadId: string | null;
  target: TurnRequestTarget;
  thread: Thread;
}

interface AppendAndQueueSendThreadMessageResult {
  request: AppendedClientTurnRequestWithNotification;
  threadBecameActive: boolean;
}

export function ensureThreadIsNotAwaitingUserInteraction(
  deps: Pick<AppDeps, "pendingInteractions">,
  threadId: string,
): void {
  if (!deps.pendingInteractions.hasPendingThreadInteraction(threadId)) {
    return;
  }

  throw new ApiError(
    409,
    "awaiting_user_interaction",
    "Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.",
  );
}

export function ensureThreadIsWritable(thread: Thread): void {
  if (thread.archivedAt) {
    throwThreadNotWritable(thread, "archived", "Thread is archived");
  }
  if (thread.status === "stopping") {
    throwThreadNotWritable(thread, "stopping", "Thread is stopping");
  }
  if (thread.deletedAt !== null) {
    throwThreadNotWritable(thread, "deleted", "Thread is deleted");
  }
}

function resolveSendMode(
  thread: Thread,
  requestedMode: SendThreadMessageMode,
): "start" | "auto" | "steer" {
  if (requestedMode === "start") {
    if (thread.status === "active") {
      throwThreadNotWritable(
        thread,
        "already_active",
        "Thread is already active",
      );
    }
    return "start";
  }
  if (requestedMode === "steer" || requestedMode === "steer-if-active") {
    if (thread.status === "active") {
      return "steer";
    }
    if (thread.status === "idle") {
      return "start";
    }
    throwThreadNotWritable(
      thread,
      threadNotWritableReasonForStatus(thread.status),
      "Thread is not active",
    );
  }
  if (requestedMode === "queue-if-active") {
    if (thread.status === "active") {
      throwThreadNotWritable(
        thread,
        "already_active",
        "Thread is already active",
      );
    }
    return "start";
  }
  if (thread.status === "active") {
    return "auto";
  }
  return "start";
}

function ensureRuntimeCanAcceptActiveSend(
  deps: Pick<AppDeps, "db" | "hub">,
  args: Pick<SendThreadMessageArgs, "environment" | "thread">,
): void {
  if (args.thread.status !== "active") {
    return;
  }

  const runtime = resolveThreadRuntimeState(deps, {
    environmentHostId: args.environment.hostId,
    status: args.thread.status,
  });
  if (runtime.displayStatus === "active") {
    return;
  }

  throwHostUnavailable(
    502,
    "Host daemon is not connected",
    disconnectedHostUnavailableDetails(),
  );
}

export function resolveMessageSenderThreadId(
  deps: Pick<AppDeps, "db">,
  args: ResolveMessageSenderArgs,
): string | null {
  if (!args.senderThreadId || args.senderThreadId === args.targetThread.id) {
    return null;
  }

  const senderThread = getThread(deps.db, args.senderThreadId);
  if (!senderThread) {
    throwSenderThreadInvalid("not_found");
  }
  if (senderThread.deletedAt !== null) {
    throwSenderThreadInvalid("deleted");
  }
  // Sender attribution is allowed across projects: the cross-thread message
  // template tells the receiving agent to reply via
  // `bb thread tell {{senderThreadId}}`, which is how coordinator/worker
  // threads in different projects message each other. Existence and not-deleted
  // are still required so the reply target is a live thread.

  return senderThread.id;
}

function buildAgentThreadMessageText(
  args: BuildAgentThreadMessageTextArgs,
): string {
  return renderTemplate("agentThreadMessage", {
    messageText: args.messageText,
    senderThreadId: args.senderThreadId,
  });
}

export function formatAgentThreadInput(
  args: FormatAgentThreadInputArgs,
): PromptInput[] {
  const firstTextIndex = args.input.findIndex((item) => item.type === "text");
  if (firstTextIndex === -1) {
    const textItem: TextPromptInput = {
      type: "text",
      text: buildAgentThreadMessageText({
        messageText: "",
        senderThreadId: args.senderThreadId,
      }),
      mentions: [],
    };
    return [textItem, ...args.input];
  }

  return args.input.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") {
      return item;
    }
    return {
      ...item,
      text: buildAgentThreadMessageText({
        messageText: item.text,
        senderThreadId: args.senderThreadId,
      }),
    };
  });
}

function groupedInputForRuntime(
  inputGroups: readonly PromptInput[][],
): PromptInput[] {
  return inputGroups.flatMap((input, index) =>
    index === 0
      ? input
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...input],
  );
}

function captureUserMessageSentTelemetry(
  deps: Pick<LoggedPendingInteractionWorkSessionDeps, "telemetry">,
  thread: Thread,
): void {
  deps.telemetry.capture({
    name: "user_message_sent",
    properties: {
      is_child_thread: thread.parentThreadId !== null,
      message_source: "thread_send",
      provider: thread.providerId,
    },
  });
}

function appendAndQueueSendThreadMessageInTransaction({
  beforeAppendInTransaction,
  db,
  environmentId,
  execution,
  initiator,
  input,
  inputGroups,
  queueInTransaction,
  requestId,
  senderThreadId,
  target,
  thread,
}: AppendAndQueueSendThreadMessageArgs): AppendAndQueueSendThreadMessageResult {
  let threadBecameActive = false;
  const request = db.transaction(
    (tx) => {
      beforeAppendInTransaction?.({ tx });
      const appended =
        appendPreparedClientTurnRequestedEventWithNotificationInTransaction(
          tx,
          {
            threadId: thread.id,
            environmentId,
            type: "client/turn/requested",
            input,
            ...(inputGroups !== undefined ? { inputGroups } : {}),
            execution,
            initiator,
            senderThreadId,
            requestMethod: "turn/start",
            source: "tell",
            target,
            requestId,
          },
        );
      recordAcceptedPromptHistoryEntry(
        { db: tx },
        {
          thread,
          input,
          initiator,
          target,
          requestSequence: appended.sequence,
        },
      );
      const queueResult = queueInTransaction({
        requestEventSequence: appended.sequence,
        tx,
      });
      threadBecameActive = queueResult.threadBecameActive;
      return appended;
    },
    { behavior: "immediate" },
  );
  return {
    request,
    threadBecameActive,
  };
}

export async function sendThreadMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendThreadMessageArgs,
): Promise<void> {
  const { environment, payload, thread } = args;
  ensureThreadIsWritable(thread);
  if (args.trigger === "user") {
    ensureThreadIsNotAwaitingUserInteraction(deps, thread.id);
  }
  const mode = resolveSendMode(thread, payload.mode);
  ensureRuntimeCanAcceptActiveSend(deps, args);
  if (mode === "start") {
    ensureThreadCanStartRequest(thread);
  }
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: payload.senderThreadId,
    targetThread: thread,
  });
  let inputGroups = payload.inputGroups
    ? payload.inputGroups.map((inputGroup) =>
        senderThreadId
          ? formatAgentThreadInput({
              input: inputGroup,
              senderThreadId,
            })
          : inputGroup,
      )
    : undefined;
  let input =
    inputGroups !== undefined
      ? groupedInputForRuntime(inputGroups)
      : senderThreadId
        ? formatAgentThreadInput({
            input: payload.input,
            senderThreadId,
          })
        : payload.input;
  // Plugin mentions resolve once at send time (plugin design §4.9): each
  // unique mention becomes an agent-only context input appended after the
  // user's message; a resolve failure throws a 422 before anything is
  // persisted or dispatched.
  const pluginMentionContext = await resolvePluginMentionContextInputs(input);
  if (pluginMentionContext.length > 0) {
    input = [...input, ...pluginMentionContext];
    if (inputGroups !== undefined && inputGroups.length > 0) {
      // Keep the grouped view aligned with the flat runtime input: the
      // context rides the final group so a grouped send carries it too.
      const lastGroup = inputGroups[inputGroups.length - 1]!;
      inputGroups = [
        ...inputGroups.slice(0, -1),
        [...lastGroup, ...pluginMentionContext],
      ];
    }
  }
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input,
    projectId: thread.projectId,
  });
  // Agent-originated CLI sends still appear as normal turn requests in the
  // timeline, while initiator lets policy distinguish the source.
  const initiator: ThreadTurnInitiator = senderThreadId ? "agent" : "user";
  const shouldCaptureUserMessageSent =
    args.trigger === "user" && initiator === "user" && input.length > 0;
  const expectedSteerTurnId =
    mode === "auto" || mode === "steer"
      ? getActiveTurnId(deps, thread.id)
      : null;
  const execution = await buildExecutionOptions(
    deps,
    payload,
    {
      threadId: thread.id,
    },
    "client/turn/requested",
  );
  const permissionEscalation = resolvePermissionEscalation({
    thread,
    initiator,
  });

  if (
    await dispatchTurnDuringReprovision({
      beforeRequestAppendInTransaction: args.beforeAppendInTransaction,
      deps,
      environment,
      execution,
      initiator,
      input,
      inputGroups,
      senderThreadId,
      thread,
    })
  ) {
    if (shouldCaptureUserMessageSent) {
      captureUserMessageSentTelemetry(deps, thread);
    }
    return;
  }
  const readyEnvironment = requireReadyThreadEnvironment(
    getEnvironment(deps.db, environment.id) ?? environment,
  );
  let target: TurnRequestTarget;
  if (mode === "start") {
    target = { kind: "new-turn" };
  } else {
    target = {
      kind: mode,
      expectedTurnId: expectedSteerTurnId,
    };
  }

  const requestId = createClientTurnRequestId();

  if (mode === "start") {
    const command = await prepareReadyThreadTurnCommand(deps, {
      thread,
      // A send/steer always targets an already-started thread; forking only
      // happens at create time.
      fork: null,
      input,
      ...(inputGroups !== undefined ? { inputGroups } : {}),
      requestId,
      execution,
      permissionEscalation,
      environment: {
        id: readyEnvironment.id,
        hostId: readyEnvironment.hostId,
        path: readyEnvironment.path,
        status: readyEnvironment.status,
        workspaceProvisionType: readyEnvironment.workspaceProvisionType,
      },
      projectId: thread.projectId,
      providerId: thread.providerId,
      syncGeneratedTitle: false,
    });
    const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
      beforeAppendInTransaction: ({ tx }) => {
        args.beforeAppendInTransaction?.({ tx });
        ensureThreadCanStartRequest(thread);
      },
      db: deps.db,
      environmentId: thread.environmentId,
      execution,
      initiator,
      input,
      inputGroups,
      queueInTransaction: ({ tx }) => {
        const dispatchKind = prepareReadyThreadTurnDispatchInTransaction(tx, {
          command,
          thread,
        });
        const currentThread = getThread(tx, thread.id);
        // Dispatching a turn IS the thread becoming active. A warm
        // `turn.submit` and a cold `thread.start` are the same event from the
        // thread's view, so an `idle` cold-start activates exactly like an
        // `error` cold-start — a failed start walks either back through
        // `run.failed`. (Other statuses fall through unchanged: pre-start
        // threads are already rejected by `ensureThreadCanStartRequest`, and a
        // `stopping`/superseded thread must not be reactivated here.)
        if (
          dispatchKind === "turn.submit" ||
          currentThread?.status === "error" ||
          currentThread?.status === "idle"
        ) {
          requireThreadLifecycleEventApplied(
            applyLoggedThreadLifecycleEventInTransaction(
              { db: tx, logger: deps.logger },
              { event: { type: "run.started" }, threadId: thread.id },
            ),
          );
          return { threadBecameActive: true };
        }
        return { threadBecameActive: false };
      },
      requestId,
      senderThreadId,
      target,
      thread,
    });
    deps.hub.notifyThread(
      thread.id,
      queuedRequest.request.notificationChanges,
      queuedRequest.request.notificationMetadata,
    );
    startLiveHostCommand(deps, {
      command: command.command,
      hostId: readyEnvironment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      onError: ({ error }) => {
        deps.logger.warn(
          { err: error, threadId: thread.id },
          "Live ready turn command failed",
        );
      },
    });
    if (queuedRequest.threadBecameActive) {
      deps.hub.notifyThread(thread.id, ["status-changed"], {
        projectId: thread.projectId,
      });
    }
    if (shouldCaptureUserMessageSent) {
      captureUserMessageSentTelemetry(deps, thread);
    }
    return;
  }

  await ensureHostSessionReadyForWork(deps, {
    hostId: readyEnvironment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    thread,
    input,
    ...(inputGroups !== undefined ? { inputGroups } : {}),
    execution,
    permissionEscalation,
    target: {
      mode,
      expectedTurnId: expectedSteerTurnId,
    },
    environment: {
      id: readyEnvironment.id,
      hostId: readyEnvironment.hostId,
      path: readyEnvironment.path,
      status: readyEnvironment.status,
      workspaceProvisionType: readyEnvironment.workspaceProvisionType,
    },
  });
  const command = addRequestIdToTurnSubmitCommandPayload({
    preparedCommand,
    requestId,
  });
  const queuedRequest = appendAndQueueSendThreadMessageInTransaction({
    beforeAppendInTransaction: args.beforeAppendInTransaction,
    db: deps.db,
    environmentId: thread.environmentId,
    execution,
    initiator,
    input,
    inputGroups,
    queueInTransaction: () => {
      return { threadBecameActive: false };
    },
    requestId,
    senderThreadId,
    target,
    thread,
  });
  deps.hub.notifyThread(
    thread.id,
    queuedRequest.request.notificationChanges,
    queuedRequest.request.notificationMetadata,
  );
  startLiveHostCommand(deps, {
    command,
    hostId: readyEnvironment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: thread.id },
        "Live turn submit command failed",
      );
    },
  });
  if (shouldCaptureUserMessageSent) {
    captureUserMessageSentTelemetry(deps, thread);
  }
}
