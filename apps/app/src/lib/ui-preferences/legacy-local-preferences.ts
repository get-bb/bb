import {
  parseUiPreferenceValue,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import { withLocalStorage } from "@/lib/browser-storage";

const RETIRED_LOCAL_STORAGE_KEYS: Partial<
  Record<UiPreferenceKey, readonly string[]>
> = {
  "sidebar.manualSectionOrder": ["bb.sidebar.folderSectionOrder"],
  "sidebar.collapsedThreadSections": ["bb.sidebar.collapsedFolders"],
  "sidebar.pluginPanelOrder": ["bb.sidebar.hiddenPluginPanels"],
};

function legacyLocalStorageKey(key: UiPreferenceKey): string {
  return `bb.${key}`;
}

export function readLegacyLocalUiPreference<Key extends UiPreferenceKey>(
  key: Key,
): UiPreferenceValue<Key> | undefined {
  const text = withLocalStorage(
    (storage) => storage.getItem(legacyLocalStorageKey(key)),
    null,
  );
  if (text === null) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = parseUiPreferenceValue(key, raw);
  return parsed.success ? parsed.value : undefined;
}

export function clearLegacyLocalUiPreference(key: UiPreferenceKey): void {
  withLocalStorage((storage) => {
    storage.removeItem(legacyLocalStorageKey(key));
    for (const storageKey of RETIRED_LOCAL_STORAGE_KEYS[key] ?? []) {
      storage.removeItem(storageKey);
    }
  }, undefined);
}
