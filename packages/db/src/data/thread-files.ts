import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import type { DbQueryConnection } from "../connection.js";
import {
  environments,
  projectAttachments,
  projectAttachmentThreads,
  retainedEventOutputs,
  threads,
} from "../schema.js";
import { queryInSqliteVariableBatches } from "./sqlite-variable-batches.js";
import { markThreadPruningWork } from "./thread-pruning-work.js";

export const THREAD_FILE_FORMAT_VERSION = 1;

export const THREAD_FILE_TABLES = [
  "threads",
  "thread_plugin_metadata",
  "thread_tabs",
  "prompt_history_entries",
  "thread_search_segments",
  "thread_conversation_outlines",
  "thread_dynamic_context_file_states",
] as const;
export type ThreadFileTable = (typeof THREAD_FILE_TABLES)[number];

export type ThreadFileValue = string | number | null;

export interface ThreadFileTableRow {
  table: ThreadFileTable;
  values: Record<string, ThreadFileValue>;
}

export type ThreadFileAttachment = typeof projectAttachments.$inferSelect;

export interface ThreadHistoryEventRow {
  createdAt: number;
  data: string;
  environmentId: string | null;
  id: string;
  itemId: string | null;
  itemKind: string | null;
  parentToolCallId: string | null;
  providerThreadId: string | null;
  scopeKind: string;
  sequence: number;
  threadId: string;
  turnId: string | null;
  type: string;
}

export interface ThreadHistoryRetainedOutputRow {
  eventId: string;
  expiresAt: number;
  outputPath: string;
  value: string;
}

export interface ThreadEventWindowArgs {
  afterSequence: number;
  maxBytes: number;
  maxRows: number;
  threadId: string;
}

export interface ThreadEventWindow {
  bytes: number;
  lastSequence: number | null;
  retained: ThreadHistoryRetainedOutputRow[];
  rows: ThreadHistoryEventRow[];
}

const eventWindowSql = (args: ThreadEventWindowArgs) => sql`
  SELECT
    id,
    thread_id AS threadId,
    environment_id AS environmentId,
    scope_kind AS scopeKind,
    turn_id AS turnId,
    provider_thread_id AS providerThreadId,
    sequence,
    type,
    item_id AS itemId,
    item_kind AS itemKind,
    parent_tool_call_id AS parentToolCallId,
    data,
    created_at AS createdAt
  FROM events
  WHERE thread_id = ${args.threadId}
    AND sequence > ${args.afterSequence}
  ORDER BY sequence
  LIMIT ${args.maxRows}
`;

function takeWithinBytes<T>(
  rows: readonly T[],
  sizeOf: (row: T) => number,
  maxBytes: number,
): { bytes: number; rows: T[] } {
  const taken: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = sizeOf(row);
    if (taken.length > 0 && bytes + rowBytes > maxBytes) break;
    taken.push(row);
    bytes += rowBytes;
  }
  return { bytes, rows: taken };
}

function listRetainedOutputsForEvents(
  db: DbQueryConnection,
  eventIds: readonly string[],
): ThreadHistoryRetainedOutputRow[] {
  return queryInSqliteVariableBatches({
    dedupeKey: (eventId) => eventId,
    fixedVariableCount: 0,
    variableCountPerValue: 1,
    values: eventIds,
    queryBatch: (batch) =>
      db
        .select({
          eventId: retainedEventOutputs.eventId,
          expiresAt: retainedEventOutputs.expiresAt,
          outputPath: retainedEventOutputs.outputPath,
          value: retainedEventOutputs.value,
        })
        .from(retainedEventOutputs)
        .where(inArray(retainedEventOutputs.eventId, [...batch]))
        .all(),
  });
}

export function readThreadEventWindow(
  db: DbQueryConnection,
  args: ThreadEventWindowArgs,
): ThreadEventWindow {
  const { bytes, rows } = takeWithinBytes(
    db.all<ThreadHistoryEventRow>(eventWindowSql(args)),
    (row) => Buffer.byteLength(row.data),
    args.maxBytes,
  );
  return {
    bytes,
    lastSequence: rows.at(-1)?.sequence ?? null,
    retained: listRetainedOutputsForEvents(
      db,
      rows.map((row) => row.id),
    ),
    rows,
  };
}

const tableColumnsCache = new Map<ThreadFileTable, Set<string>>();

function tableColumns(db: DbQueryConnection, table: ThreadFileTable): Set<string> {
  const cached = tableColumnsCache.get(table);
  if (cached !== undefined) return cached;
  const columns = new Set(
    db
      .all<{ name: string }>(sql`SELECT name FROM pragma_table_info(${table})`)
      .map((row) => row.name),
  );
  tableColumnsCache.set(table, columns);
  return columns;
}

function isThreadFileValue(value: unknown): value is ThreadFileValue {
  return value === null || typeof value === "string" || typeof value === "number";
}

export function readThreadTableRowsPage(
  db: DbQueryConnection,
  args: { afterRowid: number; limit: number; table: ThreadFileTable; threadId: string },
): { lastRowid: number | null; rows: ThreadFileTableRow[] } {
  const column = args.table === "threads" ? "id" : "thread_id";
  const found = db.all<Record<string, unknown> & { __rowid: number }>(sql`
    SELECT rowid AS __rowid, * FROM ${sql.identifier(args.table)}
    WHERE ${sql.identifier(column)} = ${args.threadId} AND rowid > ${args.afterRowid}
    ORDER BY rowid
    LIMIT ${args.limit}
  `);
  return {
    lastRowid: found.at(-1)?.__rowid ?? null,
    rows: found.map(({ __rowid: _rowid, ...row }) => ({
      table: args.table,
      values: Object.fromEntries(
        Object.entries(row).flatMap(([key, value]) =>
          isThreadFileValue(value) ? [[key, value]] : [],
        ),
      ),
    })),
  };
}

function existingId(
  db: DbQueryConnection,
  table: "environments" | "thread_sections" | "threads",
  id: ThreadFileValue | undefined,
): string | null {
  if (typeof id !== "string") return null;
  return db.get<{ id: string }>(
    sql`SELECT id FROM ${sql.identifier(table)} WHERE id = ${id}`,
  ) === undefined
    ? null
    : id;
}

function insertRow(
  db: DbQueryConnection,
  table: ThreadFileTable,
  values: Record<string, ThreadFileValue>,
): boolean {
  const columns = tableColumns(db, table);
  const entries = Object.entries(values).filter(([key]) => columns.has(key));
  if (entries.length === 0) return false;
  return (
    db.run(sql`
      INSERT OR IGNORE INTO ${sql.identifier(table)}
        (${sql.join(entries.map(([key]) => sql.identifier(key)), sql`, `)})
      VALUES (${sql.join(entries.map(([, value]) => sql`${value}`), sql`, `)})
    `).changes > 0
  );
}

export function insertHiddenThreadRow(
  db: DbQueryConnection,
  row: ThreadFileTableRow,
  hiddenAt: number,
): boolean {
  if (row.table !== "threads") {
    throw new Error(`Expected a threads row, got ${row.table}`);
  }
  const { values } = row;
  return insertRow(db, "threads", {
    ...values,
    environment_id: existingId(db, "environments", values.environment_id),
    section_id: existingId(db, "thread_sections", values.section_id),
    parent_thread_id: existingId(db, "threads", values.parent_thread_id),
    source_thread_id: existingId(db, "threads", values.source_thread_id),
    lifecycle_owner_thread_id: existingId(db, "threads", values.lifecycle_owner_thread_id),
    deleted_at: hiddenAt,
    storage_deleted_at: null,
  });
}

export function insertThreadTableRow(
  db: DbQueryConnection,
  row: ThreadFileTableRow,
): boolean {
  if (row.table === "threads") {
    throw new Error("Insert a thread row with insertHiddenThreadRow");
  }
  return insertRow(db, row.table, row.values);
}

export function listThreadAttachments(
  db: DbQueryConnection,
  threadId: string,
): ThreadFileAttachment[] {
  return db
    .select({ attachment: projectAttachments })
    .from(projectAttachmentThreads)
    .innerJoin(
      projectAttachments,
      eq(projectAttachments.id, projectAttachmentThreads.attachmentId),
    )
    .where(
      and(
        eq(projectAttachmentThreads.threadId, threadId),
        isNotNull(projectAttachments.readyAt),
        sql`${projectAttachments.deletionClaimedAt} IS NULL`,
      ),
    )
    .all()
    .map((row) => row.attachment);
}

export function insertThreadHistoryRows(
  db: DbQueryConnection,
  args: {
    now: number;
    retained: readonly ThreadHistoryRetainedOutputRow[];
    rows: readonly ThreadHistoryEventRow[];
  },
): void {
  const environmentIds = [
    ...new Set(
      args.rows.flatMap((row) => (row.environmentId === null ? [] : [row.environmentId])),
    ),
  ];
  const liveEnvironmentIds = new Set(
    environmentIds.length === 0
      ? []
      : db
          .select({ id: environments.id })
          .from(environments)
          .where(inArray(environments.id, environmentIds))
          .all()
          .map((row) => row.id),
  );
  for (const row of args.rows) {
    const environmentId =
      row.environmentId !== null && liveEnvironmentIds.has(row.environmentId)
        ? row.environmentId
        : null;
    db.run(sql`
      INSERT INTO events (
        id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id,
        sequence, type, item_id, item_kind, parent_tool_call_id, data, created_at
      ) VALUES (
        ${row.id}, ${row.threadId}, ${environmentId}, ${row.scopeKind}, ${row.turnId},
        ${row.providerThreadId}, ${row.sequence}, ${row.type}, ${row.itemId},
        ${row.itemKind}, ${row.parentToolCallId}, ${row.data}, ${row.createdAt}
      )
    `);
  }
  for (const output of args.retained) {
    if (output.expiresAt <= args.now) continue;
    db.run(sql`
      INSERT INTO retained_event_outputs (event_id, output_path, value, expires_at)
      VALUES (${output.eventId}, ${output.outputPath}, ${output.value}, ${output.expiresAt})
    `);
  }
}

export function unhideImportedThread(db: DbQueryConnection, threadId: string): void {
  const keepIfLive = (column: SQLiteColumn) =>
    sql`CASE WHEN EXISTS (
      SELECT 1 FROM ${threads} AS live
      WHERE live.id = ${column} AND live.deleted_at IS NULL
    ) THEN ${column} END`;
  db.update(threads)
    .set({
      deletedAt: null,
      parentThreadId: keepIfLive(threads.parentThreadId),
      sourceThreadId: keepIfLive(threads.sourceThreadId),
      lifecycleOwnerThreadId: keepIfLive(threads.lifecycleOwnerThreadId),
    })
    .where(eq(threads.id, threadId))
    .run();
  markThreadPruningWork(db, [threadId]);
}

export function restartThreadArchiveClock(
  db: DbQueryConnection,
  args: { now: number; threadId: string },
): void {
  db.update(threads)
    .set({ archivedAt: args.now })
    .where(and(eq(threads.id, args.threadId), isNotNull(threads.archivedAt)))
    .run();
}
