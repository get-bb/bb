import {
  admitThreadCommand,
  getActivePendingInteractionForThread,
  getEnvironment,
  getThread,
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
import type { AdmitSteerMessageRequest } from "@bb/server-contract";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
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
  addRequestIdToTurnSubmitCommandPayload,
  prepareTurnSubmitCommandPayload,
} from "./thread-commands.js";
import {
  appendPreparedClientTurnRequestedEventWithNotificationInTransaction,
  getActiveTurnId,
  type AppendedClientTurnRequestWithNotification,
} from "./thread-events.js";
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
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import { requireReadyThreadEnvironment } from "./thread-turn-dispatch.js";
import { fingerprintMessageSteerRequest } from "./message-send-fingerprint.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";

const MAX_ADMISSION_ATTEMPTS = 8;

export interface AdmitExactSteerMessageArgs {
  actor: ActorStamp;
  environment?: Environment;
  /**
   * Test-only hook invoked after preparation and before the committing
   * admission call. Used to force turn flips between preparation and admit.
   */
  afterPrepared?: () => void | Promise<void>;
  payload: AdmitSteerMessageRequest;
  thread: Thread;
}

export type AdmitExactSteerMessageResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

type PreparedExactSteer = {
  command: Extract<HostDaemonCommand, { type: "turn.submit" }>;
  execution: ResolvedThreadExecutionOptions;
  expectedTurnId: string;
  hostId: string;
  initiator: ThreadTurnInitiator;
  input: PromptInput[];
  modelOverrideRecovery: PreparedThreadModelOverrideRecovery | null;
  senderThreadId: string | null;
  shouldCaptureUserMessageSent: boolean;
};

type AcceptedSteerSideEffects = {
  command: Extract<HostDaemonCommand, { type: "turn.submit" }>;
  hostId: string;
  request: AppendedClientTurnRequestWithNotification;
  shouldCaptureUserMessageSent: boolean;
};

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

function throwExpectedTurnMismatch(args: {
  expectedTurnId: string;
  activeTurnId: string | null;
}): never {
  throw new ApiError(
    409,
    "expected_turn_mismatch",
    `Expected active turn ${args.expectedTurnId}, but active turn is ${args.activeTurnId ?? "none"}`,
  );
}

function throwRetryExhausted(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Exact-steer admission could not converge on a stable execution override; retry the request",
    { retryable: true },
  );
}

function fingerprintFromPayload(
  payload: AdmitSteerMessageRequest,
): ReturnType<typeof fingerprintMessageSteerRequest> {
  return fingerprintMessageSteerRequest({
    expectedTurnId: payload.expectedTurnId,
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

async function prepareExactSteer(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    environment: Environment;
    payload: AdmitSteerMessageRequest;
    thread: Thread;
  },
): Promise<PreparedExactSteer> {
  ensureThreadIsWritable(args.thread);
  if (args.thread.status !== "active") {
    throwExpectedTurnMismatch({
      expectedTurnId: args.payload.expectedTurnId,
      activeTurnId: null,
    });
  }
  const activeTurnId = getActiveTurnId(deps, args.thread.id);
  if (activeTurnId !== args.payload.expectedTurnId) {
    throwExpectedTurnMismatch({
      expectedTurnId: args.payload.expectedTurnId,
      activeTurnId,
    });
  }

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
    {
      ...(args.payload.model !== undefined
        ? { model: args.payload.model }
        : {}),
      ...(args.payload.serviceTier !== undefined
        ? { serviceTier: args.payload.serviceTier }
        : {}),
      ...(args.payload.reasoningLevel !== undefined
        ? { reasoningLevel: args.payload.reasoningLevel }
        : {}),
      ...(args.payload.permissionMode !== undefined
        ? { permissionMode: args.payload.permissionMode }
        : {}),
      ...(args.payload.executionInputSources !== undefined
        ? { executionInputSources: args.payload.executionInputSources }
        : {}),
    },
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
  await ensureHostSessionReadyForWork(deps, {
    hostId: readyEnvironment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
    thread: args.thread,
    input,
    execution,
    permissionEscalation,
    target: {
      mode: "exact-steer",
      expectedTurnId: args.payload.expectedTurnId,
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
    requestId: args.payload.requestId,
  });

  return {
    command,
    execution,
    expectedTurnId: args.payload.expectedTurnId,
    hostId: readyEnvironment.hostId,
    initiator,
    input,
    modelOverrideRecovery,
    senderThreadId,
    shouldCaptureUserMessageSent,
  };
}

function executeExactSteerAdmission(args: {
  actor: ActorStamp;
  admissionSequence: number;
  deps: LoggedPendingInteractionWorkSessionDeps;
  prepared: PreparedExactSteer;
  requestFingerprint: ReturnType<typeof fingerprintMessageSteerRequest>;
  requestId: ClientTurnRequestId;
  threadId: string;
  tx: DbTransaction;
}): {
  result: PersistedThreadCommandAdmission["result"];
  sideEffects: AcceptedSteerSideEffects;
} {
  const thread = getThread(args.tx, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  rejectIfAwaitingUserInteraction(args.tx, args.threadId);
  ensureThreadIsWritable(thread);
  if (thread.status !== "active") {
    throwExpectedTurnMismatch({
      expectedTurnId: args.prepared.expectedTurnId,
      activeTurnId: null,
    });
  }
  const activeTurnId = getActiveTurnId({ db: args.tx }, args.threadId);
  if (activeTurnId !== args.prepared.expectedTurnId) {
    throwExpectedTurnMismatch({
      expectedTurnId: args.prepared.expectedTurnId,
      activeTurnId,
    });
  }

  if (args.prepared.modelOverrideRecovery !== null) {
    applyPreparedThreadModelOverrideRecovery(args.tx, {
      plan: args.prepared.modelOverrideRecovery,
      threadId: args.threadId,
    });
  }

  const target = {
    kind: "steer" as const,
    expectedTurnId: args.prepared.expectedTurnId,
  };
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
        target,
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
      target,
      requestSequence: request.sequence,
    },
  );

  return {
    result: {
      disposition: "steered",
      eventSequence: request.sequence,
      expectedTurnId: args.prepared.expectedTurnId,
    },
    sideEffects: {
      command: args.prepared.command,
      hostId: args.prepared.hostId,
      request,
      shouldCaptureUserMessageSent: args.prepared.shouldCaptureUserMessageSent,
    },
  };
}

function publishAcceptedSteerSideEffects(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    sideEffects: AcceptedSteerSideEffects;
    thread: Thread;
  },
): void {
  deps.hub.notifyThread(
    args.thread.id,
    args.sideEffects.request.notificationChanges,
    args.sideEffects.request.notificationMetadata,
  );
  startLiveHostCommand(deps, {
    command: args.sideEffects.command,
    hostId: args.sideEffects.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        "Live exact-steer turn submit command failed",
      );
    },
  });
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
}

class ExactSteerDiscoverySentinel extends Error {
  readonly name = "ExactSteerDiscoverySentinel";
  constructor() {
    super("Exact steer discovery rollback");
  }
}

/**
 * Atomically admits an exact `message.steer` against a required expected turn.
 * Replay/conflict skip preparation side effects. Stale expected turn fails
 * closed with no ledger/event/host mutation. Host dispatch runs only after
 * accepted commit.
 */
export async function admitExactSteerMessage(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitExactSteerMessageArgs,
): Promise<AdmitExactSteerMessageResult> {
  const requestFingerprint = fingerprintFromPayload(args.payload);

  for (let attempt = 0; attempt < MAX_ADMISSION_ATTEMPTS; attempt += 1) {
    // Discover replay/conflict without host preparation.
    try {
      const discovery: AdmitThreadCommandOutcome = admitThreadCommand({
        actor: args.actor,
        commandKind: "message.steer",
        db: deps.db,
        nowMs: Date.now(),
        requestFingerprint,
        requestId: args.payload.requestId,
        threadId: args.thread.id,
        execute: () => {
          throw new ExactSteerDiscoverySentinel();
        },
      });
      if (discovery.kind === "replayed") {
        return { kind: "replayed", admission: discovery.admission };
      }
      if (discovery.kind === "identity-conflict") {
        throwIdentityConflict();
      }
      throw new Error(
        "Discovery admission for exact steer unexpectedly accepted",
      );
    } catch (error) {
      if (!(error instanceof ExactSteerDiscoverySentinel)) {
        throw error;
      }
    }

    const currentThread = getThread(deps.db, args.thread.id) ?? args.thread;
    const environment =
      args.environment ??
      (await requireThreadCommandEnvironment(deps, {
        thread: currentThread,
      }));
    const prepared = await prepareExactSteer(deps, {
      environment,
      payload: args.payload,
      thread: currentThread,
    });
    await args.afterPrepared?.();

    let sideEffects: AcceptedSteerSideEffects | null = null;
    try {
      const outcome = admitThreadCommand({
        actor: args.actor,
        commandKind: "message.steer",
        db: deps.db,
        nowMs: Date.now(),
        requestFingerprint,
        requestId: args.payload.requestId,
        threadId: args.thread.id,
        execute: ({ tx, admissionSequence }) => {
          const executed = executeExactSteerAdmission({
            actor: args.actor,
            admissionSequence,
            deps,
            prepared,
            requestFingerprint,
            requestId: args.payload.requestId,
            threadId: args.thread.id,
            tx,
          });
          sideEffects = executed.sideEffects;
          return executed.result;
        },
      });

      if (outcome.kind === "identity-conflict") {
        throwIdentityConflict();
      }
      if (outcome.kind === "replayed") {
        return { kind: "replayed", admission: outcome.admission };
      }
      if (sideEffects === null) {
        throw new Error("Accepted exact-steer admission missing side effects");
      }
      publishAcceptedSteerSideEffects(deps, {
        sideEffects,
        thread: getThread(deps.db, args.thread.id) ?? currentThread,
      });
      return { kind: "accepted", admission: outcome.admission };
    } catch (error) {
      if (error instanceof PreparedThreadModelOverrideRecoveryStaleError) {
        continue;
      }
      throw error;
    }
  }

  throwRetryExhausted();
}
