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
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
  ThreadStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import {
  evaluateThreadLifecycleEvent,
  resolveEnvironmentWorkspaceDisplayKind,
} from "@bb/domain";
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

export interface CreateThreadInput {
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
      providerId: input.providerId,
      title: input.title ?? null,
      titleFallback: input.titleFallback ?? null,
      status: input.status ?? "starting",
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

export interface ListTrackedThreadStorageTargetsOnHostArgs {
  hostId: string;
}

export interface ThreadEnvironmentAssignmentRow {
  environmentId: string;
  threadId: string;
}

export interface HasPendingThreadShutdownInEnvironmentArgs {
  environmentId: string;
}

export interface HasNonTerminalThreadInEnvironmentArgs {
  environmentId: string;
}

const NON_TERMINAL_THREAD_STATUSES: readonly ThreadStatus[] = [
  "starting",
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
    args.currentStatus === "active" || args.currentStatus === "starting"
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

/**
 * Threads whose storage the daemon should track for a host. Archived
 * and deleted thread storage can be reaped, so those rows must not trigger
 * reprime work.
 */
export function listTrackedThreadStorageTargetsOnHost(
  db: DbConnection,
  args: ListTrackedThreadStorageTargetsOnHostArgs,
): ThreadEnvironmentAssignmentRow[] {
  return db
    .select({
      threadId: threads.id,
      environmentId: environments.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        ne(environments.status, "destroyed"),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
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
        eq(threads.status, "stopping"),
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

export type ApplyThreadLifecycleEventNoopReason =
  | ThreadLifecycleNoopReason
  | "not-found"
  | "cas-conflict";

export type ApplyThreadLifecycleEventOutcome =
  | { applied: true; thread: ThreadRow }
  | {
      applied: false;
      detail: string;
      reason: ApplyThreadLifecycleEventNoopReason;
    };

export interface ApplyThreadLifecycleEventArgs {
  event: ThreadLifecycleEvent;
  threadId: string;
}

interface ThreadLifecycleEventNotAppliedErrorArgs {
  detail: string;
  reason: ApplyThreadLifecycleEventNoopReason;
}

export class ThreadLifecycleEventNotAppliedError extends Error {
  readonly detail: string;
  readonly reason: ApplyThreadLifecycleEventNoopReason;

  constructor(args: ThreadLifecycleEventNotAppliedErrorArgs) {
    super(`Thread lifecycle event not applied (${args.reason}): ${args.detail}`);
    this.name = "ThreadLifecycleEventNotAppliedError";
    this.detail = args.detail;
    this.reason = args.reason;
  }
}

/**
 * For boundary callers where a no-op outcome is a real error (e.g. a 4xx
 * response): returns the updated row, or throws
 * ThreadLifecycleEventNotAppliedError.
 */
export function requireThreadLifecycleEventApplied(
  outcome: ApplyThreadLifecycleEventOutcome,
) {
  if (!outcome.applied) {
    throw new ThreadLifecycleEventNotAppliedError(outcome);
  }
  return outcome.thread;
}

function applyThreadLifecycleEventRecord(
  db: ThreadWriteConnection,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const thread = db
    .select()
    .from(threads)
    .where(eq(threads.id, args.threadId))
    .get();
  if (!thread) {
    return {
      applied: false,
      detail: `thread not found: ${args.threadId}`,
      reason: "not-found",
    };
  }

  const evaluation = evaluateThreadLifecycleEvent({
    event: args.event,
    thread,
  });
  if ("noop" in evaluation) {
    return {
      applied: false,
      detail: evaluation.detail,
      reason: evaluation.noop,
    };
  }

  const now = Date.now();
  const set: Partial<typeof threads.$inferInsert> = {
    status: evaluation.to,
    updatedAt: now,
  };
  if (
    statusTransitionNeedsAttention({
      currentStatus: thread.status,
      newStatus: evaluation.to,
      parentThreadId: thread.parentThreadId,
    })
  ) {
    set.latestAttentionAt = now;
  }

  // Compare-and-set on the loaded status: belt-and-braces under
  // better-sqlite3's synchronous transactions, and the contract that survives
  // any future executor change.
  const updated = db
    .update(threads)
    .set(set)
    .where(
      and(eq(threads.id, args.threadId), eq(threads.status, thread.status)),
    )
    .returning()
    .get();
  if (!updated) {
    return {
      applied: false,
      detail: `status changed from ${thread.status} while applying ${args.event.type}`,
      reason: "cas-conflict",
    };
  }
  return { applied: true, thread: updated };
}

/**
 * Single writer for thread lifecycle events: loads the row, evaluates the
 * event against THREAD_LIFECYCLE and its supersession predicates, and applies
 * the transition with a status compare-and-set — all in one transaction.
 * Never throws on stale or illegal events; returns a typed outcome for the
 * caller to log. Use applyThreadLifecycleEventInTransaction from inside an
 * existing transaction (the caller then owns notification).
 */
export function applyThreadLifecycleEvent(
  db: DbConnection,
  notifier: DbNotifier,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = db.transaction(
    (tx) => applyThreadLifecycleEventRecord(tx, args),
    { behavior: "immediate" },
  );
  if (outcome.applied) {
    notifier.notifyThread(args.threadId, ["status-changed"], {
      projectId: outcome.thread.projectId,
    });
  }
  return outcome;
}

export function applyThreadLifecycleEventInTransaction(
  tx: DbTransaction,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  return applyThreadLifecycleEventRecord(tx, args);
}
