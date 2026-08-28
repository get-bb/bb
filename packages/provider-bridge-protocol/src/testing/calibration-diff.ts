import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonObject,
  type JsonValue,
  type ThreadEvent,
} from "@bb/domain";
import { z } from "zod";

export interface NormalizeCalibrationEventsOptions {
  internedIdFields?: readonly string[];
}

const DEFAULT_INTERNED_ID_FIELDS = [
  "turnId",
  "itemId",
  "id",
  "parentToolCallId",
] as const;

const BLANKED_FIELDS = new Set(["threadId", "providerThreadId"]);

const DROPPED_FIELDS = new Set(["providerCheckpointId"]);

class IdInterner {
  private readonly assigned = new Map<string, string>();

  intern(value: string): string {
    const existing = this.assigned.get(value);
    if (existing !== undefined) {
      return existing;
    }
    const token = `#${this.assigned.size + 1}`;
    this.assigned.set(value, token);
    return token;
  }
}

const stringSchema = z.string();

function normalizeValue(
  value: JsonValue,
  interner: IdInterner,
  idFields: ReadonlySet<string>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry, interner, idFields));
  }
  const objectResult = jsonObjectSchema.safeParse(value);
  if (!objectResult.success) {
    return value;
  }
  const normalized: JsonObject = {};
  for (const [key, entry] of Object.entries(objectResult.data)) {
    if (entry === undefined || DROPPED_FIELDS.has(key)) {
      continue;
    }
    if (BLANKED_FIELDS.has(key)) {
      normalized[key] = entry === null ? null : "";
      continue;
    }
    const stringEntry = stringSchema.safeParse(entry);
    if (idFields.has(key) && stringEntry.success) {
      normalized[key] = interner.intern(stringEntry.data);
      continue;
    }
    normalized[key] = normalizeValue(entry, interner, idFields);
  }
  return normalized;
}

export function normalizeCalibrationEvents(
  events: readonly ThreadEvent[],
  options: NormalizeCalibrationEventsOptions = {},
): JsonValue[] {
  const interner = new IdInterner();
  const idFields = new Set<string>(
    options.internedIdFields ?? DEFAULT_INTERNED_ID_FIELDS,
  );
  const wireEvents = jsonValueSchema
    .array()
    .parse(JSON.parse(JSON.stringify(events)));
  return wireEvents.map((event) => normalizeValue(event, interner, idFields));
}

export interface CalibrationStreamDiff<Value> {
  onlyInBridge: Value[];
  onlyInLegacy: Value[];
}

export function diffCalibrationStreams<Value>(
  legacy: readonly Value[],
  bridge: readonly Value[],
): CalibrationStreamDiff<Value> {
  const left = legacy.map((event) => JSON.stringify(event));
  const right = bridge.map((event) => JSON.stringify(event));
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i][j] =
        left[i] === right[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const onlyInLegacy: Value[] = [];
  const onlyInBridge: Value[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      onlyInLegacy.push(legacy[i]);
      i += 1;
    } else {
      onlyInBridge.push(bridge[j]);
      j += 1;
    }
  }
  onlyInLegacy.push(...legacy.slice(i));
  onlyInBridge.push(...bridge.slice(j));
  return { onlyInLegacy, onlyInBridge };
}

export function describeCalibrationEvents(
  events: readonly JsonValue[],
): string[] {
  return events.map((event) => {
    const eventObject = jsonObjectSchema.safeParse(event);
    if (!eventObject.success) {
      return String(event);
    }
    const typeResult = stringSchema.safeParse(eventObject.data.type);
    const type = typeResult.success ? typeResult.data : "?";
    const itemObject = jsonObjectSchema.safeParse(eventObject.data.item);
    if (itemObject.success && "type" in itemObject.data) {
      return `${type}:${String(itemObject.data.type)}`;
    }
    return type;
  });
}
