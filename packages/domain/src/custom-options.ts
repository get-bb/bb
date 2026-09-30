import { z } from "zod";
import { pluginIdSchema } from "./plugin-id.js";
import {
  jsonObjectSchema,
  type JsonValue,
  type JsonObject,
} from "./json-value.js";
import {
  validatePluginMetadata,
  deepFreezePluginMetadata,
} from "./plugin-metadata.js";

export const customOptionsByPluginSchema = z
  .record(pluginIdSchema, jsonObjectSchema)
  .superRefine((value, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
      256 * 1024
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Custom options exceed 256 KiB",
      });
    }
  });

export type CustomOptionsByPlugin = z.infer<typeof customOptionsByPluginSchema>;

export function snapshotCustomOptions(value: unknown): JsonObject {
  return deepFreezePluginMetadata(validatePluginMetadata(value));
}

function canonicalJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key]!)]),
  );
}

export function serializeCustomOptions(options: CustomOptionsByPlugin): string {
  return JSON.stringify(
    canonicalJson(customOptionsByPluginSchema.parse(options)),
  );
}

const EMPTY_CUSTOM_OPTIONS: JsonObject = Object.freeze({});

export function customOptionsForPlugin(
  options: CustomOptionsByPlugin | undefined,
  pluginId: string,
): JsonObject {
  return options !== undefined && Object.hasOwn(options, pluginId)
    ? options[pluginId]!
    : EMPTY_CUSTOM_OPTIONS;
}
