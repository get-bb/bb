import {
  jsonValueSchema,
  pluginIdSchema,
  type JsonValue,
  type PluginInputs,
} from "@bb/domain";
import { getErrorMessage } from "../helpers.js";

export const PLUGIN_INPUT_HELP =
  "Side-channel input for one plugin's dispatch gates, as <pluginId>=<json> (repeatable). Each plugin sees only its own entry; a later flag for the same plugin replaces the earlier value.";

export const PROVIDER_HELP =
  "Provider ID for the thread. Omit to use the project's remembered provider choice";

/**
 * Merges repeatable `--plugin-input <pluginId>=<json>` flags into one record
 * keyed by plugin id. Returns undefined when nothing was addressed to anybody:
 * an omitted `pluginInputs` is not the same as an empty one.
 */
export function parsePluginInputs(
  values: readonly string[] | undefined,
): PluginInputs | undefined {
  const merged: PluginInputs = {};
  for (const value of values ?? []) {
    const entry = parsePluginInputEntry(value);
    merged[entry.pluginId] = entry.value;
  }
  return Object.keys(merged).length === 0 ? undefined : merged;
}

function parsePluginInputEntry(raw: string): {
  pluginId: string;
  value: JsonValue;
} {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    throw new Error(
      `Invalid --plugin-input '${raw}'. Expected <pluginId>=<json>, for example --plugin-input my-plugin='{"tier":"fast"}'.`,
    );
  }
  const rawPluginId = raw.slice(0, separator);
  const parsedPluginId = pluginIdSchema.safeParse(rawPluginId);
  if (!parsedPluginId.success) {
    throw new Error(
      `Invalid --plugin-input plugin id '${rawPluginId}'. A plugin id is lowercase alphanumerics and dashes, starting with an alphanumeric.`,
    );
  }
  const pluginId = parsedPluginId.data;
  // JSON, not a bare string: a gate reads structured input, and guessing
  // between the two would make '{"a":1}' and its literal text indistinguishable.
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.slice(separator + 1));
  } catch (err: unknown) {
    throw new Error(
      `Invalid --plugin-input JSON for '${pluginId}': ${getErrorMessage(err)}. The value is JSON, so quote a string as --plugin-input ${pluginId}='"text"'.`,
    );
  }
  return { pluginId, value: jsonValueSchema.parse(decoded) };
}
