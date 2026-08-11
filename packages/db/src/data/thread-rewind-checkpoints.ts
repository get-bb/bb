import { and, asc, eq } from "drizzle-orm";
import {
  threadRewindAnchorKindSchema,
  threadRewindProviderAnchorSchema,
  threadRewindProviderSchema,
  type ThreadRewindProviderAnchor,
} from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import { createThreadRewindCheckpointId } from "../ids.js";
import { threadRewindCheckpoints } from "../schema.js";

export interface CreateThreadRewindCheckpointInput {
  anchor: ThreadRewindProviderAnchor;
  branchId: string;
  createdAt?: number;
  providerThreadId: string;
  sourceSequence: number;
  threadId: string;
  turnId: string;
}

export interface StoredThreadRewindCheckpoint {
  anchor: ThreadRewindProviderAnchor | null;
  anchorKind: string;
  anchorValue: string;
  branchId: string;
  createdAt: number;
  id: string;
  providerId: string;
  providerThreadId: string;
  sourceSequence: number;
  status: "eligible" | "ambiguous";
  threadId: string;
  turnId: string;
  updatedAt: number;
}

export interface GetThreadRewindCheckpointArgs {
  branchId: string;
  sourceSequence: number;
  threadId: string;
}

export interface ListThreadRewindCheckpointsArgs {
  branchId: string;
  threadId: string;
}

export type UpsertThreadRewindCheckpointResult =
  | {
      checkpoint: StoredThreadRewindCheckpoint;
      outcome: "created" | "existing";
    }
  | {
      checkpoint: StoredThreadRewindCheckpoint;
      outcome: "ambiguous";
    };

export type ResolveThreadRewindCheckpointResult =
  | {
      checkpoint: StoredThreadRewindCheckpoint;
      outcome: "eligible";
    }
  | {
      outcome: "ineligible";
      reason: "ambiguous-provider-checkpoint" | "missing-provider-checkpoint";
    };

interface StoredThreadRewindCheckpointRow {
  anchorKind: string;
  anchorValue: string;
  branchId: string;
  createdAt: number;
  id: string;
  providerId: string;
  providerThreadId: string;
  sourceSequence: number;
  status: "eligible" | "ambiguous";
  threadId: string;
  turnId: string;
  updatedAt: number;
}

const checkpointColumns = {
  anchorKind: threadRewindCheckpoints.anchorKind,
  anchorValue: threadRewindCheckpoints.anchorValue,
  branchId: threadRewindCheckpoints.branchId,
  createdAt: threadRewindCheckpoints.createdAt,
  id: threadRewindCheckpoints.id,
  providerId: threadRewindCheckpoints.providerId,
  providerThreadId: threadRewindCheckpoints.providerThreadId,
  sourceSequence: threadRewindCheckpoints.sourceSequence,
  status: threadRewindCheckpoints.status,
  threadId: threadRewindCheckpoints.threadId,
  turnId: threadRewindCheckpoints.turnId,
  updatedAt: threadRewindCheckpoints.updatedAt,
};

function anchorParts(anchor: ThreadRewindProviderAnchor): {
  anchorKind: "codex-turn-id" | "claude-message-id";
  anchorValue: string;
  providerId: "codex" | "claude-code";
} {
  if (anchor.provider === "codex") {
    return {
      anchorKind: "codex-turn-id",
      anchorValue: anchor.turnId,
      providerId: anchor.provider,
    };
  }
  return {
    anchorKind: "claude-message-id",
    anchorValue: anchor.messageId,
    providerId: anchor.provider,
  };
}

function parseAnchor(
  row: Pick<
    StoredThreadRewindCheckpointRow,
    "anchorKind" | "anchorValue" | "providerId"
  >,
): ThreadRewindProviderAnchor | null {
  const providerResult = threadRewindProviderSchema.safeParse(row.providerId);
  const kindResult = threadRewindAnchorKindSchema.safeParse(row.anchorKind);
  if (!providerResult.success || !kindResult.success) {
    return null;
  }

  const candidate =
    kindResult.data === "codex-turn-id"
      ? { provider: providerResult.data, turnId: row.anchorValue }
      : { messageId: row.anchorValue, provider: providerResult.data };
  const anchorResult = threadRewindProviderAnchorSchema.safeParse(candidate);
  if (!anchorResult.success) {
    return null;
  }
  return anchorResult.data;
}

function toStoredCheckpoint(
  row: StoredThreadRewindCheckpointRow,
): StoredThreadRewindCheckpoint {
  return {
    ...row,
    // SQLite does not enforce the text enum at the database boundary. Treat
    // any value written by an older/corrupt client as ambiguous so callers
    // cannot branch from a checkpoint whose status is not proven eligible.
    status:
      row.status === "eligible" || row.status === "ambiguous"
        ? row.status
        : "ambiguous",
    anchor: parseAnchor(row),
  };
}

function getStoredCheckpointRow(
  db: DbQueryConnection,
  args: GetThreadRewindCheckpointArgs,
): StoredThreadRewindCheckpointRow | null {
  return (
    db
      .select(checkpointColumns)
      .from(threadRewindCheckpoints)
      .where(
        and(
          eq(threadRewindCheckpoints.threadId, args.threadId),
          eq(threadRewindCheckpoints.branchId, args.branchId),
          eq(threadRewindCheckpoints.sourceSequence, args.sourceSequence),
        ),
      )
      .get() ?? null
  );
}

export function getThreadRewindCheckpoint(
  db: DbQueryConnection,
  args: GetThreadRewindCheckpointArgs,
): StoredThreadRewindCheckpoint | null {
  const row = getStoredCheckpointRow(db, args);
  return row === null ? null : toStoredCheckpoint(row);
}

export function listThreadRewindCheckpoints(
  db: DbQueryConnection,
  args: ListThreadRewindCheckpointsArgs,
): StoredThreadRewindCheckpoint[] {
  return db
    .select(checkpointColumns)
    .from(threadRewindCheckpoints)
    .where(
      and(
        eq(threadRewindCheckpoints.threadId, args.threadId),
        eq(threadRewindCheckpoints.branchId, args.branchId),
      ),
    )
    .orderBy(asc(threadRewindCheckpoints.sourceSequence))
    .all()
    .map(toStoredCheckpoint);
}

export function upsertThreadRewindCheckpoint(
  db: DbQueryConnection,
  input: CreateThreadRewindCheckpointInput,
): UpsertThreadRewindCheckpointResult {
  const branchId = input.branchId.trim();
  const providerThreadId = input.providerThreadId.trim();
  const threadId = input.threadId.trim();
  const turnId = input.turnId.trim();
  if (
    branchId.length === 0 ||
    providerThreadId.length === 0 ||
    threadId.length === 0 ||
    turnId.length === 0
  ) {
    throw new Error("Thread rewind checkpoint identity fields cannot be empty");
  }
  if (!Number.isInteger(input.sourceSequence) || input.sourceSequence < 0) {
    throw new Error(
      "Thread rewind checkpoint sourceSequence must be non-negative",
    );
  }

  const anchor = threadRewindProviderAnchorSchema.parse(input.anchor);
  const parts = anchorParts(anchor);
  const createdAt = input.createdAt ?? Date.now();
  const insertResult = db
    .insert(threadRewindCheckpoints)
    .values({
      id: createThreadRewindCheckpointId(),
      threadId,
      branchId,
      providerId: parts.providerId,
      providerThreadId,
      anchorKind: parts.anchorKind,
      anchorValue: parts.anchorValue,
      turnId,
      sourceSequence: input.sourceSequence,
      status: "eligible",
      createdAt,
      updatedAt: createdAt,
    })
    .onConflictDoNothing({
      target: [
        threadRewindCheckpoints.threadId,
        threadRewindCheckpoints.branchId,
        threadRewindCheckpoints.sourceSequence,
      ],
    })
    .run();

  const row = getStoredCheckpointRow(db, {
    branchId,
    sourceSequence: input.sourceSequence,
    threadId,
  });
  if (row === null) {
    throw new Error("Thread rewind checkpoint was not persisted");
  }

  const existing = toStoredCheckpoint(row);
  const matches =
    existing.status === "eligible" &&
    existing.anchor !== null &&
    existing.branchId === branchId &&
    existing.providerId === parts.providerId &&
    existing.providerThreadId === providerThreadId &&
    existing.anchorKind === parts.anchorKind &&
    existing.anchorValue === parts.anchorValue &&
    existing.turnId === turnId;
  if (matches) {
    return {
      checkpoint: existing,
      outcome: insertResult.changes > 0 ? "created" : "existing",
    };
  }

  const updatedAt = Date.now();
  if (existing.status !== "ambiguous") {
    db.update(threadRewindCheckpoints)
      .set({ status: "ambiguous", updatedAt })
      .where(eq(threadRewindCheckpoints.id, existing.id))
      .run();
  }

  return {
    checkpoint:
      existing.status === "ambiguous"
        ? existing
        : {
            ...existing,
            status: "ambiguous",
            updatedAt,
          },
    outcome: "ambiguous",
  };
}

export function resolveThreadRewindCheckpoint(
  db: DbQueryConnection,
  args: GetThreadRewindCheckpointArgs,
): ResolveThreadRewindCheckpointResult {
  const checkpoint = getThreadRewindCheckpoint(db, args);
  if (checkpoint === null) {
    return { outcome: "ineligible", reason: "missing-provider-checkpoint" };
  }
  if (checkpoint.status === "ambiguous" || checkpoint.anchor === null) {
    return {
      outcome: "ineligible",
      reason: "ambiguous-provider-checkpoint",
    };
  }
  return { checkpoint, outcome: "eligible" };
}
