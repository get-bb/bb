import {
  customOptionsByPluginSchema,
  type CustomOptionsByPlugin,
} from "@bb/domain";

export function parseCustomOptions(
  value: string | undefined,
): CustomOptionsByPlugin | undefined {
  if (value === undefined) return undefined;
  try {
    return customOptionsByPluginSchema.parse(JSON.parse(value));
  } catch {
    throw new Error(
      "--custom-options must be a JSON object keyed by plugin ID, with JSON objects as values (at most 256 KiB).",
    );
  }
}
