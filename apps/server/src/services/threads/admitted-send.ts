import {
  admitThreadCommand,
  createQueuedThreadMessageInTransaction,
  getActivePendingInteractionForThread,
  getEnvironment,
  getThread,
  requireThreadLifecycleEventApplied,
  type AdmitThreadCommandOutcome,
  type DbTransaction,
} from "@bb/db";
import type {
  ActorStamp,
  ClientTurnRequestId,
  Environment,
  PersistedThreadCommandAdmission,
  PromptInput,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadTurnInitiator,
} from "@bb/domain";
import type { ThreadCommandAdmissionResult } from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  applyPreparedThreadModelOverrideRecovery,
  prepareThreadModelOverrideRecovery,
  PreparedThreadModelOverrideRecoveryStaleError,
  type PreparedThreadModelOverrideRecovery,
} from "./thread-execution-override.js";
import { buildExecutionOptions } from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  type AppendedClientTurnRequestWithNotification,
} from "./thread-events.js";
import {
  ensureThreadCanStartRequest,
  prepareReadyThreadTurnCommand,
  prepareReadyThreadTurnDispatch,
  type PreparedReadyThreadTurnCommand,
} from "./thread-lifecycle.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "./lifecycle-outcome.js";
import { requireReadyThreadEnvironment } from "./thread-turn-dispatch.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { validatePromptAttachmentReferences } from "../projects/attachments.js";
import { resolvePluginMentionContextInputs } from "../plugins/plugin-mentions.js";
import {
  ensureThreadIsWritable,
  formatAgentThreadInput,
  resolveMessageSenderThreadId,
} from "./thread-send.js";
import { fingerprintMessageSendRequest } from "./message-send-fingerprint.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";

const MAX_ADMISSION_ATTEMPTS = 8;

type AdmissionBranch = "start" | "queue";

class AdmissionBranchPlanSentinel extends Error {
  readonly name = "AdmissionBranchPlanSentinel";
  constructor(readonly branch: AdmissionBranch) {
    super("Admission branch plan discovery rollback");
  }
}

class AdmissionBranchFlipSentinel extends Error {
  readonly name = "AdmissionBranchFlipSentinel";
  constructor(readonly actualBranch: AdmissionBranch) {
    super("Admission branch flipped before commit");
  }
}

export interface AdmitQueueIfActiveSendMessageArgs {
  actor: ActorStamp;
  environment?: Environment;
  /**
   * Test-only hook invoked after branch preparation and before the committing
   * admission call. Used to force status flips between discovery and admit.
   */
  afterBranchPrepared?: (branch: AdmissionBranch) => void | Promise<void>;
  payload: SendMessageRequest;
  requestId: ClientTurnRequestId;
  thread: Thread;
}

export type AdmitQueueIfActiveSendMessageResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

type PreparedStartBranch = {
  branch: "start";
  command: PreparedReadyThreadTurnCommand;
  execution: ResolvedThreadExecutionOptions;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  modelOverrideRecovery: PreparedThreadModelOverrideRecovery | null;
  readyEnvironment: ReturnType<typeof requireReadyThreadEnvironment>;
  senderThreadId: string | null;
  shouldCaptureUserMessageSent: boolean;
};

type PreparedQueueBranch = {
  branch: "queue";
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  senderThreadId: string | null;
  shouldCaptureUserMessageSent: boolean;
};

type PreparedAdmissionBranch = PreparedStartBranch | PreparedQueueBranch;

type AcceptedStartSideEffects = {
  branch: "start";
  command: PreparedReadyThreadTurnCommand;
  hostId: string;
  request: AppendedClientTurnRequestWithNotification;
  shouldCaptureUserMessageSent: boolean;
  threadBecameActive: boolean;
};

type AcceptedQueueSideEffects = {
  branch: "queue";
  shouldCaptureUserMessageSent: boolean;
};

type AcceptedSideEffects = AcceptedStartSideEffects | AcceptedQueueSideEffects;

function currentBranchForThread(thread: Thread): AdmissionBranch {
  return thread.status === "active" ? "queue" : "start";
}

function rejectIfAwaitingUserInteraction(
  tx: DbTransaction,
  threadId: string,
): void {
  if (getActivePendingInteractionForThread(tx, threadId) === null) {
    return;
  }
  throw new ApiError(
    409,
    "awaiting_user_interaction",
    "Thread is awaiting user interaction. Resolve the pending interaction before sending another prompt.",
  );
}

function throwIdentityConflict(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command request identity conflicts with an existing admission",
  );
}

function throwRetryExhausted(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command admission could not converge on a stable start-or-queue decision; retry the request",
    { retryable: true },
  );
}

function fingerprintFromPayload(
  payload: SendMessageRequest,
): ReturnType<typeof fingerprintMessageSendRequest> {
  return fingerprintMessageSendRequest({
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
  });
}

function discoverAdmissionBranch(args: {
  actor: ActorStamp;
  deps: LoggedPendingInteractionWorkSessionDeps;
  nowMs: number;
  requestFingerprint: ReturnType<typeof fingerprintMessageSendRequest>;
  requestId: ClientTurnRequestId;
  threadId: string;
}):
  | { kind: "replayed"; admission: PersistedThreadCommandAdmission }
  | { kind: "identity-conflict" }
  | { kind: "planned"; branch: AdmissionBranch } {
  try {
    const outcome = admitThreadCommand({
      actor: args.actor,
      commandKind: "message.send",
      db: args.deps.db,
      nowMs: args.nowMs,
      requestFingerprint: args.requestFingerprint,
      requestId: args.requestId,
      threadId: args.threadId,
      execute: ({ tx }) => {
        rejectIfAwaitingUserInteraction(tx, args.threadId);
        const thread = getThread(tx, args.threadId);
        if (!thread) {
          throw new ApiError(404, "thread_not_found", "Thread not found");
        }
        throw new AdmissionBranchPlanSentinel(currentBranchForThread(thread));
      },
    });
    if (outcome.kind === "replayed") {
      return { kind: "replayed", admission: outcome.admission };
    }
    if (outcome.kind === "identity-conflict") {
      return { kind: "identity-conflict" };
    }
    throw new Error(
      "Discovery admission unexpectedly accepted without a branch plan",
    );
  } catch (error) {
    if (error instanceof AdmissionBranchPlanSentinel) {
      return { kind: "planned", branch: error.branch };
    }
    throw error;
  }
}

async function prepareStartBranch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    actor: ActorStamp;
    environment: Environment;
    payload: SendMessageRequest;
    requestId: ClientTurnRequestId;
    thread: Thread;
  },
): Promise<PreparedStartBranch> {
  ensureThreadIsWritable(args.thread);
  ensureThreadCanStartRequest(args.thread);

  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: args.payload.senderThreadId,
    targetThread: args.thread,
  });
  let input = senderThreadId
    ? formatAgentThreadInput({
        input: args.payload.input,
        senderThreadId,
      })
    : args.payload.input;
  const pluginMentionContext = await resolvePluginMentionContextInputs(input);
  if (pluginMentionContext.length > 0) {
    input = [...input, ...pluginMentionContext];
  }
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input,
    projectId: args.thread.projectId,
  });
  const initiator: ThreadTurnInitiator = senderThreadId ? "agent" : "user";
  const shouldCaptureUserMessageSent = initiator === "user" && input.length > 0;

  const modelOverrideRecovery =
    senderThreadId === null
      ? await prepareThreadModelOverrideRecovery(deps, {
          model: args.payload.model,
          modelSource:
            args.payload.executionInputSources === undefined
              ? "explicit"
              : args.payload.executionInputSources.model,
          thread: args.thread,
        })
      : null;

  const execution = await buildExecutionOptions(
    deps,
    args.payload,
    {
      threadId: args.thread.id,
      ...(modelOverrideRecovery !== null
        ? { threadExecutionOverride: modelOverrideRecovery.next }
        : {}),
    },
    "client/turn/requested",
  );
  const permissionEscalation = resolvePermissionEscalation({
    thread: args.thread,
    initiator,
  });
  const readyEnvironment = requireReadyThreadEnvironment(
    getEnvironment(deps.db, args.environment.id) ?? args.environment,
  );
  const command = await prepareReadyThreadTurnCommand(deps, {
    thread: args.thread,
    fork: null,
    input,
    requestId: args.requestId,
    execution,
    permissionEscalation,
    environment: {
      id: readyEnvironment.id,
      hostId: readyEnvironment.hostId,
      path: readyEnvironment.path,
      status: readyEnvironment.status,
      workspaceProvisionType: readyEnvironment.workspaceProvisionType,
    },
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    syncGeneratedTitle: false,
  });

  return {
    branch: "start",
    command,
    execution,
    initiator,
    input,
    modelOverrideRecovery,
    readyEnvironment,
    senderThreadId,
    shouldCaptureUserMessageSent,
  };
}

async function prepareQueueBranch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    payload: SendMessageRequest;
    thread: Thread;
  },
): Promise<PreparedQueueBranch> {
  ensureThreadIsWritable(args.thread);
  await validatePromptAttachmentReferences({
    dataDir: deps.config.dataDir,
    input: args.payload.input,
    projectId: args.thread.projectId,
  });
  const execution = await buildExecutionOptions(
    deps,
    args.payload,
    { threadId: args.thread.id },
    "client/turn/requested",
  );
  const senderThreadId = resolveMessageSenderThreadId(deps, {
    senderThreadId: args.payload.senderThreadId,
    targetThread: args.thread,
  });
  return {
    branch: "queue",
    execution,
    input: args.payload.input,
    senderThreadId,
    shouldCaptureUserMessageSent:
      senderThreadId === null && args.payload.input.length > 0,
  };
}

async function prepareAdmissionBranch(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    actor: ActorStamp;
    branch: AdmissionBranch;
    environment?: Environment;
    payload: SendMessageRequest;
    requestId: ClientTurnRequestId;
    thread: Thread;
  },
): Promise<PreparedAdmissionBranch> {
  if (args.branch === "start") {
    const environment =
      args.environment ??
      (await requireThreadCommandEnvironment(deps, { thread: args.thread }));
    return prepareStartBranch(deps, { ...args, environment });
  }
  return prepareQueueBranch(deps, {
    payload: args.payload,
    thread: args.thread,
  });
}

function executeStartAdmission(args: {
  actor: ActorStamp;
  admissionSequence: number;
  deps: LoggedPendingInteractionWorkSessionDeps;
  prepared: PreparedStartBranch;
  requestFingerprint: ReturnType<typeof fingerprintMessageSendRequest>;
  requestId: ClientTurnRequestId;
  threadId: string;
  tx: DbTransaction;
}): {
  result: ThreadCommandAdmissionResult;
  sideEffects: AcceptedStartSideEffects;
} {
  const thread = getThread(args.tx, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  rejectIfAwaitingUserInteraction(args.tx, args.threadId);
  const branch = currentBranchForThread(thread);
  if (branch !== "start") {
    throw new AdmissionBranchFlipSentinel(branch);
  }
  ensureThreadIsWritable(thread);
  ensureThreadCanStartRequest(thread);

  if (args.prepared.modelOverrideRecovery !== null) {
    applyPreparedThreadModelOverrideRecovery(args.tx, {
      plan: args.prepared.modelOverrideRecovery,
      threadId: args.threadId,
    });
  }

  const request =
    appendPreparedClientTurnRequestedEventWithNotificationInTransaction(
      args.tx,
      {
        actor: args.actor,
        threadId: args.threadId,
        environmentId: thread.environmentId,
        type: "client/turn/requested",
        input: args.prepared.input,
        execution: args.prepared.execution,
        initiator: args.prepared.initiator,
        senderThreadId: args.prepared.senderThreadId,
        requestMethod: "turn/start",
        source: "tell",
        target: { kind: "new-turn" },
        requestId: args.requestId,
        admissionSequence: args.admissionSequence,
        requestFingerprint: args.requestFingerprint,
      },
    );
  recordAcceptedPromptHistoryEntry(
    { db: args.tx },
    {
      thread,
      input: args.prepared.input,
      initiator: args.prepared.initiator,
      target: { kind: "new-turn" },
      requestSequence: request.sequence,
    },
  );

  const dispatchKind = prepareReadyThreadTurnDispatch({
    command: args.prepared.command,
    thread,
  });
  let threadBecameActive = false;
  if (
    dispatchKind === "turn.submit" ||
    thread.status === "error" ||
    thread.status === "idle"
  ) {
    requireThreadLifecycleEventApplied(
      applyLoggedThreadLifecycleEventInTransaction(
        { db: args.tx, logger: args.deps.logger },
        { event: { type: "run.started" }, threadId: args.threadId },
      ),
    );
    threadBecameActive = true;
  }

  return {
    result: {
      disposition: "started",
      eventSequence: request.sequence,
    },
    sideEffects: {
      branch: "start",
      command: args.prepared.command,
      hostId: args.prepared.readyEnvironment.hostId,
      request,
      shouldCaptureUserMessageSent: args.prepared.shouldCaptureUserMessageSent,
      threadBecameActive,
    },
  };
}

function executeQueueAdmission(args: {
  actor: ActorStamp;
  admissionSequence: number;
  prepared: PreparedQueueBranch;
  requestFingerprint: ReturnType<typeof fingerprintMessageSendRequest>;
  requestId: ClientTurnRequestId;
  threadId: string;
  tx: DbTransaction;
}): {
  result: ThreadCommandAdmissionResult;
  sideEffects: AcceptedQueueSideEffects;
} {
  const thread = getThread(args.tx, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  rejectIfAwaitingUserInteraction(args.tx, args.threadId);
  const branch = currentBranchForThread(thread);
  if (branch !== "queue") {
    throw new AdmissionBranchFlipSentinel(branch);
  }
  ensureThreadIsWritable(thread);

  const queuedMessage = createQueuedThreadMessageInTransaction(args.tx, {
    actor: args.actor,
    threadId: args.threadId,
    content: args.prepared.input,
    senderThreadId: args.prepared.senderThreadId,
    model: args.prepared.execution.model,
    reasoningLevel: args.prepared.execution.reasoningLevel,
    permissionMode: args.prepared.execution.permissionMode,
    serviceTier: args.prepared.execution.serviceTier,
    admission: {
      requestId: args.requestId,
      requestFingerprint: args.requestFingerprint,
      admissionSequence: args.admissionSequence,
    },
  });

  return {
    result: {
      disposition: "queued",
      queuedMessageId: queuedMessage.id,
    },
    sideEffects: {
      branch: "queue",
      shouldCaptureUserMessageSent: args.prepared.shouldCaptureUserMessageSent,
    },
  };
}

function commitAdmission(args: {
  actor: ActorStamp;
  deps: LoggedPendingInteractionWorkSessionDeps;
  nowMs: number;
  prepared: PreparedAdmissionBranch;
  requestFingerprint: ReturnType<typeof fingerprintMessageSendRequest>;
  requestId: ClientTurnRequestId;
  threadId: string;
}):
  | {
      kind: "accepted";
      admission: PersistedThreadCommandAdmission;
      sideEffects: AcceptedSideEffects;
    }
  | { kind: "replayed"; admission: PersistedThreadCommandAdmission }
  | { kind: "identity-conflict" }
  | { kind: "branch-flip"; branch: AdmissionBranch } {
  let sideEffects: AcceptedSideEffects | null = null;
  try {
    const outcome: AdmitThreadCommandOutcome = admitThreadCommand({
      actor: args.actor,
      commandKind: "message.send",
      db: args.deps.db,
      nowMs: args.nowMs,
      requestFingerprint: args.requestFingerprint,
      requestId: args.requestId,
      threadId: args.threadId,
      execute: ({ tx, admissionSequence }) => {
        if (args.prepared.branch === "start") {
          const executed = executeStartAdmission({
            actor: args.actor,
            admissionSequence,
            deps: args.deps,
            prepared: args.prepared,
            requestFingerprint: args.requestFingerprint,
            requestId: args.requestId,
            threadId: args.threadId,
            tx,
          });
          sideEffects = executed.sideEffects;
          return executed.result;
        }
        const executed = executeQueueAdmission({
          actor: args.actor,
          admissionSequence,
          prepared: args.prepared,
          requestFingerprint: args.requestFingerprint,
          requestId: args.requestId,
          threadId: args.threadId,
          tx,
        });
        sideEffects = executed.sideEffects;
        return executed.result;
      },
    });

    if (outcome.kind === "replayed") {
      return { kind: "replayed", admission: outcome.admission };
    }
    if (outcome.kind === "identity-conflict") {
      return { kind: "identity-conflict" };
    }
    if (sideEffects === null) {
      throw new Error("Accepted admission missing post-commit side effects");
    }
    return {
      kind: "accepted",
      admission: outcome.admission,
      sideEffects,
    };
  } catch (error) {
    if (error instanceof AdmissionBranchFlipSentinel) {
      return { kind: "branch-flip", branch: error.actualBranch };
    }
    throw error;
  }
}

function publishAcceptedSideEffects(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    sideEffects: AcceptedSideEffects;
    thread: Thread;
  },
): void {
  if (args.sideEffects.branch === "start") {
    deps.hub.notifyThread(
      args.thread.id,
      args.sideEffects.request.notificationChanges,
      args.sideEffects.request.notificationMetadata,
    );
    startLiveHostCommand(deps, {
      command: args.sideEffects.command.command,
      hostId: args.sideEffects.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      onError: ({ error }) => {
        deps.logger.warn(
          { err: error, threadId: args.thread.id },
          "Live ready turn command failed",
        );
      },
    });
    if (args.sideEffects.threadBecameActive) {
      deps.hub.notifyThread(args.thread.id, ["status-changed"], {
        projectId: args.thread.projectId,
      });
    }
    if (args.sideEffects.shouldCaptureUserMessageSent) {
      deps.telemetry.capture({
        name: "user_message_sent",
        properties: {
          is_child_thread: args.thread.parentThreadId !== null,
          message_source: "thread_send",
          provider: args.thread.providerId,
        },
      });
    }
    return;
  }

  deps.hub.notifyThread(args.thread.id, ["queue-changed"]);
  if (args.sideEffects.shouldCaptureUserMessageSent) {
    deps.telemetry.capture({
      name: "user_message_sent",
      properties: {
        is_child_thread: args.thread.parentThreadId !== null,
        message_source: "queued_message",
        provider: args.thread.providerId,
      },
    });
  }
}

/**
 * Atomically admits a `queue-if-active` `message.send`: either starts a turn or
 * enqueues one durable queued row under the caller's request identity.
 * Side effects (notifications, telemetry, host commands) run only after an
 * accepted commit — never for replays or conflicts.
 */
export async function admitQueueIfActiveSendMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitQueueIfActiveSendMessageArgs,
): Promise<AdmitQueueIfActiveSendMessageResult> {
  if (args.payload.mode !== "queue-if-active") {
    throw new ApiError(
      400,
      "invalid_request",
      "admitQueueIfActiveSendMessage requires mode queue-if-active",
    );
  }

  const requestFingerprint = fingerprintFromPayload(args.payload);
  let plannedBranch: AdmissionBranch | null = null;

  for (let attempt = 0; attempt < MAX_ADMISSION_ATTEMPTS; attempt += 1) {
    const nowMs = Date.now();
    const discovery = discoverAdmissionBranch({
      actor: args.actor,
      deps,
      nowMs,
      requestFingerprint,
      requestId: args.requestId,
      threadId: args.thread.id,
    });

    if (discovery.kind === "replayed") {
      return { kind: "replayed", admission: discovery.admission };
    }
    if (discovery.kind === "identity-conflict") {
      throwIdentityConflict();
    }

    const branch = plannedBranch ?? discovery.branch;
    plannedBranch = null;

    let prepared: PreparedAdmissionBranch;
    try {
      prepared = await prepareAdmissionBranch(deps, {
        actor: args.actor,
        branch,
        environment: args.environment,
        payload: args.payload,
        requestId: args.requestId,
        thread: getThread(deps.db, args.thread.id) ?? args.thread,
      });
    } catch (error) {
      // Preparation runs before any ledger write; surface failures as-is.
      throw error;
    }

    await args.afterBranchPrepared?.(branch);

    try {
      const committed = commitAdmission({
        actor: args.actor,
        deps,
        nowMs,
        prepared,
        requestFingerprint,
        requestId: args.requestId,
        threadId: args.thread.id,
      });

      if (committed.kind === "replayed") {
        return { kind: "replayed", admission: committed.admission };
      }
      if (committed.kind === "identity-conflict") {
        throwIdentityConflict();
      }
      if (committed.kind === "branch-flip") {
        plannedBranch = committed.branch;
        continue;
      }

      publishAcceptedSideEffects(deps, {
        sideEffects: committed.sideEffects,
        thread: getThread(deps.db, args.thread.id) ?? args.thread,
      });
      return { kind: "accepted", admission: committed.admission };
    } catch (error) {
      if (error instanceof PreparedThreadModelOverrideRecoveryStaleError) {
        continue;
      }
      throw error;
    }
  }

  throwRetryExhausted();
}
