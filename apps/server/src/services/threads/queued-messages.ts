import {
  claimQueuedThreadMessageGroup,
  claimNextQueuedThreadMessageGroup,
  deleteClaimedQueuedThreadMessageBatchInTransaction,
  getQueuedThreadMessage,
  getEnvironment,
  getThread,
  listIdleThreadsWithQueuedMessages,
  releaseQueuedMessageClaim,
  releaseStaleQueuedMessageClaims,
} from "@bb/db";
import type {
  PromptInput,
  Thread,
  ThreadQueuedMessage,
  ThreadTurnInitiator,
} from "@bb/domain";
import type {
  SendMessageRequest,
  SendQueuedMessageMode,
} from "@bb/server-contract";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { ApiError } from "../../errors.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import {
  isCommandTimeoutError,
  runtimeErrorLogFields,
} from "../lib/error-log-fields.js";
import { toThreadQueuedMessage } from "./thread-queued-messages.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
} from "./thread-commands.js";
import { appendClientTurnEventInTransaction } from "./thread-events.js";
import { getLastProviderThreadId } from "./thread-events.js";
import { ensureThreadCanStartRequest } from "./thread-lifecycle.js";
import { requireReadyThreadEnvironment } from "./thread-turn-dispatch.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { formatAgentThreadInput, sendThreadMessage } from "./thread-send.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import { applyLoggedEnvironmentLifecycleEvent } from "../environments/lifecycle-outcome.js";

interface SendQueuedMessageArgs {
  mode: SendQueuedMessageMode;
  queuedMessageId: string;
  threadId: string;
}

type ClaimedQueuedMessage = Exclude<
  ReturnType<typeof claimQueuedThreadMessageGroup>,
  null
>[number];

interface SendClaimedQueuedMessageArgs {
  mode: SendQueuedMessageMode;
  queuedMessages: ClaimedQueuedMessage[];
  threadId: string;
}

interface SendClaimedQueuedMessageForThreadArgs {
  mode: SendQueuedMessageMode;
  queuedMessages: ClaimedQueuedMessage[];
  thread: QueuedMessageThread;
}

interface QueuedMessageThread extends Thread {}

interface QueuedMessageAutoSendArgs {
  threadId: string;
}

async function requireReadyQueuedMessageEnvironment(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Thread,
) {
  const environment = await requireThreadCommandEnvironment(deps, { thread });
  if (environment.status === "retiring") {
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: environment.id,
      event: { type: "retire.cancelled" },
    });
  }
  return requireReadyThreadEnvironment(
    getEnvironment(deps.db, environment.id) ?? environment,
  );
}

interface QueuedMessageAutoSendRequestArgs {
  queuedMessageId: string;
  threadId: string;
}

interface FormatQueuedMessageInputForSenderArgs {
  input: PromptInput[];
  senderThreadId: string | null;
}

const STALE_QUEUED_MESSAGE_CLAIM_MS = 5 * 60 * 1000;
const QUEUED_MESSAGE_CLAIM_LOST_CODE = "queued_message_claim_lost";
const activeQueuedMessageClaimTokens = new Set<string>();

function sendQueuedMessagePayload(
  queuedMessage: ThreadQueuedMessage,
  mode: SendQueuedMessageMode,
  senderThreadId: string | null,
): SendMessageRequest {
  return {
    input: queuedMessage.content,
    mode,
    model: queuedMessage.model,
    permissionMode: queuedMessage.permissionMode,
    reasoningLevel: queuedMessage.reasoningLevel,
    serviceTier: queuedMessage.serviceTier,
    ...(senderThreadId !== null ? { senderThreadId } : {}),
  };
}

function formatQueuedMessageInputForSender(
  args: FormatQueuedMessageInputForSenderArgs,
): PromptInput[] {
  if (args.senderThreadId === null) {
    return args.input;
  }
  return formatAgentThreadInput({
    input: args.input,
    senderThreadId: args.senderThreadId,
  });
}

function queuedMessagesToThreadQueuedMessages(
  queuedMessages: readonly ClaimedQueuedMessage[],
): ThreadQueuedMessage[] {
  return queuedMessages.map(toThreadQueuedMessage);
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

function releaseQueuedMessageClaims(
  deps: Pick<AppDeps, "db" | "hub">,
  queuedMessages: readonly ClaimedQueuedMessage[],
): void {
  for (const queuedMessage of queuedMessages) {
    releaseQueuedMessageClaim(deps.db, deps.hub, {
      id: queuedMessage.id,
      claimToken: queuedMessage.claimToken,
    });
  }
}

async function withActiveQueuedMessageClaims<T>(
  queuedMessages: readonly ClaimedQueuedMessage[],
  task: () => Promise<T>,
): Promise<T> {
  for (const queuedMessage of queuedMessages) {
    activeQueuedMessageClaimTokens.add(queuedMessage.claimToken);
  }
  try {
    return await task();
  } finally {
    for (const queuedMessage of queuedMessages) {
      activeQueuedMessageClaimTokens.delete(queuedMessage.claimToken);
    }
  }
}

function claimQueuedThreadMessageForSend(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SendQueuedMessageArgs,
): ClaimedQueuedMessage[] {
  const existingQueuedMessage = getQueuedThreadMessage(
    deps.db,
    args.queuedMessageId,
  );
  if (
    !existingQueuedMessage ||
    existingQueuedMessage.threadId !== args.threadId
  ) {
    throw new ApiError(404, "invalid_request", "Queued message not found");
  }

  const claimedQueuedMessages = claimQueuedThreadMessageGroup(
    deps.db,
    deps.hub,
    args.queuedMessageId,
  );
  if (claimedQueuedMessages) {
    return claimedQueuedMessages;
  }

  const latestQueuedMessage = getQueuedThreadMessage(
    deps.db,
    args.queuedMessageId,
  );
  if (!latestQueuedMessage || latestQueuedMessage.threadId !== args.threadId) {
    throw new ApiError(404, "invalid_request", "Queued message not found");
  }
  throw new ApiError(
    409,
    "invalid_request",
    "Queued message is already being sent",
  );
}

function createQueuedMessageClaimLostError(): ApiError {
  return new ApiError(
    409,
    QUEUED_MESSAGE_CLAIM_LOST_CODE,
    "Queued message claim expired before it could be sent",
  );
}

function isQueuedMessageClaimLostError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.body.code === QUEUED_MESSAGE_CLAIM_LOST_CODE
  );
}

async function sendClaimedQueuedMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendClaimedQueuedMessageArgs,
): Promise<ThreadQueuedMessage> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  return sendClaimedQueuedMessageForThread(deps, {
    mode: args.mode,
    queuedMessages: args.queuedMessages,
    thread,
  });
}

async function sendClaimedQueuedMessageForIdleProviderThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendClaimedQueuedMessageForThreadArgs,
): Promise<ThreadQueuedMessage | null> {
  if (args.mode !== "auto") {
    return null;
  }

  const thread = args.thread;
  if (thread.status !== "idle") {
    return null;
  }
  const providerThreadId = getLastProviderThreadId(deps, thread.id);
  if (!providerThreadId) {
    return null;
  }

  const environment = await requireReadyQueuedMessageEnvironment(deps, thread);
  const queuedMessages = queuedMessagesToThreadQueuedMessages(
    args.queuedMessages,
  );
  const queuedMessage = queuedMessages[0]!;
  ensureThreadCanStartRequest(thread);

  const senderThreadId = args.queuedMessages[0]!.senderThreadId;
  const inputGroups = args.queuedMessages.map((claimedQueuedMessage) =>
    formatQueuedMessageInputForSender({
      input: toThreadQueuedMessage(claimedQueuedMessage).content,
      senderThreadId: claimedQueuedMessage.senderThreadId,
    }),
  );
  const input = groupedInputForRuntime(inputGroups);
  const payload = sendQueuedMessagePayload(
    { ...queuedMessage, content: input },
    args.mode,
    senderThreadId,
  );
  const initiator: ThreadTurnInitiator =
    senderThreadId === null ? "user" : "agent";
  const execution = await buildExecutionOptions(
    deps,
    payload,
    { threadId: thread.id },
    "client/turn/requested",
  );
  const permissionEscalation = resolvePermissionEscalation({
    initiator,
    thread,
  });
  await ensureHostSessionReadyForWork(deps, {
    hostId: environment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    environment,
    execution,
    input,
    ...(inputGroups.length > 1 ? { inputGroups } : {}),
    permissionEscalation,
    providerThreadId,
    target: { mode: "start" },
    thread,
  });

  const command = deps.db.transaction(
    (tx) => {
      const consumed = deleteClaimedQueuedThreadMessageBatchInTransaction(tx, {
        queuedMessages: args.queuedMessages,
      });
      if (!consumed) {
        throw createQueuedMessageClaimLostError();
      }
      const request = appendClientTurnEventInTransaction(tx, {
        environmentId: thread.environmentId,
        execution,
        initiator,
        input,
        ...(inputGroups.length > 1 ? { inputGroups } : {}),
        requestMethod: "turn/start",
        senderThreadId,
        source: "tell",
        target: { kind: "new-turn" },
        threadId: thread.id,
        type: "client/turn/requested",
      });
      recordAcceptedPromptHistoryEntry(
        { db: tx },
        {
          thread,
          input,
          initiator,
          target: { kind: "new-turn" },
          requestSequence: request.sequence,
        },
      );
      const command = addRequestIdToTurnSubmitCommandPayload({
        requestId: request.requestId,
        preparedCommand,
      });
      const outcome = applyLoggedThreadLifecycleEventInTransaction(
        { db: tx, logger: deps.logger },
        { event: { type: "run.started" }, threadId: thread.id },
      );
      if (!outcome.applied) {
        // The thread was deleted, archived, or began stopping in the race
        // window between the auto-send entry guard and this dispatch:
        // run.started is superseded by its notDeleted/notArchived
        // predicate (and is structurally absent from `stopping`). Roll back
        // the claim consumption and the queued client/turn/requested append
        // so the message stays queued and no host command is sent — the entry
        // guard skips the thread on the next sweep tick.
        throw createQueuedMessageClaimLostError();
      }
      deps.hub.notifyThread(thread.id, ["status-changed"]);
      return command;
    },
    { behavior: "immediate" },
  );
  if (!command) {
    throw createQueuedMessageClaimLostError();
  }

  deps.hub.notifyThread(
    thread.id,
    ["events-appended", "queue-changed", "status-changed"],
    {
      eventTypes: ["client/turn/requested"],
    },
  );
  startLiveHostCommand(deps, {
    command,
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: thread.id },
        "Live queued message command failed",
      );
    },
  });
  return queuedMessage;
}

async function sendClaimedQueuedMessageForThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendClaimedQueuedMessageForThreadArgs,
): Promise<ThreadQueuedMessage> {
  const sent = await sendClaimedQueuedMessageForIdleProviderThread(deps, args);
  if (sent) {
    return sent;
  }

  const queuedMessages = queuedMessagesToThreadQueuedMessages(
    args.queuedMessages,
  );
  const queuedMessage = queuedMessages[0]!;
  const inputGroups = queuedMessages.map(
    (queuedMessage) => queuedMessage.content,
  );
  const input = groupedInputForRuntime(inputGroups);
  const environment = await requireThreadCommandEnvironment(deps, {
    thread: args.thread,
  });
  await sendThreadMessage(deps, {
    beforeAppendInTransaction: ({ tx }) => {
      const consumed = deleteClaimedQueuedThreadMessageBatchInTransaction(tx, {
        queuedMessages: args.queuedMessages,
      });
      if (!consumed) {
        throw createQueuedMessageClaimLostError();
      }
    },
    environment,
    payload: {
      ...sendQueuedMessagePayload(
        { ...queuedMessage, content: input },
        args.mode,
        args.queuedMessages[0]!.senderThreadId,
      ),
      ...(inputGroups.length > 1 ? { inputGroups } : {}),
    },
    thread: args.thread,
    trigger: "auto-dispatch",
  });
  return queuedMessage;
}

export async function sendQueuedMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: SendQueuedMessageArgs,
): Promise<ThreadQueuedMessage> {
  const queuedMessages = claimQueuedThreadMessageForSend(deps, args);
  try {
    return await withActiveQueuedMessageClaims(queuedMessages, () =>
      sendClaimedQueuedMessage(deps, {
        mode: args.mode,
        queuedMessages,
        threadId: args.threadId,
      }),
    );
  } catch (error) {
    releaseQueuedMessageClaims(deps, queuedMessages);
    throw error;
  }
}

export async function sendNextQueuedMessageIfPresent(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { threadId: string },
): Promise<boolean> {
  const thread = getThread(deps.db, args.threadId);
  if (
    !thread ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.status === "stopping"
  ) {
    return false;
  }

  const nextQueuedMessages = claimNextQueuedThreadMessageGroup(
    deps.db,
    deps.hub,
    args.threadId,
  );
  if (!nextQueuedMessages) {
    return false;
  }

  try {
    await withActiveQueuedMessageClaims(nextQueuedMessages, () =>
      sendClaimedQueuedMessageForThread(deps, {
        mode: "auto",
        queuedMessages: nextQueuedMessages,
        thread,
      }),
    );
  } catch (error) {
    releaseQueuedMessageClaims(deps, nextQueuedMessages);
    if (isQueuedMessageClaimLostError(error)) {
      return false;
    }
    if (isCommandTimeoutError(error)) {
      deps.logger.debug(
        {
          queuedMessageId: nextQueuedMessages[0]!.id,
          ...runtimeErrorLogFields(deps.config, error),
          threadId: args.threadId,
        },
        "Queued message auto-send deferred by host timeout",
      );
      throw error;
    }
    deps.logger.warn(
      {
        queuedMessageId: nextQueuedMessages[0]!.id,
        ...runtimeErrorLogFields(deps.config, error),
        threadId: args.threadId,
      },
      "Queued message auto-send failed",
    );
    throw error;
  }
  return true;
}

export async function runQueuedMessageAutoSendForThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueuedMessageAutoSendArgs,
): Promise<void> {
  await deps.lifecycleDedupers.queuedMessageAutoSend.run(
    args.threadId,
    async () => {
      await sendNextQueuedMessageIfPresent(deps, {
        threadId: args.threadId,
      });
    },
  );
}

export function requestQueuedMessageAutoSendForThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueuedMessageAutoSendRequestArgs,
): void {
  deferAfterResponse({
    config: deps.config,
    context: {
      queuedMessageId: args.queuedMessageId,
      threadId: args.threadId,
    },
    logger: deps.logger,
    name: "Queued message auto-send request",
    work: () =>
      runQueuedMessageAutoSendForThread(deps, {
        threadId: args.threadId,
      }),
  });
}

export async function runQueuedMessageAutoSendSweep(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<void> {
  releaseStaleQueuedMessageClaims(deps.db, deps.hub, {
    claimedBefore: Date.now() - STALE_QUEUED_MESSAGE_CLAIM_MS,
    protectedClaimTokens: [...activeQueuedMessageClaimTokens],
  });

  for (const candidate of listIdleThreadsWithQueuedMessages(deps.db)) {
    try {
      await runQueuedMessageAutoSendForThread(deps, {
        threadId: candidate.threadId,
      });
    } catch (error) {
      if (isCommandTimeoutError(error)) {
        deps.logger.debug(
          {
            ...runtimeErrorLogFields(deps.config, error),
            threadId: candidate.threadId,
          },
          "Queued message auto-send sweep deferred by host timeout",
        );
        continue;
      }
      deps.logger.warn(
        {
          ...runtimeErrorLogFields(deps.config, error),
          threadId: candidate.threadId,
        },
        "Queued message auto-send sweep failed",
      );
    }
  }
}
