import type { JsonValue } from "./json-value.js";

export const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;

export const PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES = 64 * 1024;

export function jsonByteLength(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
