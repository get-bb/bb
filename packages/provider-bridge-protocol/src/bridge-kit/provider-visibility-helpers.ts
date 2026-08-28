import { z } from "zod";
import type { JsonRpcMessage } from "./runtime-json-rpc.js";
import type { JsonValue } from "./runtime-json-rpc.js";

export type StringRecord = { [key: string]: JsonValue | undefined };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
const stringRecordSchema: z.ZodType<StringRecord> = z.record(
  z.string(),
  jsonValueSchema,
);

export function isRecord<T>(value: T): value is T & StringRecord {
  return stringRecordSchema.safeParse(value).success;
}

export function getRecordProperty(
  value: StringRecord,
  key: string,
): StringRecord | null {
  const next = value[key];
  return isRecord(next) ? next : null;
}

export function getStringProperty(
  value: StringRecord,
  key: string,
): string | undefined {
  const next = value[key];
  const parsed = z.string().safeParse(next);
  return parsed.success ? parsed.data : undefined;
}

export function getRawSdkMessage(event: JsonRpcMessage): StringRecord | null {
  if (event.method !== "sdk/message") {
    return null;
  }
  if (!isRecord(event.params)) {
    return null;
  }
  const message = event.params["message"];
  return isRecord(message) ? message : null;
}
