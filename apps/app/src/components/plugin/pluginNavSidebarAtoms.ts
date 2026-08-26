import { atomWithStorage } from "jotai/utils";
import {
  createBooleanPreferenceAtom,
  createJsonLocalStorage,
  type SyncStorage,
} from "@/lib/browser-storage";
import { normalizePluginNavPanelOrder } from "./pluginNavSidebarOrder";

export const PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY = "bb.sidebar.pluginPanelOrder";
export const HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanels";
export const PLUGIN_NAV_PANEL_OVERFLOW_EXPANDED_STORAGE_KEY =
  "bb.sidebar.pluginPanelOverflowExpanded";
export const PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY =
  "bb.sidebar.pluginPanelMigratedVisibleLimit";

const jsonStringArrayStorage = createJsonLocalStorage<unknown>();
const normalizedStringArrayStorage: SyncStorage<string[]> = {
  getItem: (key, initialValue) =>
    normalizePluginNavPanelOrder(
      jsonStringArrayStorage.getItem(key, initialValue),
    ),
  setItem: (key, value) => {
    jsonStringArrayStorage.setItem(key, normalizePluginNavPanelOrder(value));
  },
  removeItem: (key) => {
    jsonStringArrayStorage.removeItem(key);
  },
  subscribe: (key, callback, initialValue) =>
    jsonStringArrayStorage.subscribe?.(
      key,
      (value) => callback(normalizePluginNavPanelOrder(value)),
      initialValue,
    ),
};

function normalizeMigratedVisibleLimit(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 5
    ? value
    : null;
}

const jsonMigratedVisibleLimitStorage = createJsonLocalStorage<unknown>();
const migratedVisibleLimitStorage: SyncStorage<number | null> = {
  getItem: (key, initialValue) =>
    normalizeMigratedVisibleLimit(
      jsonMigratedVisibleLimitStorage.getItem(key, initialValue),
    ),
  setItem: (key, value) => {
    if (value === null) {
      jsonMigratedVisibleLimitStorage.removeItem(key);
      return;
    }
    jsonMigratedVisibleLimitStorage.setItem(key, value);
  },
  removeItem: (key) => {
    jsonMigratedVisibleLimitStorage.removeItem(key);
  },
  subscribe: (key, callback, initialValue) =>
    jsonMigratedVisibleLimitStorage.subscribe?.(
      key,
      (value) => callback(normalizeMigratedVisibleLimit(value)),
      initialValue,
    ),
};

/**
 * User-chosen order of every sidebar plugin panel row, as
 * `<pluginId>/<panelId>` keys. Reads dedupe malformed stored values so two
 * windows cannot make one panel render twice. Empty means registry order.
 */
export const pluginNavPanelOrderAtom = atomWithStorage<string[]>(
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
  [],
  normalizedStringArrayStorage,
  { getOnInit: true },
);

/**
 * Legacy hidden row keys. Phase 3 consumes plugin-page keys only; host-owned
 * keys remain for the migration that owns their replacement preference.
 */
export const hiddenPluginNavPanelsAtom = atomWithStorage<string[]>(
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  [],
  normalizedStringArrayStorage,
  { getOnInit: true },
);

export const pluginNavPanelOverflowExpandedAtom = createBooleanPreferenceAtom(
  PLUGIN_NAV_PANEL_OVERFLOW_EXPANDED_STORAGE_KEY,
  false,
);

/**
 * Temporary fold that preserves the number of visible plugin pages from the
 * legacy hidden-page model. It disappears once the user promotes enough pages
 * to reach the standard cap, after which the ordinary <=5 flat-list rule wins.
 */
export const pluginNavPanelMigratedVisibleLimitAtom = atomWithStorage<
  number | null
>(
  PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  null,
  migratedVisibleLimitStorage,
  { getOnInit: true },
);
