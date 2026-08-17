import type { JsonRpcMessage } from "./runtime-json-rpc.js";

export interface StringRecord {
  [key: string]: unknown;
}

export function isRecord(value: unknown): value is StringRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return typeof next === "string" ? next : undefined;
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
