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
  or,
  sql,
} from "drizzle-orm";
import type {
  EnvironmentWorkspaceDisplayKind,
  ReasoningLevel,
  ThreadChangeKind,
  ThreadChildOrigin,
  ThreadLifecycleEvent,
  ThreadLifecycleNoopReason,
  ThreadOriginKind,
  ThreadSearchSourceKind,
  ThreadStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import {
  evaluateThreadLifecycleEvent,
  resolveEnvironmentWorkspaceDisplayKind,
  threadSearchSourceKindSchema,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbQueryConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import {
  environments,
  pendingInteractions,
  threadSearchSegments,
  threads,
} from "../schema.js";
import { createThreadId } from "../ids.js";
import {
  createOrderKeyBetween,
} from "./order-keys.js";

type ThreadWriteConnection = DbConnection | DbTransaction;

export const THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT = 20;
export const THREAD_SEARCH_LIMIT_PER_GROUP_MAX = 50;

const THREAD_SEARCH_MATCHES_PER_THREAD = 3;
const THREAD_SEARCH_QUERY_TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;
const THREAD_SEARCH_HIGHLIGHT_RANGE_LIMIT = 8;

export interface ThreadSearchHighlightRange {
  start: number;
  end: number;
}

export interface ThreadSearchMatch {
  sourceKind: ThreadSearchSourceKind;
  text: string;
  highlightRanges: ThreadSearchHighlightRange[];
}

export interface ThreadSearchResult {
  thread: ThreadWithPendingInteractionState;
  matches: ThreadSearchMatch[];
}

export interface ThreadSearchResultGroup {
  total: number;
  results: ThreadSearchResult[];
}

export interface ThreadSearchResults {
  active: ThreadSearchResultGroup;
  archived: ThreadSearchResultGroup;
}

export interface SearchThreadsWithPendingInteractionStateArgs {
  query: string;
  limitPerGroup: number;
}

export interface UpsertThreadTitleSearchSegmentsArgs {
  threadId: string;
  title: string | null;
  titleFallback: string | null;
  updatedAt?: number;
}

export interface UpsertThreadSearchSegmentInput {
  threadId: string;
  sourceKind: ThreadSearchSourceKind;
  sourceKey: string;
  sourceSeq: number | null;
  text: string;
}

export interface UpsertThreadSearchSegmentsArgs {
  segments: readonly UpsertThreadSearchSegmentInput[];
  updatedAt?: number;
}

interface UpsertThreadSearchSegmentArgs extends UpsertThreadSearchSegmentInput {
  id: string;
  updatedAt: number;
}

interface ListThreadSearchMatchRowsArgs {
  archived: boolean;
  anyTokenMatchQuery: string;
  limitPerGroup: number;
  tokenMatchQueries: readonly string[];
}

interface ThreadSearchMatchRow {
  segmentOrder: number;
  sourceKind: string;
  sourceSeq: number | null;
  text: string;
  threadId: string;
  threadOrder: number;
  total: number;
}

interface ThreadSearchLimitedThreadRow {
  threadId: string;
  threadOrder: number;
  total: number;
}

interface ThreadSearchSegmentMatchRow {
  segmentOrder: number;
  sourceKind: string;
  sourceSeq: number | null;
  text: string;
  threadId: string;
}

interface ListThreadSearchSegmentMatchRowsArgs {
  matchQuery: string;
  threadIds: readonly string[];
}

interface HydrateThreadSearchGroupArgs {
  rows: readonly ThreadSearchMatchRow[];
  tokens: readonly string[];
}

function buildThreadSearchSegmentId(args: {
  threadId: string;
  sourceKind: ThreadSearchSourceKind;
  sourceKey: string;
}): string {
  return `${args.threadId}:${args.sourceKind}:${args.sourceKey}`;
}

function deleteThreadSearchSegmentById(
  db: ThreadWriteConnection,
  id: string,
): void {
  db.delete(threadSearchSegments).where(eq(threadSearchSegments.id, id)).run();
}

function upsertThreadSearchSegment(
  db: ThreadWriteConnection,
  args: UpsertThreadSearchSegmentArgs,
): void {
  const searchableText = args.text.trim();
  if (searchableText.length === 0) {
    deleteThreadSearchSegmentById(db, args.id);
    return;
  }

  db.insert(threadSearchSegments)
    .values({
      id: args.id,
      threadId: args.threadId,
      sourceKind: args.sourceKind,
      sourceKey: args.sourceKey,
      sourceSeq: args.sourceSeq,
      text: searchableText,
      createdAt: args.updatedAt,
      updatedAt: args.updatedAt,
    })
    .onConflictDoUpdate({
      target: threadSearchSegments.id,
      set: {
        sourceKind: args.sourceKind,
        sourceKey: args.sourceKey,
        sourceSeq: args.sourceSeq,
        text: searchableText,
        updatedAt: args.updatedAt,
      },
    })
    .run();
}

export function upsertThreadSearchSegments(
  db: ThreadWriteConnection,
  args: UpsertThreadSearchSegmentsArgs,
): void {
  const updatedAt = args.updatedAt ?? Date.now();
  for (const segment of args.segments) {
    upsertThreadSearchSegment(db, {
      ...segment,
      id: buildThreadSearchSegmentId(segment),
      updatedAt,
    });
  }
}

export function upsertThreadTitleSearchSegments(
  db: ThreadWriteConnection,
  args: UpsertThreadTitleSearchSegmentsArgs,
): void {
  upsertThreadSearchSegments(db, {
    updatedAt: args.updatedAt,
    segments: [
      {
        threadId: args.threadId,
        sourceKind: "title",
        sourceKey: "title",
        sourceSeq: null,
        text: args.title ?? "",
      },
      {
        threadId: args.threadId,
        sourceKind: "title_fallback",
        sourceKey: "title_fallback",
        sourceSeq: null,
        text: args.titleFallback ?? "",
      },
    ],
  });
}

export interface CreateThreadInput {
  projectId: string;
  environmentId?: string | null;
  providerId: string;
  title?: string | null;
  titleFallback?: string | null;
  folderId?: string | null;
  status?: ThreadStatus;
  parentThreadId?: string | null;
  sourceThreadId?: string | null;
  originKind?: ThreadOriginKind | null;
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin | null;
}

export function createThread(
  db: DbConnection,
  notifier: DbNotifier,
  input: CreateThreadInput,
) {
  const now = Date.now();
  const id = createThreadId();
  const originKind = input.originKind ?? input.childOrigin ?? null;
  const thread = db.transaction(
    (tx) => {
      const createdThread = tx
        .insert(threads)
        .values({
          id,
          projectId: input.projectId,
          environmentId: input.environmentId ?? null,
          providerId: input.providerId,
          title: input.title ?? null,
          titleFallback: input.titleFallback ?? null,
          folderId: input.folderId ?? null,
          status: input.status ?? "starting",
          parentThreadId:
            originKind === null ? input.parentThreadId ?? null : null,
          sourceThreadId:
            input.sourceThreadId ??
            (originKind === null ? null : input.parentThreadId ?? null),
          originKind,
          childOrigin: null,
          lastReadAt: now,
          latestAttentionAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      upsertThreadTitleSearchSegments(tx, {
        threadId: createdThread.id,
        title: createdThread.title,
        titleFallback: createdThread.titleFallback,
        updatedAt: now,
      });
      return createdThread;
    },
    { behavior: "immediate" },
  );
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
  /** Restrict to threads filed directly under this folder. */
  folderId?: string;
  /** Restrict to loose threads — those not filed under any folder. */
  unfiled?: boolean;
  parentThreadId?: string;
  /** When true, restrict to child threads. When false, restrict to root threads. */
  hasParent?: boolean;
  /** Restrict to threads spawned from this source thread. */
  sourceThreadId?: string;
  /** Restrict to threads spawned with this origin (fork or side-chat). */
  originKind?: ThreadOriginKind;
  /** Exclude source-derived side-chat threads. */
  excludeSideChats?: boolean;
  /** @deprecated Use originKind. */
  childOrigin?: ThreadChildOrigin;
  limit?: number;
  offset?: number;
}

type ThreadRow = typeof threads.$inferSelect;

export interface ListThreadsForProjectsOptions {
  projectIds: readonly string[];
  archived?: boolean;
  excludeOriginKind?: ThreadOriginKind;
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

export interface ListUnarchivedSourceThreadsArgs {
  originKind?: ThreadOriginKind;
  sourceThreadId: string;
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
  const originKind = options.originKind ?? options.childOrigin;
  return [
    options.projectId ? eq(threads.projectId, options.projectId) : undefined,
    options.folderId ? eq(threads.folderId, options.folderId) : undefined,
    options.unfiled ? isNull(threads.folderId) : undefined,
    isNull(threads.deletedAt),
    options.parentThreadId
      ? eq(threads.parentThreadId, options.parentThreadId)
      : undefined,
    options.sourceThreadId
      ? eq(threads.sourceThreadId, options.sourceThreadId)
      : undefined,
    originKind
      ? eq(threads.originKind, originKind)
      : undefined,
    options.excludeSideChats
      ? and(
          or(
            isNull(threads.originKind),
            ne(threads.originKind, "side-chat"),
          ),
          or(
            isNull(threads.childOrigin),
            ne(threads.childOrigin, "side-chat"),
          ),
        )
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
    options.excludeOriginKind
      ? and(
          or(
            isNull(threads.originKind),
            ne(threads.originKind, options.excludeOriginKind),
          ),
          or(
            isNull(threads.childOrigin),
            ne(threads.childOrigin, options.excludeOriginKind),
          ),
        )
      : undefined,
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

function listThreadSearchQueryTokens(query: string): string[] {
  const tokens: string[] = [];
  for (const match of query.matchAll(THREAD_SEARCH_QUERY_TOKEN_PATTERN)) {
    const token = match[0].trim();
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

function buildThreadSearchTokenMatchQuery(token: string): string {
  return `"${token.replaceAll('"', '""')}"*`;
}

function listThreadSearchTokenMatchQueries(
  tokens: readonly string[],
): string[] {
  return [...new Set(tokens.map(buildThreadSearchTokenMatchQuery))];
}

function buildThreadSearchAnyTokenMatchQuery(
  tokenMatchQueries: readonly string[],
): string | null {
  if (tokenMatchQueries.length === 0) {
    return null;
  }
  return tokenMatchQueries.join(" OR ");
}

function mergeHighlightRanges(
  ranges: readonly ThreadSearchHighlightRange[],
): ThreadSearchHighlightRange[] {
  const merged: ThreadSearchHighlightRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged.slice(0, THREAD_SEARCH_HIGHLIGHT_RANGE_LIMIT);
}

function findHighlightRanges(args: {
  text: string;
  tokens: readonly string[];
}): ThreadSearchHighlightRange[] {
  const ranges: ThreadSearchHighlightRange[] = [];
  const normalizedText = normalizeThreadSearchHighlightText(args.text);
  const uniqueTokens = [
    ...new Set(
      args.tokens
        .map((token) => normalizeThreadSearchText(token))
        .filter((token) => token.length > 0),
    ),
  ];

  for (const token of uniqueTokens) {
    let offset = 0;
    while (offset < normalizedText.text.length) {
      const start = normalizedText.text.indexOf(token, offset);
      if (start === -1) {
        break;
      }
      const end = start + token.length;
      ranges.push({
        start: normalizedText.originalStarts[start] ?? 0,
        end: normalizedText.originalEnds[end - 1] ?? args.text.length,
      });
      offset = start + token.length;
    }
  }

  return mergeHighlightRanges(
    ranges.sort((left, right) => left.start - right.start || left.end - right.end),
  );
}

function normalizeThreadSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase();
}

function normalizeThreadSearchHighlightText(text: string): {
  originalEnds: number[];
  originalStarts: number[];
  text: string;
} {
  let normalizedText = "";
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }
    const value = String.fromCodePoint(codePoint);
    const end = index + value.length;
    const normalizedValue = normalizeThreadSearchText(value);
    for (
      let normalizedIndex = 0;
      normalizedIndex < normalizedValue.length;
      normalizedIndex += 1
    ) {
      normalizedText += normalizedValue[normalizedIndex];
      originalStarts.push(index);
      originalEnds.push(end);
    }
    index = end;
  }

  return {
    originalEnds,
    originalStarts,
    text: normalizedText,
  };
}

function listThreadSearchLimitedThreadRows(
  db: DbConnection,
  args: ListThreadSearchMatchRowsArgs,
): ThreadSearchLimitedThreadRow[] {
  const tokenMatchSelects = args.tokenMatchQueries.map(
    (matchQuery, tokenIndex) => sql`
      SELECT
        s.thread_id AS threadId,
        ${tokenIndex} AS tokenIndex,
        MIN(thread_search_segments_fts.rank) AS tokenRank
      FROM thread_search_segments_fts
      JOIN thread_search_segments AS s ON s.rowid = thread_search_segments_fts.rowid
      WHERE thread_search_segments_fts MATCH ${matchQuery}
      GROUP BY s.thread_id
    `,
  );
  const archiveFilter = args.archived
    ? sql`t.archived_at IS NOT NULL`
    : sql`t.archived_at IS NULL`;

  return db.all<ThreadSearchLimitedThreadRow>(sql`
    WITH token_matches AS (
      ${sql.join(tokenMatchSelects, sql` UNION ALL `)}
    ),
    ranked_threads AS (
      SELECT
        token_matches.threadId AS threadId,
        MIN(token_matches.tokenRank) AS bestRank,
        MAX(t.updated_at) AS threadUpdatedAt
      FROM token_matches
      JOIN threads AS t ON t.id = token_matches.threadId
      WHERE t.deleted_at IS NULL
        AND ${archiveFilter}
      GROUP BY threadId
      HAVING COUNT(DISTINCT token_matches.tokenIndex) = ${args.tokenMatchQueries.length}
    )
    SELECT
      threadId,
      ROW_NUMBER() OVER (
        ORDER BY bestRank ASC, threadUpdatedAt DESC, threadId DESC
      ) AS threadOrder,
      COUNT(*) OVER () AS total
    FROM ranked_threads
    ORDER BY bestRank ASC, threadUpdatedAt DESC, threadId DESC
    LIMIT ${args.limitPerGroup}
  `);
}

function listThreadSearchSegmentMatchRows(
  db: DbConnection,
  args: ListThreadSearchSegmentMatchRowsArgs,
): ThreadSearchSegmentMatchRow[] {
  if (args.threadIds.length === 0) {
    return [];
  }

  return db.all<ThreadSearchSegmentMatchRow>(sql`
    WITH ranked_thread_segments AS (
      SELECT
        ROW_NUMBER() OVER (
          PARTITION BY thread_search_segments.thread_id
          ORDER BY
            thread_search_segments_fts.rank ASC,
            COALESCE(thread_search_segments.source_seq, -1) ASC,
            thread_search_segments.id ASC
        ) AS segmentOrder,
        thread_search_segments.source_kind AS sourceKind,
        thread_search_segments.source_seq AS sourceSeq,
        thread_search_segments.text AS text,
        thread_search_segments.thread_id AS threadId
      FROM thread_search_segments_fts
      JOIN thread_search_segments
        ON thread_search_segments.rowid = thread_search_segments_fts.rowid
      WHERE thread_search_segments_fts MATCH ${args.matchQuery}
        AND ${inArray(threadSearchSegments.threadId, [...args.threadIds])}
    )
    SELECT
      segmentOrder,
      sourceKind,
      sourceSeq,
      text,
      threadId
    FROM ranked_thread_segments
    WHERE segmentOrder <= ${THREAD_SEARCH_MATCHES_PER_THREAD}
  `);
}

function listThreadSearchMatchRows(
  db: DbConnection,
  args: ListThreadSearchMatchRowsArgs,
): ThreadSearchMatchRow[] {
  const limitedThreadRows = listThreadSearchLimitedThreadRows(db, args);
  const limitedThreadRowsById = new Map(
    limitedThreadRows.map((row) => [row.threadId, row]),
  );
  const segmentRows = listThreadSearchSegmentMatchRows(db, {
    matchQuery: args.anyTokenMatchQuery,
    threadIds: limitedThreadRows.map((row) => row.threadId),
  });

  return segmentRows
    .map((segmentRow) => {
      const limitedThreadRow = limitedThreadRowsById.get(segmentRow.threadId);
      if (limitedThreadRow === undefined) {
        throw new Error("Thread search segment row is outside limited threads");
      }
      return {
        segmentOrder: segmentRow.segmentOrder,
        sourceKind: segmentRow.sourceKind,
        sourceSeq: segmentRow.sourceSeq,
        text: segmentRow.text,
        threadId: segmentRow.threadId,
        threadOrder: limitedThreadRow.threadOrder,
        total: limitedThreadRow.total,
      };
    })
    .sort((left, right) => {
      const threadOrderDifference = left.threadOrder - right.threadOrder;
      if (threadOrderDifference !== 0) {
        return threadOrderDifference;
      }
      return left.segmentOrder - right.segmentOrder;
    });
}

function hydrateThreadSearchGroup(
  db: DbConnection,
  args: HydrateThreadSearchGroupArgs,
): ThreadSearchResultGroup {
  const firstRow = args.rows[0];
  if (firstRow === undefined) {
    return { total: 0, results: [] };
  }

  const threadIds: string[] = [];
  const seenThreadIds = new Set<string>();
  const matchesByThreadId = new Map<string, ThreadSearchMatch[]>();
  for (const row of args.rows) {
    if (!seenThreadIds.has(row.threadId)) {
      seenThreadIds.add(row.threadId);
      threadIds.push(row.threadId);
    }
    const matches = matchesByThreadId.get(row.threadId) ?? [];
    matches.push({
      sourceKind: threadSearchSourceKindSchema.parse(row.sourceKind),
      text: row.text,
      highlightRanges: findHighlightRanges({
        text: row.text,
        tokens: args.tokens,
      }),
    });
    matchesByThreadId.set(row.threadId, matches);
  }

  const threadsById = new Map(
    threadWithPendingInteractionBaseQuery(db)
      .where(and(inArray(threads.id, threadIds), isNull(threads.deletedAt)))
      .groupBy(threads.id)
      .all()
      .map(toThreadWithPendingInteractionState)
      .map((thread) => [thread.id, thread]),
  );

  const results: ThreadSearchResult[] = [];
  for (const threadId of threadIds) {
    const thread = threadsById.get(threadId);
    const matches = matchesByThreadId.get(threadId);
    if (thread === undefined || matches === undefined) {
      continue;
    }
    results.push({ thread, matches });
  }

  return { total: firstRow.total, results };
}

export function searchThreadsWithPendingInteractionState(
  db: DbConnection,
  args: SearchThreadsWithPendingInteractionStateArgs,
): ThreadSearchResults {
  const tokens = listThreadSearchQueryTokens(args.query);
  const tokenMatchQueries = listThreadSearchTokenMatchQueries(tokens);
  const anyTokenMatchQuery = buildThreadSearchAnyTokenMatchQuery(tokenMatchQueries);
  if (anyTokenMatchQuery === null) {
    return {
      active: { total: 0, results: [] },
      archived: { total: 0, results: [] },
    };
  }
  const limitPerGroup = Math.min(
    Math.max(args.limitPerGroup, 1),
    THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
  );

  return {
    active: hydrateThreadSearchGroup(db, {
      tokens,
      rows: listThreadSearchMatchRows(db, {
        archived: false,
        anyTokenMatchQuery,
        limitPerGroup,
        tokenMatchQueries,
      }),
    }),
    archived: hydrateThreadSearchGroup(db, {
      tokens,
      rows: listThreadSearchMatchRows(db, {
        archived: true,
        anyTokenMatchQuery,
        limitPerGroup,
        tokenMatchQueries,
      }),
    }),
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

export function listUnarchivedSourceThreads(
  db: ThreadWriteConnection,
  args: ListUnarchivedSourceThreadsArgs,
): ThreadRow[] {
  return db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.sourceThreadId, args.sourceThreadId),
        args.originKind ? eq(threads.originKind, args.originKind) : undefined,
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
  folderId?: string | null;
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
  if ("title" in input || "folderId" in input) changes.push("title-changed");
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
  if ("folderId" in input) {
    set.folderId = input.folderId;
  }
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
  if (updated && "title" in input) {
    upsertThreadTitleSearchSegments(db, {
      threadId: updated.id,
      title: updated.title,
      titleFallback: updated.titleFallback,
      updatedAt: now,
    });
  }
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
