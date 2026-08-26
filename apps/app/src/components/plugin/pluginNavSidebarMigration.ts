import {
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
} from "./pluginNavSidebarAtoms";
import {
  normalizePluginNavPanelOrder,
  PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
} from "./pluginNavSidebarOrder";

export const HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY =
  "bb.sidebar.hiddenPluginPanelsMigrated.v1";
const HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_LOCK =
  "bb.sidebar.hiddenPluginPanelsMigration.v1";
const MIGRATION_COMPLETE = "1";

export const LEGACY_TOOLS_NAV_ROW_KEY = "__builtin__/tools";

export function isPluginNavPanelKey(key: string): boolean {
  return !key.startsWith("__builtin__/");
}

interface PluginNavPanelMigrationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface PluginNavPanelMigrationLockManager {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

interface MigrateHiddenPluginNavPanelsArgs {
  storage: PluginNavPanelMigrationStorage;
  registrationOrder: readonly string[];
  lockManager?: PluginNavPanelMigrationLockManager | null;
}

export interface HiddenPluginNavPanelsMigrationResult {
  order: string[];
  remainingHiddenKeys: string[];
  migratedVisibleLimit: number | null;
}

function readStoredKeys(
  storage: PluginNavPanelMigrationStorage,
  key: string,
): string[] {
  const value = storage.getItem(key);
  if (value === null) return [];
  try {
    return normalizePluginNavPanelOrder(JSON.parse(value));
  } catch {
    return [];
  }
}

function readMigratedVisibleLimit(
  storage: PluginNavPanelMigrationStorage,
): number | null {
  const value = storage.getItem(
    PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  );
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "number" &&
      Number.isInteger(parsed) &&
      parsed >= 0 &&
      parsed <= PLUGIN_NAV_PANEL_VISIBLE_LIMIT
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeMigratedVisibleLimit(
  storage: PluginNavPanelMigrationStorage,
  visibleLimit: number | null,
): void {
  if (visibleLimit === null) {
    storage.removeItem(PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY);
    return;
  }
  storage.setItem(
    PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
    JSON.stringify(visibleLimit),
  );
}

function migrateUnderLock(
  storage: PluginNavPanelMigrationStorage,
  registrationOrderValue: readonly string[],
): HiddenPluginNavPanelsMigrationResult {
  const registrationOrder = normalizePluginNavPanelOrder(
    registrationOrderValue,
  ).filter(isPluginNavPanelKey);
  const currentOrder = normalizePluginNavPanelOrder([
    ...readStoredKeys(storage, PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY).filter(
      isPluginNavPanelKey,
    ),
    ...registrationOrder,
  ]);
  const hiddenKeys = readStoredKeys(
    storage,
    HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  );
  const remainingHiddenKeys = hiddenKeys.filter(
    (key) => !isPluginNavPanelKey(key),
  );

  if (
    storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY) ===
    MIGRATION_COMPLETE
  ) {
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(remainingHiddenKeys),
    );
    return {
      order: currentOrder,
      remainingHiddenKeys,
      migratedVisibleLimit: readMigratedVisibleLimit(storage),
    };
  }

  const hiddenPluginKeys = hiddenKeys.filter(isPluginNavPanelKey);
  const hiddenSet = new Set(hiddenPluginKeys);
  const completeOrder = normalizePluginNavPanelOrder([
    ...currentOrder,
    ...hiddenPluginKeys,
  ]);
  const normalizedOrder = normalizePluginNavPanelOrder([
    ...completeOrder.filter((key) => !hiddenSet.has(key)),
    ...completeOrder.filter((key) => hiddenSet.has(key)),
  ]);
  const previouslyVisibleCount = registrationOrder.filter(
    (key) => !hiddenSet.has(key),
  ).length;
  const migratedVisibleLimit =
    hiddenPluginKeys.length > 0 &&
    previouslyVisibleCount < PLUGIN_NAV_PANEL_VISIBLE_LIMIT
      ? previouslyVisibleCount
      : null;

  storage.setItem(
    PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
    JSON.stringify(normalizedOrder),
  );
  writeMigratedVisibleLimit(storage, migratedVisibleLimit);
  storage.setItem(
    HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
    MIGRATION_COMPLETE,
  );
  storage.setItem(
    HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
    JSON.stringify(remainingHiddenKeys),
  );
  return { order: normalizedOrder, remainingHiddenKeys, migratedVisibleLimit };
}

export async function migrateHiddenPluginNavPanels({
  storage,
  registrationOrder,
  lockManager = typeof navigator === "undefined"
    ? null
    : ((navigator.locks as PluginNavPanelMigrationLockManager | undefined) ??
      null),
}: MigrateHiddenPluginNavPanelsArgs): Promise<HiddenPluginNavPanelsMigrationResult> {
  if (lockManager === null) {
    return migrateUnderLock(storage, registrationOrder);
  }
  return lockManager.request(
    HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_LOCK,
    async () => migrateUnderLock(storage, registrationOrder),
  );
}
