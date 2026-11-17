import { sql } from "drizzle-orm";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import { sliceUtf16Head } from "@bb/text-utils";
import {
  afterCommit,
  rootConnectionOf,
  type DbQueryConnection,
} from "../connection.js";
import { replaceAppendedEventRowData } from "./appended-event-rows.js";
import {
  prepareCompletedEventOutputData,
  type PreparedCompletedEventOutputData,
} from "./retained-event-outputs.js";

export const PROVIDER_UNHANDLED_EVENT_MAX_BYTES = 64 * 1024;
const PROVIDER_UNHANDLED_LABEL_MAX_CHARS = 1024;

interface StoredEventDataArgs {
  createdAt: number;
  data: string;
  itemKind: ThreadEventItemType | null;
  type: ThreadEventType;
}

interface StoredEventRowRef {
  data: string;
  itemId: string | null;
  itemKind: ThreadEventItemType | null;
  sequence: number;
  threadId: string;
  type: ThreadEventType;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function parseUnhandledEventData(data: string): {
  payload: JsonObject;
  rawEvent: JsonObject;
} {
  const payload: unknown = JSON.parse(data);
  if (!isJsonObject(payload) || !isJsonObject(payload.rawEvent)) {
    throw new Error("provider/unhandled event data has no rawEvent object");
  }
  return { payload, rawEvent: payload.rawEvent };
}

function boundLabel(value: unknown): unknown {
  return typeof value === "string"
    ? sliceUtf16Head(value, PROVIDER_UNHANDLED_LABEL_MAX_CHARS)
    : value;
}

function capProviderUnhandledEventData(data: string): string {
  if (Buffer.byteLength(data) <= PROVIDER_UNHANDLED_EVENT_MAX_BYTES) {
    return data;
  }
  const { payload, rawEvent } = parseUnhandledEventData(data);
  const params = rawEvent.params;
  const marker = {
    payloadOmitted: true,
    payloadBytes: params === undefined ? 0 : jsonBytes(params),
  };
  rawEvent.params = marker;
  if (jsonBytes(payload) > PROVIDER_UNHANDLED_EVENT_MAX_BYTES) {
    payload.rawType = boundLabel(payload.rawType);
    rawEvent.method = boundLabel(rawEvent.method);
  }
  if (!isJsonObject(params)) {
    return JSON.stringify(payload);
  }
  let remaining = PROVIDER_UNHANDLED_EVENT_MAX_BYTES - jsonBytes(payload);
  const kept = new Set<string>();
  const fields = Object.entries(params)
    .filter(([key]) => !(key in marker))
    .map(([key, value]) => ({
      key,
      bytes: jsonBytes(key) + 1 + jsonBytes(value) + 1,
    }))
    .sort((left, right) => left.bytes - right.bytes);
  for (const field of fields) {
    if (field.bytes > remaining) break;
    remaining -= field.bytes;
    kept.add(field.key);
  }
  rawEvent.params = {
    ...Object.fromEntries(
      Object.entries(params).filter(([key]) => kept.has(key)),
    ),
    ...marker,
  };
  return JSON.stringify(payload);
}

export function prepareStoredEventData(
  args: StoredEventDataArgs,
): PreparedCompletedEventOutputData {
  if (args.type === "provider/unhandled") {
    return {
      data: capProviderUnhandledEventData(args.data),
      retainedOutput: null,
    };
  }
  return prepareCompletedEventOutputData(args);
}

function fileChangeEntries(data: string): {
  payload: JsonObject;
  changes: unknown[];
} | null {
  const payload: unknown = JSON.parse(data);
  if (
    !isJsonObject(payload) ||
    !isJsonObject(payload.item) ||
    payload.item.type !== "fileChange" ||
    !Array.isArray(payload.item.changes)
  ) {
    return null;
  }
  return { payload, changes: payload.item.changes };
}

function withoutSettledDiffs(
  startedData: string,
  settledChanges: readonly unknown[],
): string | null {
  const started = fileChangeEntries(startedData);
  if (started === null) return null;
  let stripped = false;
  for (const [index, change] of started.changes.entries()) {
    const settled = settledChanges[index];
    if (
      isJsonObject(change) &&
      isJsonObject(settled) &&
      typeof change.diff === "string" &&
      change.path === settled.path &&
      change.diff === settled.diff
    ) {
      delete change.diff;
      stripped = true;
    }
  }
  return stripped ? JSON.stringify(started.payload) : null;
}

export function applySettledEventStorageRules(
  db: DbQueryConnection,
  row: StoredEventRowRef,
): void {
  if (
    row.type !== "item/completed" ||
    row.itemKind !== "fileChange" ||
    row.itemId === null
  ) {
    return;
  }
  const settled = fileChangeEntries(row.data);
  if (
    settled === null ||
    !settled.changes.some(
      (change) => isJsonObject(change) && typeof change.diff === "string",
    )
  ) {
    return;
  }
  const startedRows = db.all<{ id: string; data: string }>(sql`
    SELECT id, data FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
    WHERE thread_id = ${row.threadId}
      AND item_id = ${row.itemId}
      AND type IN ('item/started', 'item/completed', 'item/backgroundTask/completed')
      AND type = 'item/started'
      AND item_kind = 'fileChange'
      AND sequence < ${row.sequence}`);
  const root = rootConnectionOf(db);
  for (const started of startedRows) {
    const data = withoutSettledDiffs(started.data, settled.changes);
    if (data === null) continue;
    db.run(sql`UPDATE events SET data = ${data} WHERE id = ${started.id}`);
    if (root !== undefined) {
      afterCommit(db, () =>
        replaceAppendedEventRowData(root, row.threadId, started.id, data),
      );
    }
  }
}
