import {
  jsonValueSchema,
  pluginIdSchema,
  type JsonValue,
  type PluginInputs,
} from "@bb/domain";
import { getErrorMessage } from "../helpers.js";

export const PLUGIN_INPUT_HELP =
  "Side-channel input for one plugin's dispatch gates, as <pluginId>=<json> (repeatable). Each plugin sees only its own entry; a later flag for the same plugin replaces the earlier value.";

/** The `--provider` value that routes through a plugin instead of naming one. */
const AUTO_PROVIDER_PREFIX = "auto:";

/** Entry a bare `auto:<pluginId>` addresses, so the key is always present. */
const DEFAULT_AUTO_PROVIDER_ENTRY = "default";

export const PROVIDER_HELP =
  "Provider ID for the thread, or auto:<pluginId>[:<entryId>] to let a router plugin choose. Omit to use the project's remembered provider choice";

/**
 * `--provider` is two grammars in one flag: a provider id names the provider
 * directly, and `auto:<pluginId>[:<entryId>]` names a router plugin instead.
 * The auto form sends no `providerId` at all — the plugin's `thread.create`
 * gate amends one in — plus `pluginInputs[pluginId] = { entry }` telling the
 * plugin which of its picker entries was chosen.
 */
export type ProviderSelection =
  | { kind: "provider"; providerId: string }
  | { kind: "auto"; pluginId: string; entryId: string };

export function parseProviderSelection(
  value: string | undefined,
): ProviderSelection | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith(AUTO_PROVIDER_PREFIX)) {
    return { kind: "provider", providerId: trimmed };
  }
  const rest = trimmed.slice(AUTO_PROVIDER_PREFIX.length);
  const separator = rest.indexOf(":");
  const rawPluginId = separator === -1 ? rest : rest.slice(0, separator);
  const rawEntryId =
    separator === -1 ? DEFAULT_AUTO_PROVIDER_ENTRY : rest.slice(separator + 1);
  if (rawPluginId.length === 0 || rawEntryId.length === 0) {
    throw new Error(invalidAutoProviderMessage(trimmed));
  }
  const parsedPluginId = pluginIdSchema.safeParse(rawPluginId);
  if (!parsedPluginId.success) {
    throw new Error(invalidAutoProviderMessage(trimmed));
  }
  return {
    kind: "auto",
    pluginId: parsedPluginId.data,
    entryId: rawEntryId,
  };
}

/**
 * The `pluginInputs` entry an `auto:` provider selection stands for. Explicit
 * `--plugin-input` flags are merged on top of it, so a caller can address the
 * same plugin with a richer payload without losing the entry convention.
 */
export function autoProviderPluginInputs(
  selection: ProviderSelection,
): PluginInputs {
  if (selection.kind !== "auto") return {};
  return { [selection.pluginId]: { entry: selection.entryId } };
}

/**
 * Merges repeatable `--plugin-input <pluginId>=<json>` flags into one record
 * keyed by plugin id. Returns undefined when nothing was addressed to anybody:
 * an omitted `pluginInputs` is not the same as an empty one.
 */
export function parsePluginInputs(
  values: readonly string[] | undefined,
  seed: PluginInputs = {},
): PluginInputs | undefined {
  const merged: PluginInputs = { ...seed };
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
      `Invalid --plugin-input '${raw}'. Expected <pluginId>=<json>, for example --plugin-input model-router='{"entry":"fast"}'.`,
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

function invalidAutoProviderMessage(value: string): string {
  return `Invalid --provider value '${value}'. Expected auto:<pluginId>[:<entryId>], for example auto:model-router or auto:model-router:fast.`;
}
