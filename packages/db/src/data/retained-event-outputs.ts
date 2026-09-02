import { and, gt, inArray, lte } from "drizzle-orm";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import type { DbQueryConnection } from "../connection.js";
import type {
  RetainedEventOutputItemKind,
  RetainedEventOutputPath,
} from "../retained-event-output.js";
import { retainedEventOutputs } from "../schema.js";
import {
  COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
  COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  COMPLETED_EVENT_OUTPUT_RETENTION_MS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
} from "./sweeps.js";

const COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER =
  "\n\n[... output truncated by retention policy; showing beginning and end ...]\n\n";
const RETAINED_EVENT_OUTPUT_LOOKUP_BATCH_SIZE = 100;

export interface RetainedEventOutputTarget {
  itemKind: RetainedEventOutputItemKind;
  outputPath: RetainedEventOutputPath;
}

export const RETAINED_EVENT_OUTPUT_TARGETS = [
  { itemKind: "commandExecution", outputPath: "aggregatedOutput" },
  { itemKind: "toolCall", outputPath: "result" },
  { itemKind: "webFetch", outputPath: "resultText" },
  { itemKind: "webSearch", outputPath: "resultText" },
] as const satisfies readonly RetainedEventOutputTarget[];

interface PreparedRetainedEventOutput {
  expiresAt: number;
  outputPath: RetainedEventOutputPath;
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

interface HydratableStoredEventRow {
  data: string;
  id: string;
}

interface RetainedEventOutputHydrationRow {
  eventId: string;
  outputPath: RetainedEventOutputPath;
  value: string;
}

interface DeleteExpiredRetainedEventOutputsArgs {
  expiredAtOrBefore: number;
  limit: number;
}

export interface DeleteExpiredRetainedEventOutputsResult {
  deleted: number;
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

function truncateOutput(value: string): string {
  return (
    value.slice(0, COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS) +
    COMPLETED_EVENT_OUTPUT_TRUNCATION_MARKER +
    value.slice(-COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS)
  );
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
  item[target.outputPath] = truncateOutput(value);
  truncation[target.outputPath] = {
    originalLength: value.length,
    retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
    retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
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
      value: args.output.value,
    })
    .onConflictDoNothing()
    .run();
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
  item[output.outputPath] = output.value;
  const truncation = item.truncation;
  if (isJsonObject(truncation)) {
    delete truncation[output.outputPath];
    if (Object.keys(truncation).length === 0) {
      delete item.truncation;
    }
  }
  return JSON.stringify(payload);
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
          eventId: retainedEventOutputs.eventId,
          outputPath: retainedEventOutputs.outputPath,
          value: retainedEventOutputs.value,
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

export function deleteExpiredRetainedEventOutputs(
  db: DbQueryConnection,
  args: DeleteExpiredRetainedEventOutputsArgs,
): DeleteExpiredRetainedEventOutputsResult {
  if (args.limit <= 0) {
    return { deleted: 0 };
  }
  const eventIds = db
    .select({ eventId: retainedEventOutputs.eventId })
    .from(retainedEventOutputs)
    .where(lte(retainedEventOutputs.expiresAt, args.expiredAtOrBefore))
    .orderBy(retainedEventOutputs.expiresAt, retainedEventOutputs.eventId)
    .limit(args.limit)
    .all()
    .map((row) => row.eventId);
  if (eventIds.length === 0) {
    return { deleted: 0 };
  }
  const result = db
    .delete(retainedEventOutputs)
    .where(inArray(retainedEventOutputs.eventId, eventIds))
    .run();
  return { deleted: result.changes };
}
