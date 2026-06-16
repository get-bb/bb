import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type {
  EnvironmentWorkspaceDisplayKind,
  ReasoningLevel,
  ThreadChangeKind,
  ThreadStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import { resolveEnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbQueryConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  environments,
  pendingInteractions,
  threads,
} from "../schema.js";
import { createThreadId } from "../ids.js";
import {
  createOrderKeyBetween,
} from "./order-keys.js";

type ThreadWriteConnection = DbConnection | DbTransaction;

/**
 * Allowed thread status transitions.
 * Key is the current status, values are the statuses it can transition to.
 */
export const ALLOWED_TRANSITIONS: Record<ThreadStatus, ThreadStatus[]> = {
  created: ["provisioning", "active", "idle", "error"],
  provisioning: ["active", "idle", "error"],
  idle: ["provisioning", "active", "error"],
  active: ["idle", "error"],
  error: ["provisioning", "active", "idle"],
};

export interface CreateThreadInput {
  automationId?: string | null;
  projectId: string;
  environmentId?: string | null;
  providerId: string;
  title?: string | null;
  titleFallback?: string | null;
  status?: ThreadStatus;
  parentThreadId?: string | null;
}

export function createThread(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadInput,
) {
  const now = Date.now();
  const id = createThreadId();
  const thread = db
    .insert(threads)
    .values({
      id,
      projectId: input.projectId,
      environmentId: input.environmentId ?? null,
      automationId: input.automationId ?? null,
      providerId: input.providerId,
      title: input.title ?? null,
      titleFallback: input.titleFallback ?? null,
      status: input.status ?? "created",
      parentThreadId: input.parentThreadId ?? null,
      lastReadAt: now,
      latestAttentionAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifier.notifyThread(id, ["thread-created"], {
    projectId: input.projectId,
  });
  notifier.notifyProject(input.projectId, ["threads-changed"]);
  return thread;
}

export function getThread(db: ThreadWriteConnection, id: string) {
  return db.select().from(threads).where(eq(threads.id, id)).get() ?? null;
}

export interface ListThreadsOptions {
  projectId?: string;
  archived?: boolean;
  parentThreadId?: string;
  /** When true, restrict to child threads. When false, restrict to root threads. */
  hasParent?: boolean;
  limit?: number;
  offset?: number;
}

type ThreadRow = typeof threads.$inferSelect;

export interface ListThreadsForProjectsOptions {
  projectIds: readonly string[];
  archived?: boolean;
}

export interface PinThreadArgs {
  pinnedAt?: number;
  threadId: string;
}

export interface UnpinThreadArgs {
  threadId: string;
}

export interface ReorderPinnedThreadArgs {
  db: DbConnection;
  nextThreadId: string | null;
  notifier: DbNotifier;
  previousThreadId: string | null;
  threadId: string;
}

interface ResolvePinnedThreadNeighborArgs {
  movedThreadId: string;
  neighborThreadId: string | null;
  pinnedThreads: readonly ThreadRow[];
}

interface PinThreadMutationResult {
  changed: boolean;
  thread: ThreadRow;
}

type PinnedThreadRootCandidate = Pick<
  ThreadRow,
  "id" | "parentThreadId"
>;

interface FilterVisiblePinnedThreadRootsArgs<
  TThread extends PinnedThreadRootCandidate,
> {
  pinnedThreads: readonly TThread[];
}

export interface ReorderPinnedThreadSuccess {
  kind: "reordered";
  threads: ThreadRow[];
}

export interface ReorderPinnedThreadUnchanged {
  kind: "unchanged";
  threads: ThreadRow[];
}

export interface ReorderPinnedThreadNotFound {
  kind: "not_found";
}

export interface ReorderPinnedThreadNotPinned {
  kind: "not_pinned";
}

export interface ReorderPinnedThreadStaleNeighbor {
  kind: "stale_neighbor";
}

export interface ReorderPinnedThreadInvalidNeighborOrder {
  kind: "invalid_neighbor_order";
}

export type ReorderPinnedThreadResult =
  | ReorderPinnedThreadSuccess
  | ReorderPinnedThreadUnchanged
  | ReorderPinnedThreadNotFound
  | ReorderPinnedThreadNotPinned
  | ReorderPinnedThreadStaleNeighbor
  | ReorderPinnedThreadInvalidNeighborOrder;

function pinnedThreadWhere() {
  return and(
    isNull(threads.deletedAt),
    isNotNull(threads.pinnedAt),
    isNotNull(threads.pinSortKey),
  );
}

function getFirstPinnedThread(db: DbQueryConnection): ThreadRow | null {
  return (
    db
      .select()
      .from(threads)
      .where(pinnedThreadWhere())
      .orderBy(asc(threads.pinSortKey), asc(threads.id))
      .limit(1)
      .get() ?? null
  );
}

function filterVisiblePinnedThreadRoots<
  TThread extends PinnedThreadRootCandidate,
>({
  pinnedThreads,
}: FilterVisiblePinnedThreadRootsArgs<TThread>): TThread[] {
  const pinnedThreadIds = new Set(pinnedThreads.map((thread) => thread.id));
  return pinnedThreads.filter(
    (thread) =>
      thread.parentThreadId === null ||
      !pinnedThreadIds.has(thread.parentThreadId),
  );
}

export function listActiveVisiblePinnedThreadRoots(
  db: DbQueryConnection,
): ThreadRow[] {
  const pinnedThreads = db
    .select()
    .from(threads)
    .where(and(pinnedThreadWhere(), isNull(threads.archivedAt)))
    .orderBy(asc(threads.pinSortKey), asc(threads.id))
    .all();

  return filterVisiblePinnedThreadRoots({ pinnedThreads });
}

function threadWithPendingInteractionBaseQuery(db: DbConnection) {
  return db
    .select({
      ...getTableColumns(threads),
      environmentBranchName: environments.branchName,
      environmentHostId: environments.hostId,
      environmentIsWorktree: environments.isWorktree,
      environmentName: environments.name,
      environmentWorkspaceProvisionType: environments.workspaceProvisionType,
      pendingInteractionCount: count(pendingInteractions.id),
    })
    .from(threads)
    .leftJoin(environments, eq(threads.environmentId, environments.id))
    .leftJoin(
      pendingInteractions,
      and(
        eq(pendingInteractions.threadId, threads.id),
        eq(pendingInteractions.status, "pending"),
      ),
    );
}

export function listActiveVisiblePinnedThreadRootsWithPendingInteractionState(
  db: DbConnection,
): ThreadWithPendingInteractionState[] {
  const pinnedThreads = threadWithPendingInteractionBaseQuery(db)
    .where(and(pinnedThreadWhere(), isNull(threads.archivedAt)))
    .groupBy(threads.id)
    .orderBy(asc(threads.pinSortKey), asc(threads.id))
    .all()
    .map(toThreadWithPendingInteractionState);

  return filterVisiblePinnedThreadRoots({ pinnedThreads });
}

function resolvePinnedThreadNeighbor(
  args: ResolvePinnedThreadNeighborArgs,
): ThreadRow | null | false {
  if (args.neighborThreadId === null) {
    return null;
  }
  if (args.neighborThreadId === args.movedThreadId) {
    return false;
  }

  return (
    args.pinnedThreads.find((thread) => thread.id === args.neighborThreadId) ??
    false
  );
}

interface InvalidThreadStatusTransitionErrorArgs {
  currentStatus: ThreadStatus;
  newStatus: ThreadStatus;
}

export interface TransitionThreadStatusInTransactionArgs {
  id: string;
  newStatus: ThreadStatus;
}

export class InvalidThreadStatusTransitionError extends Error {
  readonly currentStatus: ThreadStatus;
  readonly newStatus: ThreadStatus;

  constructor(args: InvalidThreadStatusTransitionErrorArgs) {
    super(
      `Invalid thread status transition: ${args.currentStatus} → ${args.newStatus}`,
    );
    this.name = "InvalidThreadStatusTransitionError";
    this.currentStatus = args.currentStatus;
    this.newStatus = args.newStatus;
  }
}

export interface ThreadWithPendingInteractionState extends ThreadRow {
  environmentBranchName: string | null;
  environmentHostId: string | null;
  environmentName: string | null;
  hasPendingInteraction: boolean;
  environmentWorkspaceDisplayKind: EnvironmentWorkspaceDisplayKind;
}

interface ThreadWithPendingInteractionStateRow extends ThreadRow {
  environmentBranchName: string | null;
  environmentHostId: string | null;
  environmentIsWorktree: boolean | null;
  environmentName: string | null;
  environmentWorkspaceProvisionType: WorkspaceProvisionType | null;
  pendingInteractionCount: number;
}

export interface CountLiveThreadsInEnvironmentArgs {
  environmentId: string;
  excludeThreadId?: string;
}

export interface ListLiveThreadsInEnvironmentArgs {
  environmentId: string;
}

export interface CountNonDeletedAssignedChildThreadsArgs {
  parentThreadId: string;
}

export interface ListUnarchivedAssignedChildThreadsArgs {
  parentThreadId: string;
}

export interface ListNonDeletedChildThreadsArgs {
  parentThreadId: string;
}

export interface MarkThreadStopRequestedArgs {
  requestedAt?: number;
  threadId: string;
}

export interface MarkThreadDeletedArgs {
  deletedAt?: number;
  threadId: string;
}

export interface MarkThreadAttentionRequestedArgs {
  threadId: string;
}

export interface ListThreadEnvironmentAssignmentsOnHostArgs {
  hostId: string;
  threadIds: readonly string[];
}

export interface ListHostThreadIdsArgs {
  hostId: string;
}

export interface ListStopRequestedThreadsArgs {
  limit: number;
}

export interface ThreadEnvironmentAssignmentRow {
  environmentId: string;
  threadId: string;
}

export interface StopRequestedThreadRow {
  environmentId: string;
  hostId: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
  threadId: string;
}

export interface HasPendingThreadShutdownInEnvironmentArgs {
  environmentId: string;
}

export interface HasNonTerminalThreadInEnvironmentArgs {
  environmentId: string;
}

const NON_TERMINAL_THREAD_STATUSES: readonly ThreadStatus[] = [
  "created",
  "provisioning",
  "idle",
  "active",
];

interface StatusTransition {
  currentStatus: ThreadStatus;
  newStatus: ThreadStatus;
  parentThreadId: string | null;
}

function statusTransitionNeedsAttention(args: StatusTransition): boolean {
  if (args.currentStatus === "active" && args.newStatus === "idle") {
    return args.parentThreadId === null;
  }

  if (args.newStatus !== "error") {
    return false;
  }

  return (
    args.currentStatus === "active" || args.currentStatus === "provisioning"
  );
}

function buildListThreadsFilters(options: ListThreadsOptions) {
  return [
    options.projectId ? eq(threads.projectId, options.projectId) : undefined,
    isNull(threads.deletedAt),
    options.parentThreadId
      ? eq(threads.parentThreadId, options.parentThreadId)
      : undefined,
    options.archived === true
      ? isNotNull(threads.archivedAt)
      : options.archived === false
        ? isNull(threads.archivedAt)
        : undefined,
    options.hasParent === true
      ? isNotNull(threads.parentThreadId)
      : options.hasParent === false
        ? isNull(threads.parentThreadId)
        : undefined,
  ].filter((value) => value !== undefined);
}

function buildListThreadsForProjectsFilters(
  options: ListThreadsForProjectsOptions,
) {
  return [
    inArray(threads.projectId, [...options.projectIds]),
    isNull(threads.deletedAt),
    options.archived === true
      ? isNotNull(threads.archivedAt)
      : options.archived === false
        ? isNull(threads.archivedAt)
        : undefined,
  ].filter((value) => value !== undefined);
}

// Order archived listings by archive recency so paginated pages show the
// most recently archived rows first.
function buildActiveProjectThreadOrderBy() {
  return [
    asc(threads.projectId),
    ...buildPinnedThreadOrderBy(),
    desc(threads.createdAt),
    desc(threads.id),
  ];
}

function buildPinnedThreadOrderBy() {
  return [
    asc(sql`CASE WHEN ${threads.pinnedAt} IS NOT NULL THEN 0 ELSE 1 END`),
    asc(sql`CASE WHEN ${threads.pinnedAt} IS NOT NULL THEN ${threads.pinSortKey} END`),
    asc(sql`CASE WHEN ${threads.pinnedAt} IS NOT NULL THEN ${threads.id} END`),
  ];
}

function buildListThreadsOrderBy(options: ListThreadsOptions) {
  if (options.archived === true) {
    return [desc(threads.archivedAt), desc(threads.id)];
  }
  return buildActiveProjectThreadOrderBy();
}

function buildListThreadsForProjectsOrderBy(
  options: ListThreadsForProjectsOptions,
) {
  if (options.archived === true) {
    return [desc(threads.archivedAt), desc(threads.id)];
  }
  return buildActiveProjectThreadOrderBy();
}

function toThreadWithPendingInteractionState(
  row: ThreadWithPendingInteractionStateRow,
): ThreadWithPendingInteractionState {
  const {
    environmentIsWorktree,
    environmentWorkspaceProvisionType,
    environmentBranchName,
    environmentHostId,
    environmentName,
    pendingInteractionCount,
    ...thread
  } = row;
  return {
    ...thread,
    environmentBranchName,
    environmentHostId,
    environmentName,
    environmentWorkspaceDisplayKind: resolveEnvironmentWorkspaceDisplayKind({
      environment: {
        isWorktree: environmentIsWorktree,
        workspaceProvisionType: environmentWorkspaceProvisionType,
      },
    }),
    hasPendingInteraction: pendingInteractionCount > 0,
  };
}

export function listThreads(db: DbConnection, options: ListThreadsOptions) {
  let query = db
    .select()
    .from(threads)
    .where(and(...buildListThreadsFilters(options)))
    .orderBy(...buildListThreadsOrderBy(options))
    .$dynamic();
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options.offset !== undefined) {
    query = query.offset(options.offset);
  }
  return query.all();
}

export function listThreadsWithPendingInteractionState(
  db: DbConnection,
  options: ListThreadsOptions,
): ThreadWithPendingInteractionState[] {
  let query = threadWithPendingInteractionBaseQuery(db)
    .where(and(...buildListThreadsFilters(options)))
    .groupBy(threads.id)
    .orderBy(...buildListThreadsOrderBy(options))
    .$dynamic();
  if (options.limit !== undefined) {
    query = query.limit(options.limit);
  }
  if (options.offset !== undefined) {
    query = query.offset(options.offset);
  }
  const rows = query.all();

  return rows.map(toThreadWithPendingInteractionState);
}

export function listThreadsWithPendingInteractionStateForProjects(
  db: DbConnection,
  options: ListThreadsForProjectsOptions,
): ThreadWithPendingInteractionState[] {
  if (options.projectIds.length === 0) {
    return [];
  }

  const rows = threadWithPendingInteractionBaseQuery(db)
    .where(and(...buildListThreadsForProjectsFilters(options)))
    .groupBy(threads.id)
    .orderBy(...buildListThreadsForProjectsOrderBy(options))
    .all();

  return rows.map(toThreadWithPendingInteractionState);
}

export function countLiveThreadsInEnvironment(
  db: ThreadWriteConnection,
  args: CountLiveThreadsInEnvironmentArgs,
): number {
  const liveThreadCount = db
    .select({ count: count() })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        args.excludeThreadId ? ne(threads.id, args.excludeThreadId) : undefined,
      ),
    )
    .get();

  return liveThreadCount?.count ?? 0;
}

export function listLiveThreadsInEnvironment(
  db: ThreadWriteConnection,
  args: ListLiveThreadsInEnvironmentArgs,
): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .orderBy(desc(threads.createdAt))
    .all();
}

export function countNonDeletedAssignedChildThreads(
  db: DbConnection,
  args: CountNonDeletedAssignedChildThreadsArgs,
): number {
  const assignedChildThreadCount = db
    .select({ count: count() })
    .from(threads)
    .where(
      and(
        eq(threads.parentThreadId, args.parentThreadId),
        isNull(threads.deletedAt),
      ),
    )
    .get();

  return assignedChildThreadCount?.count ?? 0;
}

export function listUnarchivedAssignedChildThreads(
  db: ThreadWriteConnection,
  args: ListUnarchivedAssignedChildThreadsArgs,
): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.parentThreadId, args.parentThreadId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .all();
}

export function listNonDeletedChildThreads(
  db: ThreadWriteConnection,
  args: ListNonDeletedChildThreadsArgs,
): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.parentThreadId, args.parentThreadId),
        isNull(threads.deletedAt),
      ),
    )
    .all();
}

export function listThreadEnvironmentAssignmentsOnHost(
  db: DbConnection,
  args: ListThreadEnvironmentAssignmentsOnHostArgs,
): ThreadEnvironmentAssignmentRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  return db
    .select({
      threadId: threads.id,
      environmentId: environments.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        inArray(threads.id, [...args.threadIds]),
        eq(environments.hostId, args.hostId),
      ),
    )
    .all();
}

export function listHostThreadIds(
  db: DbConnection,
  args: ListHostThreadIdsArgs,
): string[] {
  return db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(eq(environments.hostId, args.hostId))
    .all()
    .map((row) => row.id);
}

export function listStopRequestedThreads(
  db: DbConnection,
  args: ListStopRequestedThreadsArgs,
): StopRequestedThreadRow[] {
  return db
    .select({
      environmentId: environments.id,
      hostId: environments.hostId,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
      threadId: threads.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(isNotNull(threads.stopRequestedAt))
    .orderBy(asc(threads.stopRequestedAt), asc(threads.id))
    .limit(args.limit)
    .all();
}

export function hasPendingThreadShutdownInEnvironment(
  db: DbConnection,
  args: HasPendingThreadShutdownInEnvironmentArgs,
): boolean {
  const row = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        isNotNull(threads.stopRequestedAt),
      ),
    )
    .get();

  return row !== undefined;
}

export function hasNonTerminalThreadInEnvironment(
  db: DbConnection,
  args: HasNonTerminalThreadInEnvironmentArgs,
): boolean {
  const row = db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, args.environmentId),
        inArray(threads.status, [...NON_TERMINAL_THREAD_STATUSES]),
        isNull(threads.deletedAt),
      ),
    )
    .get();

  return row !== undefined;
}

export function pinThread(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: PinThreadArgs,
) {
  const result = db.transaction(
    (tx): PinThreadMutationResult | null => {
      const existing =
        tx.select().from(threads).where(eq(threads.id, args.threadId)).get() ??
        null;
      if (!existing || existing.deletedAt !== null) {
        return null;
      }
      if (existing.pinnedAt !== null && existing.pinSortKey !== null) {
        return { changed: false, thread: existing };
      }

      const firstPinnedThread = getFirstPinnedThread(tx);
      const pinSortKey = createOrderKeyBetween({
        previousKey: null,
        nextKey: firstPinnedThread?.pinSortKey ?? null,
      });
      const now = Date.now();
      const updated = tx
        .update(threads)
        .set({
          pinnedAt: args.pinnedAt ?? now,
          pinSortKey,
          updatedAt: now,
        })
        .where(and(eq(threads.id, args.threadId), isNull(threads.deletedAt)))
        .returning()
        .get();
      return updated ? { changed: true, thread: updated } : null;
    },
    { behavior: "immediate" },
  );

  if (result?.changed) {
    notifier.notifyThread(args.threadId, ["pin-state-changed"], {
      projectId: result.thread.projectId,
    });
  }
  return result?.thread ?? null;
}

export function unpinThread(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: UnpinThreadArgs,
) {
  const result = db.transaction(
    (tx): PinThreadMutationResult | null => {
      const existing =
        tx.select().from(threads).where(eq(threads.id, args.threadId)).get() ??
        null;
      if (!existing || existing.deletedAt !== null) {
        return null;
      }
      if (existing.pinnedAt === null && existing.pinSortKey === null) {
        return { changed: false, thread: existing };
      }

      const updated = tx
        .update(threads)
        .set({
          pinnedAt: null,
          pinSortKey: null,
          updatedAt: Date.now(),
        })
        .where(and(eq(threads.id, args.threadId), isNull(threads.deletedAt)))
        .returning()
        .get();
      return updated ? { changed: true, thread: updated } : null;
    },
    { behavior: "immediate" },
  );

  if (result?.changed) {
    notifier.notifyThread(args.threadId, ["pin-state-changed"], {
      projectId: result.thread.projectId,
    });
  }
  return result?.thread ?? null;
}

export function reorderPinnedThread({
  db,
  nextThreadId,
  notifier,
  previousThreadId,
  threadId,
}: ReorderPinnedThreadArgs): ReorderPinnedThreadResult {
  const result = db.transaction(
    (tx): ReorderPinnedThreadResult => {
      const movedThread =
        tx.select().from(threads).where(eq(threads.id, threadId)).get() ?? null;
      if (!movedThread || movedThread.deletedAt !== null) {
        return { kind: "not_found" };
      }
      if (movedThread.pinnedAt === null || movedThread.pinSortKey === null) {
        return { kind: "not_pinned" };
      }

      const currentThreads = listActiveVisiblePinnedThreadRoots(tx);
      const currentIndex = currentThreads.findIndex(
        (thread) => thread.id === threadId,
      );
      if (currentIndex === -1) {
        return { kind: "stale_neighbor" };
      }
      const previousThread = resolvePinnedThreadNeighbor({
        movedThreadId: threadId,
        neighborThreadId: previousThreadId,
        pinnedThreads: currentThreads,
      });
      const nextThread = resolvePinnedThreadNeighbor({
        movedThreadId: threadId,
        neighborThreadId: nextThreadId,
        pinnedThreads: currentThreads,
      });
      if (previousThread === false || nextThread === false) {
        return { kind: "stale_neighbor" };
      }
      if (
        previousThread?.pinSortKey === null ||
        nextThread?.pinSortKey === null
      ) {
        return { kind: "stale_neighbor" };
      }
      if (
        previousThread !== null &&
        nextThread !== null &&
        previousThread.pinSortKey >= nextThread.pinSortKey
      ) {
        return { kind: "invalid_neighbor_order" };
      }

      const currentPreviousThreadId =
        currentThreads[currentIndex - 1]?.id ?? null;
      const currentNextThreadId = currentThreads[currentIndex + 1]?.id ?? null;
      if (
        currentPreviousThreadId === previousThreadId &&
        currentNextThreadId === nextThreadId
      ) {
        return {
          kind: "unchanged",
          threads: currentThreads,
        };
      }

      const pinSortKey = createOrderKeyBetween({
        previousKey: previousThread?.pinSortKey ?? null,
        nextKey: nextThread?.pinSortKey ?? null,
      });
      const updated = tx
        .update(threads)
        .set({ pinSortKey, updatedAt: Date.now() })
        .where(and(eq(threads.id, threadId), pinnedThreadWhere()))
        .returning({ id: threads.id })
        .get();
      if (!updated) {
        return { kind: "stale_neighbor" };
      }

      return {
        kind: "reordered",
        threads: listActiveVisiblePinnedThreadRoots(tx),
      };
    },
    { behavior: "immediate" },
  );

  if (result.kind === "reordered") {
    const reorderedThread = result.threads.find(
      (thread) => thread.id === threadId,
    );
    if (reorderedThread) {
      notifier.notifyThread(threadId, ["pin-state-changed"], {
        projectId: reorderedThread.projectId,
      });
    }
  }
  return result;
}

export interface UpdateThreadInput {
  environmentId?: string | null;
  lastReadAt?: number | null;
  parentThreadId?: string | null;
  title?: string | null;
}

export function updateThread(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  id: string,
  input: UpdateThreadInput,
) {
  const now = Date.now();
  const existing = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!existing) {
    return null;
  }

  const changes: ThreadChangeKind[] = [];
  if ("title" in input) changes.push("title-changed");
  if ("lastReadAt" in input) changes.push("read-state-changed");
  if (
    "parentThreadId" in input &&
    input.parentThreadId !== existing.parentThreadId
  ) {
    changes.push("parent-changed");
  }
  if (
    "environmentId" in input &&
    input.environmentId !== existing.environmentId
  ) {
    changes.push("environment-changed");
  }

  const set: Partial<typeof threads.$inferInsert> = { updatedAt: now };
  if ("title" in input) set.title = input.title;
  if ("environmentId" in input) set.environmentId = input.environmentId;
  if ("lastReadAt" in input) {
    set.lastReadAt = input.lastReadAt;
  }
  if ("parentThreadId" in input) set.parentThreadId = input.parentThreadId;

  const updated = db
    .update(threads)
    .set(set)
    .where(eq(threads.id, id))
    .returning()
    .get();
  if (updated && changes.length > 0) {
    notifier.notifyThread(id, changes, {
      projectId: existing.projectId,
    });
  }
  return updated ?? null;
}

export interface ThreadExecutionOverride {
  modelOverride: string | null;
  reasoningLevelOverride: ReasoningLevel | null;
}

export function getThreadExecutionOverride(
  db: ThreadWriteConnection,
  id: string,
): ThreadExecutionOverride | null {
  const row = db
    .select({
      modelOverride: threads.modelOverride,
      reasoningLevelOverride: threads.reasoningLevelOverride,
    })
    .from(threads)
    .where(eq(threads.id, id))
    .get();
  return row ?? null;
}

export interface SetThreadExecutionOverrideInput {
  threadId: string;
  modelOverride?: string | null;
  reasoningLevelOverride?: ReasoningLevel | null;
}

/**
 * Persists the sticky, thread-level execution override. Presence-sensitive:
 * an omitted field is left unchanged, an explicit `null` clears it. Kept off
 * the generic `updateThread` helper because execution config must not flow
 * through generic metadata updates. No realtime notification is emitted: the
 * override is consumed by the next turn's `resolveExecutionOptions`, and no
 * client surface renders it yet (UI surfacing is a follow-up).
 */
export function setThreadExecutionOverride(
  db: ThreadWriteConnection,
  input: SetThreadExecutionOverrideInput,
) {
  const set: Partial<typeof threads.$inferInsert> = { updatedAt: Date.now() };
  if ("modelOverride" in input) {
    set.modelOverride = input.modelOverride;
  }
  if ("reasoningLevelOverride" in input) {
    set.reasoningLevelOverride = input.reasoningLevelOverride;
  }
  const updated = db
    .update(threads)
    .set(set)
    .where(eq(threads.id, input.threadId))
    .returning()
    .get();
  return updated ?? null;
}

export function markThreadAttentionRequested(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: MarkThreadAttentionRequestedArgs,
) {
  const existing = db
    .select()
    .from(threads)
    .where(eq(threads.id, args.threadId))
    .get();
  if (!existing) {
    return null;
  }

  const now = Date.now();
  if (now <= existing.latestAttentionAt) {
    return existing;
  }

  const updated = db
    .update(threads)
    .set({
      latestAttentionAt: now,
      updatedAt: now,
    })
    .where(eq(threads.id, args.threadId))
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(args.threadId, ["read-state-changed"], {
      projectId: existing.projectId,
    });
  }
  return updated ?? null;
}

export function deleteThread(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  id: string,
) {
  const existing = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!existing) return false;
  db.delete(threads).where(eq(threads.id, id)).run();
  notifier.notifyThread(id, ["thread-deleted"], {
    projectId: existing.projectId,
  });
  notifier.notifyProject(existing.projectId, ["threads-changed"]);
  return true;
}

export function markThreadStopRequested(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: MarkThreadStopRequestedArgs,
) {
  const existing = getThread(db, args.threadId);
  if (!existing) return null;

  const now = Date.now();
  const updated = db
    .update(threads)
    .set({
      stopRequestedAt: existing.stopRequestedAt ?? args.requestedAt ?? now,
      updatedAt: now,
    })
    .where(eq(threads.id, args.threadId))
    .returning()
    .get();

  if (updated) {
    notifier.notifyThread(args.threadId, ["status-changed"], {
      projectId: updated.projectId,
    });
  }

  return updated ?? null;
}

export function clearThreadStopRequested(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  threadId: string,
) {
  const updated = db
    .update(threads)
    .set({
      stopRequestedAt: null,
      updatedAt: Date.now(),
    })
    .where(eq(threads.id, threadId))
    .returning()
    .get();

  if (updated) {
    notifier.notifyThread(threadId, ["status-changed"], {
      projectId: updated.projectId,
    });
  }

  return updated ?? null;
}

export function markThreadDeleted(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  args: MarkThreadDeletedArgs,
) {
  const updated = db
    .update(threads)
    .set({
      deletedAt: args.deletedAt ?? Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(threads.id, args.threadId))
    .returning()
    .get();

  if (updated) {
    notifier.notifyThread(args.threadId, ["thread-deleted"], {
      projectId: updated.projectId,
    });
    notifier.notifyProject(updated.projectId, ["threads-changed"]);
  }

  return updated ?? null;
}

export function archiveThread(
  db: ThreadWriteConnection,
  notifier: DbNotifier,
  id: string,
) {
  const now = Date.now();
  const updated = db
    .update(threads)
    .set({ archivedAt: now, updatedAt: now })
    .where(eq(threads.id, id))
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(id, ["archived-changed"], {
      projectId: updated.projectId,
    });
  }
  return updated ?? null;
}

export function unarchiveThread(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
) {
  const now = Date.now();
  const updated = db
    .update(threads)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(threads.id, id))
    .returning()
    .get();
  if (updated) {
    notifier.notifyThread(id, ["archived-changed"], {
      projectId: updated.projectId,
    });
  }
  return updated ?? null;
}

function transitionThreadStatusRecord(
  db: ThreadWriteConnection,
  id: string,
  newStatus: ThreadStatus,
) {
  const thread = db.select().from(threads).where(eq(threads.id, id)).get();
  if (!thread) {
    throw new Error(`Thread not found: ${id}`);
  }

  const currentStatus = thread.status;
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new InvalidThreadStatusTransitionError({
      currentStatus,
      newStatus,
    });
  }

  const now = Date.now();
  const set: Partial<typeof threads.$inferInsert> = {
    status: newStatus,
    updatedAt: now,
  };
  if (
    statusTransitionNeedsAttention({
      currentStatus,
      newStatus,
      parentThreadId: thread.parentThreadId,
    })
  ) {
    set.latestAttentionAt = now;
  }

  const updated = db
    .update(threads)
    .set(set)
    .where(eq(threads.id, id))
    .returning()
    .get();

  return updated!;
}

export function transitionThreadStatusInTransaction(
  db: DbTransaction,
  args: TransitionThreadStatusInTransactionArgs,
) {
  return transitionThreadStatusRecord(db, args.id, args.newStatus);
}

export function transitionThreadStatus(
  db: DbConnection,
  notifier: DbNotifier,
  id: string,
  newStatus: ThreadStatus,
) {
  const updated = transitionThreadStatusRecord(db, id, newStatus);
  notifier.notifyThread(id, ["status-changed"], {
    projectId: updated.projectId,
  });
  return updated;
}
