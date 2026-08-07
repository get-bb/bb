import {
  admitThreadCommand,
  getEnvironment,
  getPendingInteraction,
  getThread,
  setPendingInteractionResolving,
  type AdmitThreadCommandOutcome,
  type DbTransaction,
} from "@bb/db";
import type {
  ActorStamp,
  ApprovalPendingInteractionResolution,
  ClientTurnRequestId,
  PersistedThreadCommandAdmission,
  PendingInteraction,
  PendingInteractionResolution,
  Thread,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import {
  isApprovalPendingInteractionPayload,
  isPluginPendingInteraction,
  isUserQuestionPendingInteractionPayload,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import {
  pendingInteractionResolutionEquals,
  validatePendingInteractionResolution,
} from "../interactions/pending-interaction-validation.js";
import { toPendingInteraction } from "../interactions/pending-interaction-serialization.js";
import {
  fingerprintInteractionAnswerRequest,
  fingerprintInteractionApproveRequest,
} from "./message-send-fingerprint.js";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";

export interface AdmitInteractionAnswerArgs {
  actor: ActorStamp;
  payload: {
    interactionId: string;
    requestId: ClientTurnRequestId;
    resolution: UserQuestionPendingInteractionResolution;
  };
  thread: Thread;
}

export interface AdmitInteractionApproveArgs {
  actor: ActorStamp;
  payload: {
    interactionId: string;
    requestId: ClientTurnRequestId;
    resolution: ApprovalPendingInteractionResolution;
  };
  thread: Thread;
}

export type AdmitInteractionResolutionResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

class InteractionResolutionDiscoverySentinel extends Error {
  readonly name = "InteractionResolutionDiscoverySentinel";
  constructor() {
    super("Interaction resolution discovery rollback");
  }
}

function throwIdentityConflict(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command request identity conflicts with an existing admission",
  );
}

function throwInteractionNotFound(): never {
  throw new ApiError(404, "invalid_request", "Pending interaction not found");
}

function throwResolveConflict(interaction: PendingInteraction): never {
  throw new ApiError(
    409,
    "pending_interaction_conflict",
    `Pending interaction ${interaction.id} is already ${interaction.status}`,
  );
}

function throwWrongInteractionKind(args: {
  expected: "user_question" | "approval";
  interactionId: string;
}): never {
  throw new ApiError(
    400,
    "invalid_request",
    args.expected === "user_question"
      ? `Pending interaction ${args.interactionId} is not a user-question`
      : `Pending interaction ${args.interactionId} is not an approval`,
  );
}

function buildInteractiveResolveCommand(args: {
  environmentId: string;
  interaction: PendingInteraction;
  resolution: PendingInteractionResolution;
}): Extract<HostDaemonCommand, { type: "interactive.resolve" }> {
  if (isPluginPendingInteraction(args.interaction)) {
    throw new Error("Plugin interactions do not produce host resolve commands");
  }
  return {
    type: "interactive.resolve",
    environmentId: args.environmentId,
    threadId: args.interaction.threadId,
    interactionId: args.interaction.id,
    providerId: args.interaction.providerId,
    providerThreadId: args.interaction.providerThreadId,
    providerRequestId: args.interaction.providerRequestId,
    resolution: args.resolution,
  };
}

function requireThreadInteraction(
  tx: DbTransaction,
  args: {
    expectedKind: "user_question" | "approval";
    interactionId: string;
    threadId: string;
  },
): PendingInteraction {
  const row = getPendingInteraction(tx, args.interactionId);
  if (row === null) {
    throwInteractionNotFound();
  }
  const interaction = toPendingInteraction(row);
  if (interaction.threadId !== args.threadId) {
    throwInteractionNotFound();
  }
  if (args.expectedKind === "user_question") {
    if (!isUserQuestionPendingInteractionPayload(interaction.payload)) {
      throwWrongInteractionKind({
        expected: "user_question",
        interactionId: args.interactionId,
      });
    }
  } else if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    throwWrongInteractionKind({
      expected: "approval",
      interactionId: args.interactionId,
    });
  }
  return interaction;
}

function executeInteractionResolutionAdmission(args: {
  actor: ActorStamp;
  commandKind: "interaction.answer" | "interaction.approve";
  expectedKind: "user_question" | "approval";
  interactionId: string;
  resolution: PendingInteractionResolution;
  threadId: string;
  tx: DbTransaction;
  onTransitioned: () => void;
}): PersistedThreadCommandAdmission["result"] {
  const interaction = requireThreadInteraction(args.tx, {
    expectedKind: args.expectedKind,
    interactionId: args.interactionId,
    threadId: args.threadId,
  });

  if (interaction.status !== "pending") {
    if (
      (interaction.status === "resolving" ||
        interaction.status === "resolved") &&
      pendingInteractionResolutionEquals(
        interaction.resolution,
        args.resolution,
      )
    ) {
      return args.commandKind === "interaction.answer"
        ? {
            disposition: "answered",
            interactionId: args.interactionId,
          }
        : {
            disposition: "approved",
            interactionId: args.interactionId,
          };
    }
    throwResolveConflict(interaction);
  }

  validatePendingInteractionResolution(interaction, args.resolution);

  const resolving = setPendingInteractionResolving(args.tx, {
    id: args.interactionId,
    resolution: JSON.stringify(args.resolution),
    resolutionActor: args.actor,
  });
  if (!resolving) {
    const latestRow = getPendingInteraction(args.tx, args.interactionId);
    if (latestRow === null) {
      throwInteractionNotFound();
    }
    const latest = toPendingInteraction(latestRow);
    if (
      (latest.status === "resolving" || latest.status === "resolved") &&
      pendingInteractionResolutionEquals(latest.resolution, args.resolution)
    ) {
      return args.commandKind === "interaction.answer"
        ? {
            disposition: "answered",
            interactionId: args.interactionId,
          }
        : {
            disposition: "approved",
            interactionId: args.interactionId,
          };
    }
    throwResolveConflict(latest);
  }

  args.onTransitioned();
  return args.commandKind === "interaction.answer"
    ? {
        disposition: "answered",
        interactionId: args.interactionId,
      }
    : {
        disposition: "approved",
        interactionId: args.interactionId,
      };
}

async function admitInteractionResolution(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    actor: ActorStamp;
    commandKind: "interaction.answer" | "interaction.approve";
    expectedKind: "user_question" | "approval";
    interactionId: string;
    requestFingerprint: ReturnType<typeof fingerprintInteractionAnswerRequest>;
    requestId: ClientTurnRequestId;
    resolution: PendingInteractionResolution;
    thread: Thread;
  },
): Promise<AdmitInteractionResolutionResult> {
  const nowMs = Date.now();

  try {
    const discovery: AdmitThreadCommandOutcome = admitThreadCommand({
      actor: args.actor,
      commandKind: args.commandKind,
      db: deps.db,
      nowMs,
      requestFingerprint: args.requestFingerprint,
      requestId: args.requestId,
      threadId: args.thread.id,
      execute: () => {
        throw new InteractionResolutionDiscoverySentinel();
      },
    });
    if (discovery.kind === "replayed") {
      return { kind: "replayed", admission: discovery.admission };
    }
    if (discovery.kind === "identity-conflict") {
      throwIdentityConflict();
    }
    throw new Error(
      `Discovery admission for ${args.commandKind} unexpectedly accepted`,
    );
  } catch (error) {
    if (!(error instanceof InteractionResolutionDiscoverySentinel)) {
      throw error;
    }
  }

  const currentThread = getThread(deps.db, args.thread.id) ?? args.thread;
  const environment = requireThreadHostCommandEnvironment({
    db: deps.db,
    thread: currentThread,
  });
  const environmentRow = getEnvironment(deps.db, environment.id);
  if (!environmentRow) {
    throw new ApiError(
      409,
      "thread_environment_unavailable",
      "Thread environment is unavailable",
    );
  }

  // Pre-load interaction for host-command construction after accept. The
  // durable transition still re-validates inside the admission transaction.
  const precheckRow = getPendingInteraction(deps.db, args.interactionId);
  if (precheckRow === null) {
    throwInteractionNotFound();
  }
  const precheck = toPendingInteraction(precheckRow);
  if (precheck.threadId !== args.thread.id) {
    throwInteractionNotFound();
  }
  if (args.expectedKind === "user_question") {
    if (!isUserQuestionPendingInteractionPayload(precheck.payload)) {
      throwWrongInteractionKind({
        expected: "user_question",
        interactionId: args.interactionId,
      });
    }
  } else if (!isApprovalPendingInteractionPayload(precheck.payload)) {
    throwWrongInteractionKind({
      expected: "approval",
      interactionId: args.interactionId,
    });
  }
  if (isPluginPendingInteraction(precheck)) {
    throw new ApiError(
      400,
      "invalid_request",
      "Plugin interactions must be submitted through the respond endpoint",
    );
  }

  let transitioned = false;
  const outcome = admitThreadCommand({
    actor: args.actor,
    commandKind: args.commandKind,
    db: deps.db,
    nowMs: Date.now(),
    requestFingerprint: args.requestFingerprint,
    requestId: args.requestId,
    threadId: args.thread.id,
    execute: ({ tx }) =>
      executeInteractionResolutionAdmission({
        actor: args.actor,
        commandKind: args.commandKind,
        expectedKind: args.expectedKind,
        interactionId: args.interactionId,
        resolution: args.resolution,
        threadId: args.thread.id,
        tx,
        onTransitioned: () => {
          transitioned = true;
        },
      }),
  });

  if (outcome.kind === "identity-conflict") {
    throwIdentityConflict();
  }
  if (outcome.kind === "replayed") {
    return { kind: "replayed", admission: outcome.admission };
  }

  if (transitioned) {
    const command = buildInteractiveResolveCommand({
      environmentId: environment.id,
      interaction: precheck,
      resolution: args.resolution,
    });
    startLiveHostCommand(
      { ...deps, pendingInteractions: deps.pendingInteractions },
      {
        command,
        hostId: environment.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
        onError: ({ error }) => {
          deps.logger.warn(
            { err: error, interactionId: args.interactionId },
            "Live interactive resolve command failed",
          );
        },
      },
    );
  }

  return { kind: "accepted", admission: outcome.admission };
}

/**
 * Atomically admits `interaction.answer`: pending→resolving inside the
 * admission transaction; live host dispatch only after accepted commit.
 */
export async function admitInteractionAnswer(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitInteractionAnswerArgs,
): Promise<AdmitInteractionResolutionResult> {
  return admitInteractionResolution(deps, {
    actor: args.actor,
    commandKind: "interaction.answer",
    expectedKind: "user_question",
    interactionId: args.payload.interactionId,
    requestFingerprint: fingerprintInteractionAnswerRequest({
      interactionId: args.payload.interactionId,
      resolution: args.payload.resolution,
    }),
    requestId: args.payload.requestId,
    resolution: args.payload.resolution,
    thread: args.thread,
  });
}

/**
 * Atomically admits `interaction.approve`: pending→resolving inside the
 * admission transaction; live host dispatch only after accepted commit.
 */
export async function admitInteractionApprove(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitInteractionApproveArgs,
): Promise<AdmitInteractionResolutionResult> {
  return admitInteractionResolution(deps, {
    actor: args.actor,
    commandKind: "interaction.approve",
    expectedKind: "approval",
    interactionId: args.payload.interactionId,
    requestFingerprint: fingerprintInteractionApproveRequest({
      interactionId: args.payload.interactionId,
      resolution: args.payload.resolution,
    }),
    requestId: args.payload.requestId,
    resolution: args.payload.resolution,
    thread: args.thread,
  });
}
