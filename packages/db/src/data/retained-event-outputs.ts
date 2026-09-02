import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import { sliceUtf16HeadAndTail } from "@bb/domain/utf16";
import type { DbQueryConnection } from "../connection.js";
import {
  COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
  COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  RETAINED_EVENT_OUTPUT_TARGETS,
  type RetainedEventOutputPath,
  type RetainedEventOutputTarget,
} from "../retained-event-output.js";
import { events, retainedEventOutputs } from "../schema.js";

export { RETAINED_EVENT_OUTPUT_TARGETS };
export type { RetainedEventOutputTarget };

const COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER =
  "\n\n[... output truncated by retention policy; showing beginning and end ...]\n\n";
const RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE = 100;

interface PreparedRetainedEventOutput {
  expiresAt: number;
  outputPath: RetainedEventOutputPath;
  value: string;
}

interface TruncatedOutput {
  retainedHeadLength: number;
  retainedTailLength: number;
  value: string;
}

export interface PreparedCompletedEventOutputData {
  data: string;
  retainedOutput: PreparedRetainedEventOutput | null;
}

interface PrepareCompletedEventOutputDataArgs {
  createdAt: number;
  data: string;
  itemKind: ThreadEventItemType | null;
  type: ThreadEventType;
}

interface InsertPreparedRetainedEventOutputArgs {
  eventId: string;
  output: PreparedRetainedEventOutput;
}

interface CopyRetainedEventOutputArgs {
  copiedAt: number;
  sourceEventId: string;
  targetEventId: string;
}

interface HydratableStoredEventRow {
  data: string;
  id: string;
}

interface RetainedEventOutputHydrationRow {
  encodedValue: string;
  eventId: string;
  outputPath: RetainedEventOutputPath;
}

interface RetainedEventOutputSizeRow {
  eventId: string;
  outputPath: RetainedEventOutputPath;
  valueBytes: number;
}

interface DeleteExpiredRetainedEventOutputsArgs {
  expiredAtOrBefore: number;
  limit: number;
}

export interface DeleteExpiredRetainedEventOutputsResult {
  deleted: number;
  threadIds: string[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetForItemKind(
  itemKind: ThreadEventItemType | null,
): RetainedEventOutputTarget | null {
  return (
    RETAINED_EVENT_OUTPUT_TARGETS.find(
      (target) => target.itemKind === itemKind,
    ) ?? null
  );
}

function truncateOutput(value: string): TruncatedOutput {
  const { head, tail } = sliceUtf16HeadAndTail(
    value,
    COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
    COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  );
  return {
    retainedHeadLength: head.length,
    retainedTailLength: tail.length,
    value: head + COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER + tail,
  };
}

export function prepareCompletedEventOutputData(
  args: PrepareCompletedEventOutputDataArgs,
): PreparedCompletedEventOutputData {
  const target =
    args.type === "item/completed" ? targetForItemKind(args.itemKind) : null;
  if (
    target === null ||
    args.data.length <= COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS
  ) {
    return { data: args.data, retainedOutput: null };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(args.data);
  } catch {
    return { data: args.data, retainedOutput: null };
  }
  if (!isJsonObject(payload) || !isJsonObject(payload.item)) {
    return { data: args.data, retainedOutput: null };
  }
  const item = payload.item;
  const value = item[target.outputPath];
  if (
    item.type !== target.itemKind ||
    typeof value !== "string" ||
    value.length <= COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS
  ) {
    return { data: args.data, retainedOutput: null };
  }
  const existingTruncation = item.truncation;
  if (
    isJsonObject(existingTruncation) &&
    existingTruncation[target.outputPath] !== undefined
  ) {
    return { data: args.data, retainedOutput: null };
  }

  const expiresAt = args.createdAt + COMPLETED_EVENT_OUTPUT_RETENTION_MS;
  const truncation = isJsonObject(existingTruncation) ? existingTruncation : {};
  const preview = truncateOutput(value);
  item[target.outputPath] = preview.value;
  truncation[target.outputPath] = {
    originalLength: value.length,
    retainedHeadLength: preview.retainedHeadLength,
    retainedTailLength: preview.retainedTailLength,
    truncatedAt: expiresAt,
  };
  item.truncation = truncation;

  return {
    data: JSON.stringify(payload),
    retainedOutput: {
      expiresAt,
      outputPath: target.outputPath,
      value,
    },
  };
}

export function insertPreparedRetainedEventOutput(
  db: DbQueryConnection,
  args: InsertPreparedRetainedEventOutputArgs,
): void {
  db.insert(retainedEventOutputs)
    .values({
      eventId: args.eventId,
      expiresAt: args.output.expiresAt,
      outputPath: args.output.outputPath,
      value: JSON.stringify(args.output.value),
    })
    .onConflictDoNothing()
    .run();
}

export function copyRetainedEventOutput(
  db: DbQueryConnection,
  args: CopyRetainedEventOutputArgs,
): void {
  db.run(sql`INSERT INTO retained_event_outputs
    (event_id, output_path, value, expires_at)
    SELECT
      ${args.targetEventId},
      output_path,
      value,
      expires_at
    FROM retained_event_outputs
    WHERE event_id = ${args.sourceEventId}
      AND expires_at > ${args.copiedAt}`);
}

function decodeRetainedOutputValue(encodedValue: string): string {
  const value: unknown = JSON.parse(encodedValue);
  if (typeof value !== "string") {
    throw new Error("Retained output value is not an encoded string");
  }
  return value;
}

function hydrateEventData(
  data: string,
  output: RetainedEventOutputHydrationRow,
): string {
  const payload: unknown = JSON.parse(data);
  if (!isJsonObject(payload) || !isJsonObject(payload.item)) {
    throw new Error("Retained output event payload is not an item object");
  }
  const item = payload.item;
  item[output.outputPath] = decodeRetainedOutputValue(output.encodedValue);
  removeOutputTruncation(item, output.outputPath);
  return JSON.stringify(payload);
}

function removeOutputTruncation(
  item: Record<string, unknown>,
  outputPath: RetainedEventOutputPath,
): void {
  const truncation = item.truncation;
  if (isJsonObject(truncation)) {
    delete truncation[outputPath];
    if (Object.keys(truncation).length === 0) {
      delete item.truncation;
    }
  }
}

export function hydrateRetainedEventOutputRows<
  TRow extends HydratableStoredEventRow,
>(
  db: DbQueryConnection,
  rows: readonly TRow[],
  now: number = Date.now(),
): TRow[] {
  if (rows.length === 0) {
    return [];
  }
  const eventIds = [...new Set(rows.map((row) => row.id))];
  const outputs: RetainedEventOutputHydrationRow[] = [];
  for (
    let start = 0;
    start < eventIds.length;
    start += RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE
  ) {
    outputs.push(
      ...db
        .select({
          encodedValue: retainedEventOutputs.value,
          eventId: retainedEventOutputs.eventId,
          outputPath: retainedEventOutputs.outputPath,
        })
        .from(retainedEventOutputs)
        .where(
          and(
            inArray(
              retainedEventOutputs.eventId,
              eventIds.slice(
                start,
                start + RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE,
              ),
            ),
            gt(retainedEventOutputs.expiresAt, now),
          ),
        )
        .all(),
    );
  }
  if (outputs.length === 0) {
    return [...rows];
  }
  const outputsByEventId = new Map(
    outputs.map((output) => [output.eventId, output]),
  );
  return rows.map((row) => {
    const output = outputsByEventId.get(row.id);
    return output ? { ...row, data: hydrateEventData(row.data, output) } : row;
  });
}

function listRetainedEventOutputSizes(
  db: DbQueryConnection,
  eventIds: readonly string[],
  now: number,
): RetainedEventOutputSizeRow[] {
  const sizes: RetainedEventOutputSizeRow[] = [];
  for (
    let start = 0;
    start < eventIds.length;
    start += RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE
  ) {
    sizes.push(
      ...db
        .select({
          eventId: retainedEventOutputs.eventId,
          outputPath: retainedEventOutputs.outputPath,
          valueBytes: sql<number>`octet_length(${retainedEventOutputs.value})`,
        })
        .from(retainedEventOutputs)
        .where(
          and(
            inArray(
              retainedEventOutputs.eventId,
              eventIds.slice(
                start,
                start + RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE,
              ),
            ),
            gt(retainedEventOutputs.expiresAt, now),
          ),
        )
        .all(),
    );
  }
  return sizes;
}

function retainedOutputSizeTotal(
  sizes: readonly RetainedEventOutputSizeRow[],
  rowCountsByEventId: ReadonlyMap<string, number>,
): number {
  return sizes.reduce(
    (total, size) =>
      total + size.valueBytes * (rowCountsByEventId.get(size.eventId) ?? 0),
    0,
  );
}

function hydratedEventDataBaseBytes(
  data: string,
  outputPath: RetainedEventOutputPath,
): number {
  const payload: unknown = JSON.parse(data);
  if (!isJsonObject(payload) || !isJsonObject(payload.item)) {
    throw new Error("Retained output event payload is not an item object");
  }
  payload.item[outputPath] = "";
  removeOutputTruncation(payload.item, outputPath);
  return Buffer.byteLength(JSON.stringify(payload)) - 2;
}

function projectedHydratedDataBytes<TRow extends HydratableStoredEventRow>(
  rows: readonly TRow[],
  sizes: readonly RetainedEventOutputSizeRow[],
): number {
  const sizesByEventId = new Map(sizes.map((size) => [size.eventId, size]));
  return rows.reduce((total, row) => {
    const size = sizesByEventId.get(row.id);
    if (!size) {
      return total + Buffer.byteLength(row.data);
    }
    return (
      total +
      hydratedEventDataBaseBytes(row.data, size.outputPath) +
      size.valueBytes
    );
  }, 0);
}

export function canHydrateRetainedEventOutputRowsWithinDataByteLimit<
  TRow extends HydratableStoredEventRow,
>(
  db: DbQueryConnection,
  rows: readonly TRow[],
  maxDataBytes: number,
  now: number = Date.now(),
): boolean {
  if (rows.length === 0) {
    return true;
  }
  const storedDataBytes = rows.reduce(
    (total, row) => total + Buffer.byteLength(row.data),
    0,
  );
  if (storedDataBytes > maxDataBytes) {
    return false;
  }
  const rowCountsByEventId = new Map<string, number>();
  for (const row of rows) {
    rowCountsByEventId.set(row.id, (rowCountsByEventId.get(row.id) ?? 0) + 1);
  }
  const eventIds = [...rowCountsByEventId.keys()];
  const sizes = listRetainedEventOutputSizes(db, eventIds, now);
  if (sizes.length === 0) {
    return true;
  }
  if (retainedOutputSizeTotal(sizes, rowCountsByEventId) > maxDataBytes) {
    return false;
  }
  return projectedHydratedDataBytes(rows, sizes) <= maxDataBytes;
}

export function hydrateRetainedEventOutputRowsWithinDataByteLimit<
  TRow extends HydratableStoredEventRow,
>(
  db: DbQueryConnection,
  rows: readonly TRow[],
  maxDataBytes: number,
  now: number = Date.now(),
): TRow[] {
  if (
    !canHydrateRetainedEventOutputRowsWithinDataByteLimit(
      db,
      rows,
      maxDataBytes,
      now,
    )
  ) {
    return [...rows];
  }
  return hydrateRetainedEventOutputRows(db, rows, now);
}

export function deleteExpiredRetainedEventOutputs(
  db: DbQueryConnection,
  args: DeleteExpiredRetainedEventOutputsArgs,
): DeleteExpiredRetainedEventOutputsResult {
  if (args.limit <= 0) {
    return { deleted: 0, threadIds: [] };
  }
  const rows = db
    .select({
      eventId: retainedEventOutputs.eventId,
      threadId: events.threadId,
    })
    .from(retainedEventOutputs)
    .innerJoin(events, eq(events.id, retainedEventOutputs.eventId))
    .where(lte(retainedEventOutputs.expiresAt, args.expiredAtOrBefore))
    .orderBy(retainedEventOutputs.expiresAt, retainedEventOutputs.eventId)
    .limit(args.limit)
    .all();
  if (rows.length === 0) {
    return { deleted: 0, threadIds: [] };
  }
  const eventIds = rows.map((row) => row.eventId);
  const result = db
    .delete(retainedEventOutputs)
    .where(inArray(retainedEventOutputs.eventId, eventIds))
    .run();
  return {
    deleted: result.changes,
    threadIds: [...new Set(rows.map((row) => row.threadId))],
  };
}
