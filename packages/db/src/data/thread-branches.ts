import { and, asc, desc, eq, lte } from "drizzle-orm";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadBranchId } from "../ids.js";
import {
  events,
  threadActiveBranches,
  threadBranches,
  threadSourceBranches,
  type ThreadBranchCleanupStatus,
  type ThreadBranchCreationReason,
} from "../schema.js";

export type StoredThreadBranch = typeof threadBranches.$inferSelect;

export interface CreateThreadBranchInput {
  cutoffSequence: number;
  creationReason: ThreadBranchCreationReason;
  parentBranchId?: string | null;
  providerId: string;
  providerThreadId?: string | null;
  threadId: string;
  now?: number;
}

export interface CreateRootThreadBranchInput {
  providerId: string;
  providerThreadId?: string | null;
  threadId: string;
  cutoffSequence?: number;
  now?: number;
}

export interface ActivateThreadBranchInput {
  branchId: string;
  now?: number;
}

export interface ThreadBranchCleanupResultInput {
  branchId: string;
  error?: string | null;
  now?: number;
  status: Exclude<ThreadBranchCleanupStatus, "not-needed" | "pending">;
}

export interface BindThreadBranchProviderSessionInput {
  branchId: string;
  providerThreadId: string;
  now?: number;
}

export interface AbandonThreadBranchInput {
  branchId: string;
  error?: string | null;
  now?: number;
}

export interface InspectThreadBranchesArgs {
  threadId: string;
}

export interface RecordThreadSourceBranchInput {
  branchId: string | null;
  threadId: string;
  now?: number;
}

export interface ThreadBranchInspection {
  active: StoredThreadBranch | null;
  branches: StoredThreadBranch[];
}

/**
 * The branch ids and sequence limits that make up the active conversation
 * projection.  The active branch itself has no upper bound: every event
 * stamped with that branch belongs to the projection.  An ancestor branch is
 * visible only through the sequence at which its child branch was forked.
 *
 * Sequence numbers remain global and monotonic across a rewind, so this is
 * enough to describe a branch tree without copying events or maintaining a
 * second projected-event table.  `null` is deliberately reserved for the
 * active branch's unbounded suffix.
 */
export interface ActiveThreadBranchVisibility {
  branchId: string;
  maxSequence: number | null;
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Thread branch ${field} cannot be empty`);
  }
  return normalized;
}

function requireCutoffSequence(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      "Thread branch cutoffSequence must be a non-negative integer",
    );
  }
  return value;
}

function getBranchForThread(
  db: DbQueryConnection,
  branchId: string,
  threadId: string,
): StoredThreadBranch | null {
  return (
    db
      .select()
      .from(threadBranches)
      .where(
        and(
          eq(threadBranches.id, branchId),
          eq(threadBranches.threadId, threadId),
        ),
      )
      .get() ?? null
  );
}

export function getThreadBranch(
  db: DbQueryConnection,
  branchId: string,
): StoredThreadBranch | null {
  return (
    db
      .select()
      .from(threadBranches)
      .where(eq(threadBranches.id, branchId))
      .get() ?? null
  );
}

export function listThreadBranches(
  db: DbQueryConnection,
  args: InspectThreadBranchesArgs,
): StoredThreadBranch[] {
  return db
    .select()
    .from(threadBranches)
    .where(eq(threadBranches.threadId, args.threadId))
    .orderBy(asc(threadBranches.createdAt), asc(threadBranches.id))
    .all();
}

export function getActiveThreadBranchId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  return (
    db
      .select({ branchId: threadActiveBranches.branchId })
      .from(threadActiveBranches)
      .where(eq(threadActiveBranches.threadId, threadId))
      .get()?.branchId ?? null
  );
}

export function getActiveThreadBranch(
  db: DbQueryConnection,
  threadId: string,
): StoredThreadBranch | null {
  return (
    db
      .select({
        id: threadBranches.id,
        threadId: threadBranches.threadId,
        parentBranchId: threadBranches.parentBranchId,
        cutoffSequence: threadBranches.cutoffSequence,
        providerId: threadBranches.providerId,
        providerThreadId: threadBranches.providerThreadId,
        creationReason: threadBranches.creationReason,
        lifecycle: threadBranches.lifecycle,
        cleanupStatus: threadBranches.cleanupStatus,
        cleanupRequestedAt: threadBranches.cleanupRequestedAt,
        cleanupCompletedAt: threadBranches.cleanupCompletedAt,
        cleanupError: threadBranches.cleanupError,
        createdAt: threadBranches.createdAt,
        activatedAt: threadBranches.activatedAt,
        deactivatedAt: threadBranches.deactivatedAt,
        updatedAt: threadBranches.updatedAt,
      })
      .from(threadActiveBranches)
      .innerJoin(
        threadBranches,
        eq(threadBranches.id, threadActiveBranches.branchId),
      )
      .where(eq(threadActiveBranches.threadId, threadId))
      .get() ?? null
  );
}

/**
 * Return the active branch followed by its immutable parent lineage.
 *
 * A parent pointer is expected to stay within the same thread because branch
 * creation validates that invariant.  The visited set is still defensive:
 * a malformed imported database must not make a read loop forever.
 */
export function listActiveThreadBranchVisibility(
  db: DbQueryConnection,
  threadId: string,
): ActiveThreadBranchVisibility[] {
  const active = getActiveThreadBranch(db, threadId);
  if (active === null) {
    return [];
  }

  const visibility: ActiveThreadBranchVisibility[] = [];
  const visited = new Set<string>();
  let branch: StoredThreadBranch | null = active;
  let maxSequence: number | null = null;

  while (branch !== null && !visited.has(branch.id)) {
    visited.add(branch.id);
    visibility.push({ branchId: branch.id, maxSequence });

    if (branch.parentBranchId === null) {
      break;
    }

    maxSequence =
      maxSequence === null
        ? branch.cutoffSequence
        : Math.min(maxSequence, branch.cutoffSequence);
    branch = getThreadBranch(db, branch.parentBranchId);
  }

  return visibility;
}

/**
 * Resolve the branch that produced the source timeline at a fork cutoff.
 *
 * Sequence numbers stay monotonic across branch switches, so the event at or
 * immediately before a requested source sequence is the durable provenance
 * anchor. Returning null for a missing or legacy-un-stamped event is
 * intentional: callers must not silently claim that the current active branch
 * produced an older source point.
 */
export function getThreadBranchIdAtOrBeforeSequence(
  db: DbQueryConnection,
  args: { sequence: number; threadId: string },
): string | null {
  if (!Number.isInteger(args.sequence) || args.sequence < 0) {
    throw new Error(
      "Thread source sequence must be a non-negative integer",
    );
  }
  return (
    db
      .select({ branchId: events.branchId })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          lte(events.sequence, args.sequence),
        ),
      )
      .orderBy(desc(events.sequence))
      .get()?.branchId ?? null
  );
}

export function getThreadSourceBranchId(
  db: DbQueryConnection,
  threadId: string,
): string | null {
  return (
    db
      .select({ branchId: threadSourceBranches.branchId })
      .from(threadSourceBranches)
      .where(eq(threadSourceBranches.threadId, threadId))
      .get()?.branchId ?? null
  );
}

export function recordThreadSourceBranchInTransaction(
  db: DbTransaction,
  input: RecordThreadSourceBranchInput,
): void {
  const now = input.now ?? Date.now();
  db.insert(threadSourceBranches)
    .values({
      threadId: requireNonEmpty(input.threadId, "source thread reference"),
      branchId: input.branchId?.trim() || null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadSourceBranches.threadId,
      set: { branchId: input.branchId?.trim() || null, updatedAt: now },
    })
    .run();
}

export function inspectThreadBranches(
  db: DbQueryConnection,
  args: InspectThreadBranchesArgs,
): ThreadBranchInspection {
  return {
    active: getActiveThreadBranch(db, args.threadId),
    branches: listThreadBranches(db, args),
  };
}

/**
 * Insert a branch without changing the active pointer. This is the durable
 * staging boundary for provider-native forks: the caller can record the
 * provider session and then activate it in the same DB transaction only after
 * the provider confirms the branch exists.
 */
export function createThreadBranchInTransaction(
  db: DbTransaction,
  input: CreateThreadBranchInput,
): StoredThreadBranch {
  const threadId = requireNonEmpty(input.threadId, "threadId");
  const providerId = requireNonEmpty(input.providerId, "providerId");
  const parentBranchId = input.parentBranchId?.trim() || null;
  const cutoffSequence = requireCutoffSequence(input.cutoffSequence);
  const providerThreadId = input.providerThreadId?.trim() || null;
  const now = input.now ?? Date.now();

  if (parentBranchId !== null) {
    const parent = getBranchForThread(db, parentBranchId, threadId);
    if (parent === null) {
      throw new Error("Thread branch parent must belong to the same thread");
    }
  }

  const branch = db
    .insert(threadBranches)
    .values({
      id: createThreadBranchId(),
      threadId,
      parentBranchId,
      cutoffSequence,
      providerId,
      providerThreadId,
      creationReason: input.creationReason,
      lifecycle: "staged",
      cleanupStatus: providerThreadId === null ? "not-needed" : "pending",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return branch;
}

/**
 * Ensure a newly-created or migrated thread has one active root branch. This
 * function is idempotent so thread restart/retry cannot create duplicate roots.
 */
export function createRootThreadBranchInTransaction(
  db: DbTransaction,
  input: CreateRootThreadBranchInput,
): StoredThreadBranch {
  const existing = getActiveThreadBranch(db, input.threadId);
  if (existing !== null) {
    return existing;
  }

  const now = input.now ?? Date.now();
  const branch = db
    .insert(threadBranches)
    .values({
      id: createThreadBranchId(),
      threadId: requireNonEmpty(input.threadId, "threadId"),
      parentBranchId: null,
      cutoffSequence: requireCutoffSequence(input.cutoffSequence ?? 0),
      providerId: requireNonEmpty(input.providerId, "providerId"),
      providerThreadId: input.providerThreadId?.trim() || null,
      creationReason: "thread-start",
      lifecycle: "active",
      cleanupStatus: "not-needed",
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  db.insert(threadActiveBranches)
    .values({ threadId: branch.threadId, branchId: branch.id, updatedAt: now })
    .onConflictDoUpdate({
      target: threadActiveBranches.threadId,
      set: { branchId: branch.id, updatedAt: now },
    })
    .run();
  return branch;
}

/**
 * Bind the provider session returned by a native branch operation to a
 * durable staged branch. Keeping this separate from activation lets restart
 * reconciliation finish a provider-first rewind without creating a second
 * provider session.
 */
export function bindThreadBranchProviderSessionInTransaction(
  db: DbTransaction,
  input: BindThreadBranchProviderSessionInput,
): StoredThreadBranch {
  const branch = getThreadBranch(db, input.branchId);
  if (branch === null) {
    throw new Error("Thread branch not found");
  }
  if (branch.lifecycle !== "staged") {
    throw new Error("Only staged thread branches can bind a provider session");
  }
  const providerThreadId = requireNonEmpty(
    input.providerThreadId,
    "providerThreadId",
  );
  const now = input.now ?? Date.now();
  db.update(threadBranches)
    .set({
      providerThreadId,
      cleanupStatus: "pending",
      cleanupRequestedAt: null,
      cleanupCompletedAt: null,
      cleanupError: null,
      updatedAt: now,
    })
    .where(eq(threadBranches.id, branch.id))
    .run();
  return getThreadBranch(db, branch.id) ?? branch;
}

/**
 * Mark a staged provider branch abandoned without ever moving the active
 * pointer. Provider-backed rows remain cleanup-pending so a later maintenance
 * pass can retry provider cleanup after a server crash.
 */
export function abandonThreadBranchInTransaction(
  db: DbTransaction,
  input: AbandonThreadBranchInput,
): StoredThreadBranch {
  const branch = getThreadBranch(db, input.branchId);
  if (branch === null) {
    throw new Error("Thread branch not found");
  }
  if (getActiveThreadBranchId(db, branch.threadId) === branch.id) {
    throw new Error("Cannot abandon the active thread branch");
  }
  if (branch.lifecycle === "abandoned") return branch;
  const now = input.now ?? Date.now();
  db.update(threadBranches)
    .set({
      lifecycle: "abandoned",
      cleanupStatus:
        branch.providerThreadId === null ? "not-needed" : "pending",
      cleanupRequestedAt:
        branch.providerThreadId === null ? null : (branch.cleanupRequestedAt ?? now),
      cleanupCompletedAt: null,
      cleanupError: input.error ?? null,
      updatedAt: now,
    })
    .where(eq(threadBranches.id, branch.id))
    .run();
  return getThreadBranch(db, branch.id) ?? branch;
}

function activateThreadBranchInTransaction(
  db: DbTransaction,
  input: ActivateThreadBranchInput,
): StoredThreadBranch {
  const branchId = requireNonEmpty(input.branchId, "branchId");
  const branch = getThreadBranch(db, branchId);
  if (branch === null) {
    throw new Error("Thread branch not found");
  }
  if (branch.lifecycle === "abandoned") {
    throw new Error("Cannot activate an abandoned thread branch");
  }

  const now = input.now ?? Date.now();
  const previous = getActiveThreadBranch(db, branch.threadId);
  if (previous?.id !== branch.id) {
    if (previous !== null) {
      db.update(threadBranches)
        .set({
          lifecycle: "available",
          deactivatedAt: now,
          updatedAt: now,
        })
        .where(eq(threadBranches.id, previous.id))
        .run();
    }
    db.update(threadBranches)
      .set({
        lifecycle: "active",
        activatedAt: branch.activatedAt ?? now,
        deactivatedAt: null,
        cleanupStatus: "not-needed",
        cleanupRequestedAt: null,
        cleanupCompletedAt: null,
        cleanupError: null,
        updatedAt: now,
      })
      .where(eq(threadBranches.id, branch.id))
      .run();
    db.insert(threadActiveBranches)
      .values({
        threadId: branch.threadId,
        branchId: branch.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: threadActiveBranches.threadId,
        set: { branchId: branch.id, updatedAt: now },
      })
      .run();
  }

  const activated = getThreadBranch(db, branch.id);
  if (activated === null) {
    throw new Error("Activated thread branch disappeared");
  }
  return activated;
}

export function activateThreadBranch(
  db: DbConnection,
  input: ActivateThreadBranchInput,
): StoredThreadBranch {
  return db.transaction((tx) => activateThreadBranchInTransaction(tx, input), {
    behavior: "immediate",
  });
}

export const restoreThreadBranch = activateThreadBranch;
export const restoreThreadBranchInTransaction =
  activateThreadBranchInTransaction;

export function stageThreadBranch(
  db: DbConnection,
  input: CreateThreadBranchInput,
): StoredThreadBranch {
  return db.transaction((tx) => createThreadBranchInTransaction(tx, input), {
    behavior: "immediate",
  });
}

export function markThreadBranchCleanupPendingInTransaction(
  db: DbTransaction,
  args: { branchId: string; now?: number; error?: string | null },
): StoredThreadBranch {
  const branch = getThreadBranch(db, args.branchId);
  if (branch === null) {
    throw new Error("Thread branch not found");
  }
  if (getActiveThreadBranchId(db, branch.threadId) === branch.id) {
    throw new Error("Cannot clean up the active thread branch");
  }
  const now = args.now ?? Date.now();
  db.update(threadBranches)
    .set({
      cleanupStatus: "pending",
      cleanupRequestedAt: now,
      cleanupCompletedAt: null,
      cleanupError: args.error ?? null,
      updatedAt: now,
    })
    .where(eq(threadBranches.id, branch.id))
    .run();
  return getThreadBranch(db, branch.id) ?? branch;
}

export function recordThreadBranchCleanupResultInTransaction(
  db: DbTransaction,
  args: ThreadBranchCleanupResultInput,
): StoredThreadBranch {
  const branch = getThreadBranch(db, args.branchId);
  if (branch === null) {
    throw new Error("Thread branch not found");
  }
  if (getActiveThreadBranchId(db, branch.threadId) === branch.id) {
    throw new Error("Cannot clean up the active thread branch");
  }
  const now = args.now ?? Date.now();
  db.update(threadBranches)
    .set({
      cleanupStatus: args.status,
      cleanupCompletedAt: args.status === "completed" ? now : null,
      cleanupError: args.error ?? null,
      updatedAt: now,
    })
    .where(eq(threadBranches.id, branch.id))
    .run();
  return getThreadBranch(db, branch.id) ?? branch;
}

export function updateThreadBranchCleanupResult(
  db: DbConnection,
  args: ThreadBranchCleanupResultInput,
): StoredThreadBranch {
  return db.transaction(
    (tx) => recordThreadBranchCleanupResultInTransaction(tx, args),
    { behavior: "immediate" },
  );
}

export function listPendingThreadBranchCleanup(
  db: DbQueryConnection,
): StoredThreadBranch[] {
  return db
    .select()
    .from(threadBranches)
    .where(eq(threadBranches.cleanupStatus, "pending"))
    .orderBy(asc(threadBranches.cleanupRequestedAt), asc(threadBranches.id))
    .all();
}

export function listStagedThreadBranches(
  db: DbQueryConnection,
): StoredThreadBranch[] {
  return db
    .select()
    .from(threadBranches)
    .where(eq(threadBranches.lifecycle, "staged"))
    .orderBy(asc(threadBranches.createdAt), asc(threadBranches.id))
    .all();
}

export { activateThreadBranchInTransaction };
