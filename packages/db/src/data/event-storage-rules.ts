import { sql } from "drizzle-orm";
import {
  threadEventItemSchema,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
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

const SETTLED_ITEM_PER_EVENT_FIELDS = new Set([
  "id",
  "type",
  "status",
  "parentToolCallId",
  "presentation",
]);
const SETTLED_REPEATED_FIELD_MIN_CHARS = 64;

type JsonContainer = JsonObject | unknown[];

function isJsonContainer(value: unknown): value is JsonContainer {
  return typeof value === "object" && value !== null;
}

function parseItemPayload(data: string): {
  payload: JsonObject;
  item: JsonObject;
} | null {
  const payload: unknown = JSON.parse(data);
  if (!isJsonObject(payload) || !isJsonObject(payload.item)) return null;
  return { payload, item: payload.item };
}

interface SettledStrip {
  droppable: Map<string, boolean>;
  isValid: () => boolean;
}

function canDrop(
  strip: SettledStrip,
  container: JsonObject,
  key: string,
  pattern: string,
): boolean {
  const cached = strip.droppable.get(pattern);
  if (cached !== undefined) return cached;
  const value = container[key];
  delete container[key];
  const droppable = strip.isValid();
  container[key] = value;
  strip.droppable.set(pattern, droppable);
  return droppable;
}

function stripRepeatedFields(
  strip: SettledStrip,
  started: JsonContainer,
  settled: JsonContainer,
  pattern: string,
): boolean {
  if (Array.isArray(started)) {
    if (!Array.isArray(settled)) return false;
    let stripped = false;
    for (const [index, entry] of started.entries()) {
      const settledEntry = settled[index];
      if (isJsonContainer(entry) && isJsonContainer(settledEntry)) {
        stripped =
          stripRepeatedFields(strip, entry, settledEntry, `${pattern}[]`) ||
          stripped;
      }
    }
    return stripped;
  }
  if (Array.isArray(settled)) return false;
  let stripped = false;
  for (const key of Object.keys(started)) {
    if (pattern === "" && SETTLED_ITEM_PER_EVENT_FIELDS.has(key)) continue;
    if (!(key in settled)) continue;
    const value = started[key];
    const settledValue = settled[key];
    const encoded = JSON.stringify(value);
    if (
      encoded.length < SETTLED_REPEATED_FIELD_MIN_CHARS ||
      encoded !== JSON.stringify(settledValue)
    ) {
      continue;
    }
    const fieldPattern = `${pattern}.${key}`;
    if (canDrop(strip, started, key, fieldPattern)) {
      delete started[key];
      stripped = true;
    } else if (isJsonContainer(value) && isJsonContainer(settledValue)) {
      stripped =
        stripRepeatedFields(strip, value, settledValue, fieldPattern) ||
        stripped;
    }
  }
  return stripped;
}

function withoutSettledFields(
  startedData: string,
  settledItem: JsonObject,
): string | null {
  const started = parseItemPayload(startedData);
  if (started === null || started.item.type !== settledItem.type) return null;
  const isValid = () => threadEventItemSchema.safeParse(started.item).success;
  if (!isValid()) return null;
  const strip = { droppable: new Map<string, boolean>(), isValid };
  return stripRepeatedFields(strip, started.item, settledItem, "") && isValid()
    ? JSON.stringify(started.payload)
    : null;
}

export function applySettledEventStorageRules(
  db: DbQueryConnection,
  row: StoredEventRowRef,
): void {
  if (row.type !== "item/completed" || row.itemId === null) return;
  const startedRows = db.all<{ id: string; data: string }>(sql`
    SELECT id, data FROM events INDEXED BY events_item_lifecycle_thread_item_sequence_idx
    WHERE thread_id = ${row.threadId}
      AND item_id = ${row.itemId}
      AND type IN ('item/started', 'item/completed', 'item/backgroundTask/completed')
      AND type = 'item/started'
      AND sequence < ${row.sequence}`);
  if (startedRows.length === 0) return;
  const settled = parseItemPayload(row.data);
  if (settled === null) return;
  const root = rootConnectionOf(db);
  for (const started of startedRows) {
    const data = withoutSettledFields(started.data, settled.item);
    if (data === null) continue;
    db.run(sql`UPDATE events SET data = ${data} WHERE id = ${started.id}`);
    if (root !== undefined) {
      afterCommit(db, () =>
        replaceAppendedEventRowData(root, row.threadId, started.id, data),
      );
    }
  }
}
