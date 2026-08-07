import {
  admitThreadCommand,
  getThread,
  setThreadReadStateForPrincipal,
  type AdmitThreadCommandOutcome,
  type DbTransaction,
} from "@bb/db";
import type {
  ActorStamp,
  ClientTurnRequestId,
  PersistedThreadCommandAdmission,
  Thread,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { fingerprintReadMarkRequest } from "./message-send-fingerprint.js";

export interface AdmitReadMarkArgs {
  actor: ActorStamp;
  payload: {
    eventCursor: string;
    requestId: ClientTurnRequestId;
  };
  thread: Thread;
}

export type AdmitReadMarkResult = {
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
};

class ReadMarkDiscoverySentinel extends Error {
  readonly name = "ReadMarkDiscoverySentinel";
  constructor() {
    super("Read mark discovery rollback");
  }
}

function throwIdentityConflict(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command request identity conflicts with an existing admission",
  );
}

function executeReadMarkAdmission(args: {
  actor: ActorStamp;
  eventCursor: string;
  lastReadAt: number;
  notifier: NotificationBuffer;
  threadId: string;
  tx: DbTransaction;
}): PersistedThreadCommandAdmission["result"] {
  const thread = getThread(args.tx, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }

  const result = setThreadReadStateForPrincipal(args.tx, args.notifier, {
    threadId: args.threadId,
    principalId: args.actor.principalId,
    lastReadAt: args.lastReadAt,
    readCursor: args.eventCursor,
  });
  if (!result) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }

  return {
    disposition: "marked",
    readCursor: args.eventCursor,
  };
}

/**
 * Atomically admits `read.mark` for the caller's principal only. The
 * per-principal read-state upsert runs inside the admission transaction;
 * notifications flush only after an accepted commit.
 */
export async function admitReadMark(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: AdmitReadMarkArgs,
): Promise<AdmitReadMarkResult> {
  const requestFingerprint = fingerprintReadMarkRequest({
    eventCursor: args.payload.eventCursor,
  });
  const nowMs = Date.now();

  try {
    const discovery: AdmitThreadCommandOutcome = admitThreadCommand({
      actor: args.actor,
      commandKind: "read.mark",
      db: deps.db,
      nowMs,
      requestFingerprint,
      requestId: args.payload.requestId,
      threadId: args.thread.id,
      execute: () => {
        throw new ReadMarkDiscoverySentinel();
      },
    });
    if (discovery.kind === "replayed") {
      return { kind: "replayed", admission: discovery.admission };
    }
    if (discovery.kind === "identity-conflict") {
      throwIdentityConflict();
    }
    throw new Error("Discovery admission for read.mark unexpectedly accepted");
  } catch (error) {
    if (!(error instanceof ReadMarkDiscoverySentinel)) {
      throw error;
    }
  }

  const notificationBuffer = new NotificationBuffer();
  const admissionNowMs = Date.now();
  const outcome = admitThreadCommand({
    actor: args.actor,
    commandKind: "read.mark",
    db: deps.db,
    nowMs: admissionNowMs,
    requestFingerprint,
    requestId: args.payload.requestId,
    threadId: args.thread.id,
    execute: ({ tx }) =>
      executeReadMarkAdmission({
        actor: args.actor,
        eventCursor: args.payload.eventCursor,
        lastReadAt: admissionNowMs,
        notifier: notificationBuffer,
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

  notificationBuffer.flushInto(deps.hub);
  return { kind: "accepted", admission: outcome.admission };
}
