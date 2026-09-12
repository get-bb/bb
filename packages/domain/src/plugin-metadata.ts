import type { JsonObject, JsonValue } from "./json-value.js";
import { jsonObjectSchema } from "./json-value.js";

export const PLUGIN_METADATA_MAX_BYTES = 256 * 1024;

export function exceedsPluginMetadataLimit(metadataJson: string): boolean {
  return (
    new TextEncoder().encode(metadataJson).byteLength >
    PLUGIN_METADATA_MAX_BYTES
  );
}

export const pluginMetadataSchema = jsonObjectSchema.superRefine(
  (value, ctx) => {
    if (exceedsPluginMetadataLimit(JSON.stringify(value))) {
      ctx.addIssue({
        code: "custom",
        message: "pluginMetadata exceeds 256 KiB",
      });
    }
  },
);

function assertPlainJsonData(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("pluginMetadata contains a cycle");
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    throw new Error("pluginMetadata must contain plain JSON data");
  }
  seen.add(value);
  for (const child of array ? value : Object.values(value)) {
    assertPlainJsonData(child, seen);
  }
  seen.delete(value);
}

export function validatePluginMetadata(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pluginMetadata must be a plain JSON object");
  }
  assertPlainJsonData(value, new Set<object>());
  return pluginMetadataSchema.parse(value);
}

export function parsePersistedPluginMetadata(
  metadataJson: string,
): JsonObject | undefined {
  try {
    const value: unknown = JSON.parse(metadataJson);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : undefined;
  } catch {
    return undefined;
  }
}

function deepFreezeJsonValue(value: JsonValue): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreezeJsonValue(child);
  Object.freeze(value);
}

export function deepFreezePluginMetadata(metadata: JsonObject): JsonObject {
  deepFreezeJsonValue(metadata);
  return metadata;
}
