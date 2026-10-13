import {
  getStoredUiPreferenceDefault,
  listStoredUiPreferenceDefaults,
  listStoredUiPreferences,
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
  type StoredUiPreference,
} from "@bb/db";
import {
  UI_PREFERENCE_KEYS,
  getUiPreferenceDefault,
  isUiPreferenceKey,
  parseUiPreferenceValue,
  type UiPreferenceEntries,
  type UiPreferenceEntry,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";

function parseStoredJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function installationDefault<Key extends UiPreferenceKey>(
  key: Key,
  stored: string | undefined,
): UiPreferenceValue<Key> {
  if (stored !== undefined) {
    const parsed = parseUiPreferenceValue(key, parseStoredJson(stored));
    if (parsed.success) return parsed.value;
  }
  return getUiPreferenceDefault(key);
}

function toEntry<Key extends UiPreferenceKey>(
  key: Key,
  stored: StoredUiPreference | undefined,
  defaultValue: UiPreferenceValue<Key>,
): UiPreferenceEntry<Key> {
  const defaultEntry: UiPreferenceEntry<Key> = {
    revision: stored?.revision ?? 0,
    value: defaultValue,
  };
  if (stored === undefined) return defaultEntry;
  const parsed = parseUiPreferenceValue(key, parseStoredJson(stored.valueJson));
  return parsed.success
    ? { revision: stored.revision, value: parsed.value }
    : defaultEntry;
}

export function readUiPreferences(deps: AppDeps): UiPreferenceEntries {
  const defaults = new Map(
    listStoredUiPreferenceDefaults(deps.db).map((row) => [
      row.key,
      row.valueJson,
    ]),
  );
  const stored = new Map<string, StoredUiPreference>();
  for (const row of listStoredUiPreferences(deps.db)) {
    if (isUiPreferenceKey(row.key)) stored.set(row.key, row);
  }
  return Object.fromEntries(
    UI_PREFERENCE_KEYS.map((key) => [
      key,
      toEntry(
        key,
        stored.get(key),
        installationDefault(key, defaults.get(key)),
      ),
    ]),
  ) as UiPreferenceEntries;
}

export type WriteUiPreferenceResult<Key extends UiPreferenceKey> =
  | { outcome: "updated"; entry: UiPreferenceEntry<Key> }
  | { outcome: "conflict"; revision: number };

export function writeUiPreference<Key extends UiPreferenceKey>(
  deps: AppDeps,
  args: { expectedRevision: number; key: Key; value: UiPreferenceValue<Key> },
): WriteUiPreferenceResult<Key> {
  const result = replaceStoredUiPreference(deps.db, {
    expectedRevision: args.expectedRevision,
    key: args.key,
    valueJson: JSON.stringify(args.value),
  });
  if (result.outcome === "conflict") {
    return { outcome: "conflict", revision: result.revision };
  }
  deps.hub.notifySystem(["ui-preferences-changed"]);
  return {
    outcome: "updated",
    entry: { revision: result.revision, value: args.value },
  };
}

export function resetUiPreference<Key extends UiPreferenceKey>(
  deps: AppDeps,
  key: Key,
): UiPreferenceEntry<Key> {
  const value = installationDefault(
    key,
    getStoredUiPreferenceDefault(deps.db, key),
  );
  const { revision } = overwriteStoredUiPreference(deps.db, {
    key,
    valueJson: JSON.stringify(value),
  });
  deps.hub.notifySystem(["ui-preferences-changed"]);
  return { revision, value };
}
