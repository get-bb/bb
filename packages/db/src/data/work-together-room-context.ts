import { and, desc, eq, max } from "drizzle-orm";

import type { DbConnection, DbQueryConnection } from "../connection.js";
import {
  workTogetherRoomContextApplies,
  workTogetherRoomStreamContexts,
} from "../schema.js";

const DIGEST = /^[a-f0-9]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type WorkTogetherRoomContext = Readonly<{
  version: number;
  digest: string;
}>;

export type PersistedWorkTogetherRoomContextApply = Readonly<{
  bindingId: string;
  requestId: string;
  contextVersion: number;
  digest: string;
  bytes: Buffer;
  admissionSequence: number;
  createdAt: number;
  completedAt: number;
}>;

export type AdmitWorkTogetherRoomContextOutcome =
  | Readonly<{ kind: "accepted"; apply: PersistedWorkTogetherRoomContextApply }>
  | Readonly<{ kind: "replayed"; apply: PersistedWorkTogetherRoomContextApply }>
  | Readonly<{ kind: "conflict" }>;

function assertInput(input: {
  bindingId: string;
  requestId: string;
  contextVersion: number;
  digest: string;
  bytes: Uint8Array;
  nowMs: number;
}): void {
  if (!UUID.test(input.bindingId) || input.requestId.length === 0) {
    throw new TypeError("Invalid Work Together Room context identity");
  }
  if (
    !Number.isSafeInteger(input.contextVersion) ||
    input.contextVersion < 1 ||
    !DIGEST.test(input.digest) ||
    input.bytes.byteLength > 131_072 ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0
  ) {
    throw new TypeError("Invalid Work Together Room context apply");
  }
}

function toPersisted(
  row: typeof workTogetherRoomContextApplies.$inferSelect,
): PersistedWorkTogetherRoomContextApply {
  return Object.freeze({
    bindingId: row.bindingId,
    requestId: row.requestId,
    contextVersion: row.contextVersion,
    digest: row.digest,
    bytes: Buffer.from(row.bytes),
    admissionSequence: row.admissionSequence,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
}

export function getWorkTogetherRoomContext(
  db: DbQueryConnection,
  bindingId: string,
): WorkTogetherRoomContext | null {
  if (!UUID.test(bindingId)) {
    throw new TypeError("Invalid Work Together Room binding");
  }
  const row = db
    .select({
      contextVersion: workTogetherRoomContextApplies.contextVersion,
      digest: workTogetherRoomContextApplies.digest,
    })
    .from(workTogetherRoomContextApplies)
    .where(eq(workTogetherRoomContextApplies.bindingId, bindingId))
    .orderBy(desc(workTogetherRoomContextApplies.contextVersion))
    .limit(1)
    .get();
  return row === undefined
    ? null
    : Object.freeze({ version: row.contextVersion, digest: row.digest });
}

/**
 * Atomically creates a versioned opaque envelope receipt. Exact request
 * replays return the persisted receipt; every other request-id or version
 * collision fails closed without changing the current context.
 */
export function admitWorkTogetherRoomContext(
  db: DbConnection,
  input: {
    bindingId: string;
    requestId: string;
    contextVersion: number;
    digest: string;
    bytes: Uint8Array;
    nowMs: number;
  },
): AdmitWorkTogetherRoomContextOutcome {
  assertInput(input);
  const bytes = Buffer.from(input.bytes);
  return db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(workTogetherRoomContextApplies)
        .where(
          and(
            eq(workTogetherRoomContextApplies.bindingId, input.bindingId),
            eq(workTogetherRoomContextApplies.requestId, input.requestId),
          ),
        )
        .get();
      if (existing !== undefined) {
        const exact =
          existing.contextVersion === input.contextVersion &&
          existing.digest === input.digest &&
          Buffer.from(existing.bytes).equals(bytes);
        return exact
          ? Object.freeze({ kind: "replayed" as const, apply: toPersisted(existing) })
          : Object.freeze({ kind: "conflict" as const });
      }

      const current = tx
        .select({
          version: max(workTogetherRoomContextApplies.contextVersion),
          sequence: max(workTogetherRoomContextApplies.admissionSequence),
        })
        .from(workTogetherRoomContextApplies)
        .where(eq(workTogetherRoomContextApplies.bindingId, input.bindingId))
        .get();
      const currentVersion = current?.version ?? null;
      if (currentVersion !== null && input.contextVersion <= currentVersion) {
        return Object.freeze({ kind: "conflict" as const });
      }
      const admissionSequence = (current?.sequence ?? 0) + 1;
      tx.insert(workTogetherRoomContextApplies)
        .values({
          bindingId: input.bindingId,
          requestId: input.requestId,
          contextVersion: input.contextVersion,
          digest: input.digest,
          bytes,
          admissionSequence,
          createdAt: input.nowMs,
          completedAt: input.nowMs,
        })
        .run();
      const inserted = tx
        .select()
        .from(workTogetherRoomContextApplies)
        .where(
          and(
            eq(workTogetherRoomContextApplies.bindingId, input.bindingId),
            eq(workTogetherRoomContextApplies.requestId, input.requestId),
          ),
        )
        .get();
      if (inserted === undefined) {
        throw new Error("Room context apply did not persist");
      }
      return Object.freeze({ kind: "accepted" as const, apply: toPersisted(inserted) });
    },
    { behavior: "immediate" },
  );
}

/** Capture the then-current pair once for a new Room child, before it can run. */
export function inheritWorkTogetherRoomContextForChild(
  db: DbConnection,
  input: { bindingId: string; threadId: string; nowMs: number },
): WorkTogetherRoomContext | null {
  if (!UUID.test(input.bindingId) || input.threadId.length === 0) {
    throw new TypeError("Invalid Work Together Room child context identity");
  }
  const current = getWorkTogetherRoomContext(db, input.bindingId);
  if (current === null) return null;
  db.insert(workTogetherRoomStreamContexts)
    .values({
      bindingId: input.bindingId,
      threadId: input.threadId,
      contextVersion: current.version,
      digest: current.digest,
      createdAt: input.nowMs,
    })
    .run();
  return current;
}
