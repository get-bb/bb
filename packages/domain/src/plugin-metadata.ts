import type { JsonObject } from "./json-value.js";
import { jsonObjectSchema } from "./json-value.js";

export const PLUGIN_METADATA_MAX_BYTES = 256 * 1024;

export const pluginMetadataSchema = jsonObjectSchema.superRefine((value, ctx) => {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.byteLength > PLUGIN_METADATA_MAX_BYTES) {
    ctx.addIssue({
      code: "custom",
      message: "pluginMetadata exceeds 256 KiB",
    });
  }
});

function assertSafeJsonValue(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error("pluginMetadata contains a cycle");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    throw new Error("pluginMetadata must contain plain JSON data");
  }
  if (Object.hasOwn(value, "toJSON")) {
    throw new Error("pluginMetadata must contain plain JSON data");
  }
  seen.add(value);
  for (const child of array ? value : Object.values(value)) assertSafeJsonValue(child, seen);
  seen.delete(value);
}

function assertSafeJsonInput(value: unknown): asserts value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pluginMetadata must be a plain JSON object");
  }
  assertSafeJsonValue(value, new Set<object>());
}

export function validatePluginMetadata(value: unknown): JsonObject {
  assertSafeJsonInput(value);
  const parsed = pluginMetadataSchema.parse(value);
  return JSON.parse(JSON.stringify(parsed)) as JsonObject;
}

export function parsePersistedPluginMetadata(value: string): JsonObject | undefined {
  try {
    return validatePluginMetadata(JSON.parse(value));
  } catch {
    return undefined;
  }
}
