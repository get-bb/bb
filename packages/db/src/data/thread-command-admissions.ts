import { and, eq, max } from "drizzle-orm";
import {
  actorStampSchema,
  clientTurnRequestIdSchema,
  parsePersistedThreadCommandAdmission,
  parseThreadCommandAdmissionResultForKind,
  threadCommandRequestFingerprintSchema,
  threadCommandAdmissionDispositionSchema,
  threadCommandAdmissionIdentityFromActor,
  threadCommandAdmissionIdentitiesEqual,
  threadCommandKindSchema,
  type ActorStamp,
  type ClientTurnRequestId,
  type PersistedThreadCommandAdmission,
  type ThreadCommandRequestFingerprint,
  type ThreadCommandAdmissionDisposition,
  type ThreadCommandAdmissionIdentity,
  type ThreadCommandAdmissionResult,
  type ThreadCommandKind,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import {
  decodeActorStampFromColumns,
  encodeActorStampColumns,
} from "../actor-stamp-columns.js";
import { threadCommandAdmissions } from "../schema.js";

export class ThreadCommandAdmissionCorruptionError extends Error {
  readonly name = "ThreadCommandAdmissionCorruptionError";
}

export interface AdmitThreadCommandExecuteArgs {
  admissionSequence: number;
  tx: DbTransaction;
}

export type AdmitThreadCommandExecute = (
  args: AdmitThreadCommandExecuteArgs,
) => ThreadCommandAdmissionResult;

export interface AdmitThreadCommandArgs {
  actor: ActorStamp;
  commandKind: ThreadCommandKind;
  db: DbConnection;
  execute: AdmitThreadCommandExecute;
  nowMs: number;
  requestFingerprint: ThreadCommandRequestFingerprint;
  requestId: ClientTurnRequestId;
  threadId: string;
}

export type AdmitThreadCommandAcceptedOutcome = {
  kind: "accepted";
  admission: PersistedThreadCommandAdmission;
};

export type AdmitThreadCommandReplayedOutcome = {
  kind: "replayed";
  admission: PersistedThreadCommandAdmission;
};

export type AdmitThreadCommandIdentityConflictOutcome = {
  kind: "identity-conflict";
  existing: ThreadCommandAdmissionIdentity;
};

export type AdmitThreadCommandOutcome =
  | AdmitThreadCommandAcceptedOutcome
  | AdmitThreadCommandReplayedOutcome
  | AdmitThreadCommandIdentityConflictOutcome;

type ThreadCommandAdmissionRow = typeof threadCommandAdmissions.$inferSelect;

function isFiniteSafeNonnegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function assertAdmitThreadCommandArgs(args: AdmitThreadCommandArgs): void {
  if (typeof args.threadId !== "string" || args.threadId.length === 0) {
    throw new Error("Invalid thread command admission threadId");
  }
  clientTurnRequestIdSchema.parse(args.requestId);
  threadCommandKindSchema.parse(args.commandKind);
  threadCommandRequestFingerprintSchema.parse(args.requestFingerprint);
  actorStampSchema.parse(args.actor);
  if (!isFiniteSafeNonnegativeInteger(args.nowMs)) {
    throw new Error("Invalid thread command admission nowMs");
  }
  if (typeof args.execute !== "function") {
    throw new Error("Invalid thread command admission execute callback");
  }
}

function assertNullResultColumns(
  row: ThreadCommandAdmissionRow,
  columns: ReadonlyArray<
    | "resultEventSequence"
    | "resultQueuedMessageId"
    | "resultExpectedTurnId"
    | "resultInteractionId"
    | "resultReadCursor"
    | "resultPrUrl"
    | "resultPrNumber"
    | "resultCommitSha"
  >,
  context: string,
): void {
  for (const column of columns) {
    if (row[column] !== null) {
      throw new ThreadCommandAdmissionCorruptionError(
        `Corrupt thread command admission: ${context} has unexpected ${column}`,
      );
    }
  }
}

const NON_PUBLISHED_RESULT_POINTER_COLUMNS = [
  "resultPrUrl",
  "resultPrNumber",
  "resultCommitSha",
] as const;

function decodeResultFromRow(
  row: ThreadCommandAdmissionRow,
): ThreadCommandAdmissionResult {
  const disposition = threadCommandAdmissionDispositionSchema.parse(
    row.resultDisposition,
  );

  switch (disposition) {
    case "started": {
      if (row.resultEventSequence === null) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: started result missing event sequence",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultQueuedMessageId",
          "resultExpectedTurnId",
          "resultInteractionId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "started result",
      );
      return parseThreadCommandAdmissionResultForKind("message.send", {
        disposition: "started",
        eventSequence: row.resultEventSequence,
      });
    }
    case "queued": {
      if (row.resultQueuedMessageId === null) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: queued result missing queued message id",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultEventSequence",
          "resultExpectedTurnId",
          "resultInteractionId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "queued result",
      );
      return parseThreadCommandAdmissionResultForKind("message.send", {
        disposition: "queued",
        queuedMessageId: row.resultQueuedMessageId,
      });
    }
    case "steered": {
      if (
        row.resultEventSequence === null ||
        row.resultExpectedTurnId === null
      ) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: steered result missing event sequence or expected turn id",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultQueuedMessageId",
          "resultInteractionId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "steered result",
      );
      return parseThreadCommandAdmissionResultForKind("message.steer", {
        disposition: "steered",
        eventSequence: row.resultEventSequence,
        expectedTurnId: row.resultExpectedTurnId,
      });
    }
    case "interrupted": {
      if (
        row.resultEventSequence === null ||
        row.resultExpectedTurnId === null
      ) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: interrupted result missing event sequence or expected turn id",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultQueuedMessageId",
          "resultInteractionId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "interrupted result",
      );
      return parseThreadCommandAdmissionResultForKind("thread.interrupt", {
        disposition: "interrupted",
        eventSequence: row.resultEventSequence,
        expectedTurnId: row.resultExpectedTurnId,
      });
    }
    case "answered": {
      if (row.resultInteractionId === null) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: answered result missing interaction id",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultEventSequence",
          "resultQueuedMessageId",
          "resultExpectedTurnId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "answered result",
      );
      return parseThreadCommandAdmissionResultForKind("interaction.answer", {
        disposition: "answered",
        interactionId: row.resultInteractionId,
      });
    }
    case "approved": {
      if (row.resultInteractionId === null) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: approved result missing interaction id",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultEventSequence",
          "resultQueuedMessageId",
          "resultExpectedTurnId",
          "resultReadCursor",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "approved result",
      );
      return parseThreadCommandAdmissionResultForKind("interaction.approve", {
        disposition: "approved",
        interactionId: row.resultInteractionId,
      });
    }
    case "marked": {
      if (row.resultReadCursor === null) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: marked result missing read cursor",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultEventSequence",
          "resultQueuedMessageId",
          "resultExpectedTurnId",
          "resultInteractionId",
          ...NON_PUBLISHED_RESULT_POINTER_COLUMNS,
        ],
        "marked result",
      );
      return parseThreadCommandAdmissionResultForKind("read.mark", {
        disposition: "marked",
        readCursor: row.resultReadCursor,
      });
    }
    case "published": {
      if (
        row.resultPrUrl === null ||
        row.resultPrNumber === null ||
        row.resultCommitSha === null
      ) {
        throw new ThreadCommandAdmissionCorruptionError(
          "Corrupt thread command admission: published result missing PR or commit pointers",
        );
      }
      assertNullResultColumns(
        row,
        [
          "resultEventSequence",
          "resultQueuedMessageId",
          "resultExpectedTurnId",
          "resultInteractionId",
          "resultReadCursor",
        ],
        "published result",
      );
      return parseThreadCommandAdmissionResultForKind("branch.publish", {
        disposition: "published",
        provider: "github",
        prNumber: row.resultPrNumber,
        prUrl: row.resultPrUrl,
        commitSha: row.resultCommitSha,
      });
    }
    default: {
      const _exhaustive: never = disposition;
      throw new ThreadCommandAdmissionCorruptionError(
        `Corrupt thread command admission: unknown disposition ${String(_exhaustive)}`,
      );
    }
  }
}

function decodeAdmissionFromRow(
  row: ThreadCommandAdmissionRow,
): PersistedThreadCommandAdmission {
  const actor = decodeActorStampFromColumns({
    actorPrincipalId: row.actorPrincipalId,
    actorKind: row.actorKind,
    actorDisplayName: row.actorDisplayName,
  });
  const result = decodeResultFromRow(row);

  return parsePersistedThreadCommandAdmission({
    threadId: row.threadId,
    requestId: row.requestId,
    commandKind: row.commandKind,
    requestFingerprint: row.requestFingerprint,
    admissionSequence: row.admissionSequence,
    actor,
    result,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
}

function identityFromRow(
  row: ThreadCommandAdmissionRow,
): ThreadCommandAdmissionIdentity {
  return threadCommandAdmissionIdentityFromActor({
    threadId: row.threadId,
    requestId: clientTurnRequestIdSchema.parse(row.requestId),
    commandKind: threadCommandKindSchema.parse(row.commandKind),
    requestFingerprint: threadCommandRequestFingerprintSchema.parse(
      row.requestFingerprint,
    ),
    actor: decodeActorStampFromColumns({
      actorPrincipalId: row.actorPrincipalId,
      actorKind: row.actorKind,
      actorDisplayName: row.actorDisplayName,
    }),
  });
}

function encodeResultColumns(
  commandKind: ThreadCommandKind,
  result: ThreadCommandAdmissionResult,
): {
  resultDisposition: ThreadCommandAdmissionDisposition;
  resultEventSequence: number | null;
  resultQueuedMessageId: string | null;
  resultExpectedTurnId: string | null;
  resultInteractionId: string | null;
  resultReadCursor: string | null;
  resultPrUrl: string | null;
  resultPrNumber: number | null;
  resultCommitSha: string | null;
} {
  const parsed = parseThreadCommandAdmissionResultForKind(commandKind, result);
  switch (parsed.disposition) {
    case "started":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: parsed.eventSequence,
        resultQueuedMessageId: null,
        resultExpectedTurnId: null,
        resultInteractionId: null,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "queued":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: null,
        resultQueuedMessageId: parsed.queuedMessageId,
        resultExpectedTurnId: null,
        resultInteractionId: null,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "steered":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: parsed.eventSequence,
        resultQueuedMessageId: null,
        resultExpectedTurnId: parsed.expectedTurnId,
        resultInteractionId: null,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "interrupted":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: parsed.eventSequence,
        resultQueuedMessageId: null,
        resultExpectedTurnId: parsed.expectedTurnId,
        resultInteractionId: null,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "answered":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: null,
        resultQueuedMessageId: null,
        resultExpectedTurnId: null,
        resultInteractionId: parsed.interactionId,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "approved":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: null,
        resultQueuedMessageId: null,
        resultExpectedTurnId: null,
        resultInteractionId: parsed.interactionId,
        resultReadCursor: null,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "marked":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: null,
        resultQueuedMessageId: null,
        resultExpectedTurnId: null,
        resultInteractionId: null,
        resultReadCursor: parsed.readCursor,
        resultPrUrl: null,
        resultPrNumber: null,
        resultCommitSha: null,
      };
    case "published":
      return {
        resultDisposition: parsed.disposition,
        resultEventSequence: null,
        resultQueuedMessageId: null,
        resultExpectedTurnId: null,
        resultInteractionId: null,
        resultReadCursor: null,
        resultPrUrl: parsed.prUrl,
        resultPrNumber: parsed.prNumber,
        resultCommitSha: parsed.commitSha,
      };
    default: {
      const _exhaustive: never = parsed;
      throw new Error(
        `Unexpected thread command admission result disposition: ${String(_exhaustive)}`,
      );
    }
  }
}

function allocateAdmissionSequence(
  tx: DbTransaction,
  threadId: string,
): number {
  const maxSequence =
    tx
      .select({ value: max(threadCommandAdmissions.admissionSequence) })
      .from(threadCommandAdmissions)
      .where(eq(threadCommandAdmissions.threadId, threadId))
      .get()?.value ?? 0;
  return maxSequence + 1;
}

/**
 * Deep read of a durable thread command admission by exact
 * `(threadId, requestId)`. Returns null when no row exists.
 */
export function getThreadCommandAdmission(
  db: DbConnection,
  args: { threadId: string; requestId: string },
): PersistedThreadCommandAdmission | null {
  if (typeof args.threadId !== "string" || args.threadId.length === 0) {
    throw new Error("Invalid thread command admission threadId");
  }
  const requestId = clientTurnRequestIdSchema.parse(args.requestId);
  const row = db
    .select()
    .from(threadCommandAdmissions)
    .where(
      and(
        eq(threadCommandAdmissions.threadId, args.threadId),
        eq(threadCommandAdmissions.requestId, requestId),
      ),
    )
    .get();
  if (row === undefined) {
    return null;
  }
  return decodeAdmissionFromRow(row);
}

function admitThreadCommandInTransaction(
  tx: DbTransaction,
  args: Omit<AdmitThreadCommandArgs, "db">,
): AdmitThreadCommandOutcome {
  const requestedIdentity = threadCommandAdmissionIdentityFromActor({
    threadId: args.threadId,
    requestId: args.requestId,
    commandKind: args.commandKind,
    requestFingerprint: args.requestFingerprint,
    actor: args.actor,
  });

  const existingRow = tx
    .select()
    .from(threadCommandAdmissions)
    .where(
      and(
        eq(threadCommandAdmissions.threadId, args.threadId),
        eq(threadCommandAdmissions.requestId, args.requestId),
      ),
    )
    .get();

  if (existingRow !== undefined) {
    const existingIdentity = identityFromRow(existingRow);
    if (
      threadCommandAdmissionIdentitiesEqual(requestedIdentity, existingIdentity)
    ) {
      return {
        kind: "replayed",
        admission: decodeAdmissionFromRow(existingRow),
      };
    }
    return {
      kind: "identity-conflict",
      existing: existingIdentity,
    };
  }

  const admissionSequence = allocateAdmissionSequence(tx, args.threadId);
  const result = parseThreadCommandAdmissionResultForKind(
    args.commandKind,
    args.execute({ tx, admissionSequence }),
  );
  const actorColumns = encodeActorStampColumns(args.actor);
  const resultColumns = encodeResultColumns(args.commandKind, result);

  tx.insert(threadCommandAdmissions)
    .values({
      threadId: args.threadId,
      requestId: args.requestId,
      commandKind: args.commandKind,
      requestFingerprint: args.requestFingerprint,
      admissionSequence,
      actorPrincipalId: actorColumns.actorPrincipalId,
      actorKind: actorColumns.actorKind,
      actorDisplayName: actorColumns.actorDisplayName,
      ...resultColumns,
      createdAt: args.nowMs,
      completedAt: args.nowMs,
    })
    .run();

  const insertedRow = tx
    .select()
    .from(threadCommandAdmissions)
    .where(
      and(
        eq(threadCommandAdmissions.threadId, args.threadId),
        eq(threadCommandAdmissions.requestId, args.requestId),
      ),
    )
    .get();
  if (insertedRow === undefined) {
    throw new Error("Thread command admission insert did not persist");
  }

  return {
    kind: "accepted",
    admission: decodeAdmissionFromRow(insertedRow),
  };
}

/**
 * Atomically admits a thread command under (threadId, requestId), allocates a
 * per-thread admission sequence, and persists the terminal result from a single
 * execute callback. Identical replays return the original admission; mismatched
 * identity fields fail closed as conflict without running the callback.
 */
export function admitThreadCommand(
  args: AdmitThreadCommandArgs,
): AdmitThreadCommandOutcome {
  assertAdmitThreadCommandArgs(args);

  return args.db.transaction(
    (tx) => admitThreadCommandInTransaction(tx, args),
    { behavior: "immediate" },
  );
}
