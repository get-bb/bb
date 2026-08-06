import type {
  ActorStamp,
  PersistedThreadCommandAdmission,
  Thread,
} from "@bb/domain";
import type { AdmitInterruptThreadRequest } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { getActiveTurnId } from "./thread-events.js";
import {
  applyStopRequestedWithInterruptedEventInTransaction,
  dispatchAdmittedExactThreadStopCommand,
} from "./thread-lifecycle.js";
import { ensureThreadIsWritable } from "./thread-send.js";
import { fingerprintThreadInterruptRequest } from "./message-send-fingerprint.js";
import {
  admitThreadCommand,
  getThread,
  type AdmitThreadCommandOutcome,
  type DbTransaction,
} from "@bb/db";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";

export interface AdmitExactInterruptArgs {
  actor: ActorStamp;
  environment?: { id: string; hostId: string };
  payload: AdmitInterruptThreadRequest;
  thread: Thread;
}

export type AdmitExactInterruptResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

class ExactInterruptDiscoverySentinel extends Error {
  readonly name = "ExactInterruptDiscoverySentinel";
  constructor() {
    super("Exact interrupt discovery rollback");
  }
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

function executeExactInterruptAdmission(args: {
  actor: ActorStamp;
  deps: LoggedPendingInteractionWorkSessionDeps;
  expectedTurnId: string;
  threadId: string;
  tx: DbTransaction;
}): PersistedThreadCommandAdmission["result"] {
  const thread = getThread(args.tx, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  // Interrupt may cancel a turn that has a pending interaction — do not
  // apply the send/steer pending-interaction rejection.
  ensureThreadIsWritable(thread);
  if (thread.status !== "active" && thread.status !== "starting") {
    throwExpectedTurnMismatch({
      expectedTurnId: args.expectedTurnId,
      activeTurnId: null,
    });
  }
  const activeTurnId = getActiveTurnId({ db: args.tx }, args.threadId);
  if (activeTurnId !== args.expectedTurnId) {
    throwExpectedTurnMismatch({
      expectedTurnId: args.expectedTurnId,
      activeTurnId,
    });
  }

  const stopResult = applyStopRequestedWithInterruptedEventInTransaction(
    { db: args.tx, logger: args.deps.logger },
    {
      actor: args.actor,
      reason: "manual-stop",
      threadId: args.threadId,
    },
  );
  if (!stopResult.applied) {
    throw new ApiError(
      409,
      "thread_not_writable",
      "Thread could not be interrupted from its current lifecycle state",
      {
        details: {
          reason: "not_active",
          archivedAt: thread.archivedAt,
          threadStatus: thread.status,
        },
      },
    );
  }

  return {
    disposition: "interrupted",
    eventSequence: stopResult.eventSequence,
    expectedTurnId: args.expectedTurnId,
  };
}

/**
 * Atomically admits an exact `thread.interrupt` against a required expected
 * turn. Replay/conflict/mismatch publish nothing. Notifications and one host
 * stop command run only after accepted commit.
 */
export async function admitExactInterrupt(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitExactInterruptArgs,
): Promise<AdmitExactInterruptResult> {
  const requestFingerprint = fingerprintThreadInterruptRequest({
    expectedTurnId: args.payload.expectedTurnId,
  });
  const nowMs = Date.now();

  try {
    const discovery: AdmitThreadCommandOutcome = admitThreadCommand({
      actor: args.actor,
      commandKind: "thread.interrupt",
      db: deps.db,
      nowMs,
      requestFingerprint,
      requestId: args.payload.requestId,
      threadId: args.thread.id,
      execute: () => {
        throw new ExactInterruptDiscoverySentinel();
      },
    });
    if (discovery.kind === "replayed") {
      return { kind: "replayed", admission: discovery.admission };
    }
    if (discovery.kind === "identity-conflict") {
      throwIdentityConflict();
    }
    throw new Error(
      "Discovery admission for exact interrupt unexpectedly accepted",
    );
  } catch (error) {
    if (!(error instanceof ExactInterruptDiscoverySentinel)) {
      throw error;
    }
  }

  const currentThread = getThread(deps.db, args.thread.id) ?? args.thread;
  const environment =
    args.environment ??
    requireThreadHostCommandEnvironment({ db: deps.db, thread: currentThread });

  const outcome = admitThreadCommand({
    actor: args.actor,
    commandKind: "thread.interrupt",
    db: deps.db,
    nowMs: Date.now(),
    requestFingerprint,
    requestId: args.payload.requestId,
    threadId: args.thread.id,
    execute: ({ tx }) =>
      executeExactInterruptAdmission({
        actor: args.actor,
        deps,
        expectedTurnId: args.payload.expectedTurnId,
        threadId: args.thread.id,
        tx,
      }),
  });

  if (outcome.kind === "identity-conflict") {
    throwIdentityConflict();
  }
  if (outcome.kind === "replayed") {
    return { kind: "replayed", admission: outcome.admission };
  }

  deps.hub.notifyThread(args.thread.id, ["status-changed"]);
  deps.hub.notifyThread(args.thread.id, ["events-appended"], {
    eventTypes: ["system/thread/interrupted"],
  });

  // Lifecycle transition already applied in the admission transaction. This
  // accepted-only dispatch uses its own in-flight key so an unrelated legacy
  // stop cannot suppress the exact-turn-fenced command.
  dispatchAdmittedExactThreadStopCommand(deps, {
    actor: args.actor,
    environmentId: environment.id,
    hostId: environment.hostId,
    interruptionReason: "manual-stop",
    threadId: args.thread.id,
    expectedTurnId: args.payload.expectedTurnId,
  });

  return { kind: "accepted", admission: outcome.admission };
}
