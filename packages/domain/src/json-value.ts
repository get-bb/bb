import { z } from "zod";

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | JsonObject;

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonObjectSchema: z.ZodType<JsonObject> = z.record(
  z.string(),
  jsonValueSchema,
);

function copyJsonValue(
  value: unknown,
  seen: Set<object>,
): JsonValue | undefined {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : undefined;
    case "object":
      break;
    default:
      return undefined;
  }
  if (value === null) return null;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const copy: JsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      const item = copyJsonValue(value[index], seen);
      if (item === undefined) return undefined;
      copy.push(item);
    }
    return copy;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  const constructorValue: unknown = Reflect.get(value, "constructor");
  const isPlain =
    prototype === Object.prototype
      ? constructorValue === Object
      : prototype === null && constructorValue === undefined;
  if (!isPlain || Object.getOwnPropertySymbols(value).length > 0) {
    return undefined;
  }
  const copy: JsonObject = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__") return undefined;
    const item = copyJsonValue(Reflect.get(value, key), seen);
    if (item === undefined) return undefined;
    copy[key] = item;
  }
  return copy;
}

export function parseJsonValue(value: unknown): JsonValue {
  const copy = copyJsonValue(value, new Set());
  return copy === undefined ? jsonValueSchema.parse(value) : copy;
}

export function tryParseJsonValue(value: unknown): JsonValue | undefined {
  const copy = copyJsonValue(value, new Set());
  return copy === undefined ? jsonValueSchema.safeParse(value).data : copy;
}
