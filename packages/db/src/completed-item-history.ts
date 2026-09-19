import { isDeepStrictEqual } from "node:util";
import {
  threadEventTypeSchema,
  type JsonObject,
  type JsonValue,
  type ThreadEventType,
} from "@bb/domain";

export const COMPACTED_ITEM_KINDS = [
  "commandExecution",
  "fileChange",
  "reasoning",
  "agentMessage",
] as const;
export const COMPACTED_HISTORY_TYPES: readonly ThreadEventType[] = [
  "item/started",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
];
type ItemKind = (typeof COMPACTED_ITEM_KINDS)[number];
export function isCompactedItemKind(value: string | null): value is ItemKind {
  return COMPACTED_ITEM_KINDS.some((kind) => kind === value);
}
interface HistoryRecord {
  id: string;
  sequence: number;
  createdAt: number;
  type: ThreadEventType;
  itemKind: ItemKind | null;
  payload: JsonObject;
  sharedFields: string[];
  sharedItemFields: string[];
}
const mutableOutputFields = new Set([
  "aggregatedOutput",
  "result",
  "resultText",
  "truncation",
]);

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertFiniteJsonNumbers(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Non-finite completed item history number");
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) assertFiniteJsonNumbers(child);
  }
}

function parseHistoryJson(data: string): JsonValue {
  const value: unknown = JSON.parse(data);
  assertFiniteJsonNumbers(value);
  return value as JsonValue;
}

export function parseHistoryPayload(data: string): JsonObject {
  const parsed = parseHistoryJson(data);
  if (!isObject(parsed))
    throw new Error("Completed item history payload must be an object");
  return parsed;
}

function fieldNames(value: JsonValue | undefined): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((key): key is string => typeof key === "string")
  )
    throw new Error("Invalid completed item history field names");
  return value;
}

export function decodeHistory(data: string): HistoryRecord[] {
  return decodeHistoryValue(parseHistoryJson(data));
}

function decodeHistoryValue(value: JsonValue): HistoryRecord[] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== 1 ||
    !Array.isArray(value[1]) ||
    value[1].length < 1 ||
    value[1].length > 3
  )
    throw new Error("Invalid completed item history version or records");
  const records = value[1].map((record): HistoryRecord => {
    if (!Array.isArray(record) || record.length !== 6)
      throw new Error("Invalid completed item history record");
    const [id, sequence, createdAt, type, itemKind, encoding] = record;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof sequence !== "number" ||
      !Number.isSafeInteger(sequence) ||
      sequence < 1 ||
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt)
    )
      throw new Error("Invalid completed item history identity");
    if (
      itemKind !== null &&
      itemKind !== "commandExecution" &&
      itemKind !== "fileChange" &&
      itemKind !== "reasoning" &&
      itemKind !== "agentMessage"
    )
      throw new Error("Invalid completed item history kind");
    if (
      !Array.isArray(encoding) ||
      encoding.length !== 3 ||
      !isObject(encoding[0])
    )
      throw new Error("Invalid completed item history payload");
    const sharedFields = fieldNames(encoding[1]);
    const sharedItemFields = fieldNames(encoding[2]);
    if (
      sharedFields.includes("item") ||
      sharedItemFields.some((key) => mutableOutputFields.has(key))
    )
      throw new Error(
        "Mutable completed output cannot own reconstructed history",
      );
    const eventType = threadEventTypeSchema.parse(type);
    if (!COMPACTED_HISTORY_TYPES.includes(eventType))
      throw new Error("Unsupported completed item history event type");
    return {
      id,
      sequence,
      createdAt,
      type: eventType,
      itemKind,
      payload: encoding[0],
      sharedFields,
      sharedItemFields,
    };
  });
  if (
    new Set(records.map((record) => record.id)).size !== records.length ||
    new Set(records.map((record) => record.sequence)).size !== records.length
  )
    throw new Error("Duplicate completed item history identity");
  return records;
}

export function encodeHistory(records: readonly HistoryRecord[]): string {
  return JSON.stringify([
    1,
    records.map((record) => [
      record.id,
      record.sequence,
      record.createdAt,
      record.type,
      record.itemKind,
      [record.payload, record.sharedFields, record.sharedItemFields],
    ]),
  ]);
}

export function compactHistoryPayload(data: JsonObject, owner: JsonObject) {
  const payload = { ...data };
  const sharedFields: string[] = [];
  const sharedItemFields: string[] = [];
  for (const key of Object.keys(payload)) {
    if (
      key !== "item" &&
      Object.hasOwn(owner, key) &&
      isDeepStrictEqual(payload[key], owner[key])
    ) {
      sharedFields.push(key);
      delete payload[key];
    }
  }
  if (isObject(payload.item) && isObject(owner.item)) {
    const item = { ...payload.item };
    for (const key of Object.keys(item)) {
      if (
        !mutableOutputFields.has(key) &&
        Object.hasOwn(owner.item, key) &&
        isDeepStrictEqual(item[key], owner.item[key])
      ) {
        sharedItemFields.push(key);
        delete item[key];
      }
    }
    payload.item = item;
  }
  return { payload, sharedFields, sharedItemFields };
}

export function restoreHistoryPayloadObject(
  record: HistoryRecord,
  owner: JsonObject,
): JsonObject {
  const payload = { ...record.payload };
  for (const key of record.sharedFields) {
    const value = owner[key];
    if (!Object.hasOwn(owner, key) || value === undefined)
      throw new Error("Missing completed item history field");
    Object.defineProperty(payload, key, { value, enumerable: true });
  }
  if (record.sharedItemFields.length > 0) {
    if (!isObject(payload.item) || !isObject(owner.item))
      throw new Error("Missing completed item history item");
    const item = { ...payload.item };
    for (const key of record.sharedItemFields) {
      const value = owner.item[key];
      if (!Object.hasOwn(owner.item, key) || value === undefined)
        throw new Error("Missing completed item history item field");
      Object.defineProperty(item, key, { value, enumerable: true });
    }
    payload.item = item;
  }
  return payload;
}

export function restoreHistoryPayload(
  record: HistoryRecord,
  owner: JsonObject,
): string {
  return JSON.stringify(restoreHistoryPayloadObject(record, owner));
}

export function decodeCompletedItemHistory(data: string) {
  const value = parseHistoryJson(data);
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value[0] !== 1 ||
    typeof value[1] !== "number" ||
    !Number.isSafeInteger(value[1]) ||
    value[1] < 1 ||
    typeof value[2] !== "number" ||
    !Number.isFinite(value[2])
  )
    throw new Error("Invalid combined completed item history");
  const records = decodeHistoryValue(value[3]);
  const sequence = value[1];
  if (records.some((row) => row.sequence >= sequence))
    throw new Error("Completed item history exceeds completion sequence");
  return { sequence: value[1], createdAt: value[2], records };
}
