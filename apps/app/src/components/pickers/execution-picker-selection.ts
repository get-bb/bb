import type { PluginInputs } from "@bb/domain";
import type { PluginExecutionPickerEntrySlot } from "@/lib/plugin-slots";

/**
 * What the provider/model picker is currently set to.
 *
 * Two arms, because a picker row is one of two genuinely different things: a
 * real agent provider (which resolves a model, reasoning level and service
 * tier from that provider's live catalog), or a plugin's entry — an "Auto"
 * row that resolves *nothing* client-side and instead hands the decision to
 * that plugin's dispatch gate at submit time.
 */
export type ExecutionPickerValue =
  | { kind: "provider"; providerId: string }
  | { kind: "plugin-entry"; pluginId: string; entryId: string };

/**
 * The token a value sorts under in the user's `providerOrder` setting, so one
 * ordered list covers providers and plugin entries alike.
 *
 * A provider sorts under its bare id; a plugin entry under
 * `plugin:<pluginId>:<entryId>`. The two namespaces cannot collide: provider
 * ids are validated against `/^[a-zA-Z0-9_-]+$/` at registration, so no
 * provider id can contain the ":" that every plugin-entry token has.
 */
export function executionPickerOrderToken(value: ExecutionPickerValue): string {
  return value.kind === "provider"
    ? value.providerId
    : `plugin:${value.pluginId}:${value.entryId}`;
}

/**
 * The value a `providerOrder` token names, or null when the token is not a
 * well-formed one. Round-trips {@link executionPickerOrderToken}.
 *
 * Splitting on the FIRST two separators only would mis-parse nothing today
 * (plugin and entry ids are both `/^[a-zA-Z0-9_-]+$/`), but rejecting extra
 * segments outright keeps a future id grammar from silently resolving to the
 * wrong entry.
 */
export function parseExecutionPickerOrderToken(
  token: string,
): ExecutionPickerValue | null {
  if (token.length === 0) return null;
  if (!token.startsWith("plugin:")) {
    return token.includes(":") ? null : { kind: "provider", providerId: token };
  }
  const segments = token.split(":");
  if (segments.length !== 3) return null;
  const [, pluginId, entryId] = segments;
  if (
    pluginId === undefined ||
    pluginId.length === 0 ||
    entryId === undefined ||
    entryId.length === 0
  ) {
    return null;
  }
  return { kind: "plugin-entry", pluginId, entryId };
}

export function isSameExecutionPickerValue(
  left: ExecutionPickerValue,
  right: ExecutionPickerValue,
): boolean {
  return executionPickerOrderToken(left) === executionPickerOrderToken(right);
}

/**
 * Every picker row in display order.
 *
 * `providerIds` arrives already sorted by the server (which applies
 * `providerOrder` to the providers it knows). Plugin entries are unknown to
 * the server, so this is where they join the same order: tokens the user
 * pinned lead in pinned order, and everything unpinned follows with providers
 * first, then plugin entries by plugin id and entry id. Unpinned entries
 * trailing the providers is the deliberate default — a routing plugin that
 * wants its "Auto" row first says so by being pinned, rather than by
 * displacing the user's provider on install.
 */
export function orderExecutionPickerValues(args: {
  providerIds: readonly string[];
  entries: readonly PluginExecutionPickerEntrySlot[];
  providerOrder: readonly string[];
}): ExecutionPickerValue[] {
  const providers: ExecutionPickerValue[] = args.providerIds.map(
    (providerId) => ({ kind: "provider", providerId }),
  );
  const pluginEntries: ExecutionPickerValue[] = [...args.entries]
    .sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
    )
    .map((entry) => ({
      kind: "plugin-entry",
      pluginId: entry.pluginId,
      entryId: entry.id,
    }));
  const values = [...providers, ...pluginEntries];
  if (args.providerOrder.length === 0) return values;
  const rank = new Map(args.providerOrder.map((token, index) => [token, index]));
  // A stable sort keyed on pinned rank: everything unpinned shares the
  // sentinel and therefore keeps the natural order built above.
  return values.sort(
    (a, b) =>
      (rank.get(executionPickerOrderToken(a)) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(executionPickerOrderToken(b)) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * The plugin entry a value names, or null — for the provider arm, and for a
 * plugin entry whose plugin is disabled, uninstalled, or no longer registers
 * it. Callers treat null as "fall back to the provider selection", which is
 * exactly the plan's rule: a disabled plugin's entry disappears and the
 * request resolves to the project default.
 */
export function findExecutionPickerEntry(
  value: ExecutionPickerValue,
  entries: readonly PluginExecutionPickerEntrySlot[],
): PluginExecutionPickerEntrySlot | null {
  if (value.kind !== "plugin-entry") return null;
  return (
    entries.find(
      (entry) =>
        entry.pluginId === value.pluginId && entry.id === value.entryId,
    ) ?? null
  );
}

/** The execution fields a selection contributes to a create/send request. */
export interface ExecutionPickerSubmission {
  /**
   * Omitted for a live plugin entry: the server resolves the project default
   * and the plugin's gate amends it. A gate's choice is recorded with a
   * `plugin` provenance, so it is never promoted to a project default.
   */
  providerId?: string;
  /** The entry's registered `pluginInput`, addressed to its plugin alone. */
  pluginInputs?: PluginInputs;
}

/**
 * How a picker selection reaches the wire.
 *
 * A provider selection contributes its `providerId` and nothing else. A live
 * plugin entry contributes no `providerId` at all plus one `pluginInputs`
 * entry. A plugin entry whose registration has vanished contributes the
 * `fallbackProviderId` instead, so a disabled routing plugin degrades to a
 * normal send rather than blocking the composer.
 */
export function executionPickerSubmission(args: {
  value: ExecutionPickerValue;
  entries: readonly PluginExecutionPickerEntrySlot[];
  fallbackProviderId: string;
}): ExecutionPickerSubmission {
  if (args.value.kind === "provider") {
    return { providerId: args.value.providerId };
  }
  const entry = findExecutionPickerEntry(args.value, args.entries);
  if (entry === null) return { providerId: args.fallbackProviderId };
  return { pluginInputs: { [entry.pluginId]: entry.pluginInput } };
}

/**
 * Merge a composer's own `pluginInputs` (from
 * `useComposer().experimental_setPluginInput`) with a picker entry's.
 *
 * The picker entry wins a key collision: the user selecting the plugin's row
 * is a more direct statement about this submission than a control the plugin
 * set earlier. Returns undefined when there is nothing to send, because an
 * empty object addressed to nobody is not the same as omitting the field.
 */
export function mergePluginInputs(
  composerInputs: PluginInputs | undefined,
  pickerInputs: PluginInputs | undefined,
): PluginInputs | undefined {
  const merged: PluginInputs = { ...composerInputs, ...pickerInputs };
  return Object.keys(merged).length === 0 ? undefined : merged;
}
