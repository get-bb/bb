import { describe, expect, it } from "vitest";
import {
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY,
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
} from "./pluginNavSidebarAtoms";
import {
  HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY,
  LEGACY_TOOLS_NAV_ROW_KEY,
  migrateHiddenPluginNavPanels,
} from "./pluginNavSidebarMigration";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class SerializedLockManager {
  private tail = Promise.resolve();

  request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const result = this.tail.then(callback);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

const registrationOrder = [
  "docs/main",
  "github/main",
  "tasks/main",
  "notes/main",
];

describe("migrateHiddenPluginNavPanels", () => {
  it("appends legacy hidden pages in their stored order and clears only those keys", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["tasks/main", "docs/main", "github/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main", "github/main", LEGACY_TOOLS_NAV_ROW_KEY]),
    );

    await expect(
      migrateHiddenPluginNavPanels({
        storage,
        registrationOrder,
        lockManager: null,
      }),
    ).resolves.toEqual({
      order: ["docs/main", "notes/main", "tasks/main", "github/main"],
      remainingHiddenKeys: [LEGACY_TOOLS_NAV_ROW_KEY],
      migratedVisibleLimit: 2,
    });
    expect(storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)).toBe(
      JSON.stringify([LEGACY_TOOLS_NAV_ROW_KEY]),
    );
    expect(
      storage.getItem(PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY),
    ).toBe("2");
    expect(
      storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_MIGRATION_STORAGE_KEY),
    ).toBe("1");
  });

  it("never re-demotes a migrated page that the user moved to the top", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main"]),
    );
    await migrateHiddenPluginNavPanels({
      storage,
      registrationOrder,
      lockManager: null,
    });
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["tasks/main", "docs/main", "github/main", "notes/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main", LEGACY_TOOLS_NAV_ROW_KEY]),
    );
    storage.removeItem(PLUGIN_NAV_PANEL_MIGRATED_VISIBLE_LIMIT_STORAGE_KEY);

    await expect(
      migrateHiddenPluginNavPanels({
        storage,
        registrationOrder,
        lockManager: null,
      }),
    ).resolves.toEqual({
      order: ["tasks/main", "docs/main", "github/main", "notes/main"],
      remainingHiddenKeys: [LEGACY_TOOLS_NAV_ROW_KEY],
      migratedVisibleLimit: null,
    });
    expect(storage.getItem(HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY)).toBe(
      JSON.stringify([LEGACY_TOOLS_NAV_ROW_KEY]),
    );
  });

  it("serializes concurrent windows and dedupes the order on read", async () => {
    const storage = new MemoryStorage();
    const lockManager = new SerializedLockManager();
    storage.setItem(
      PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
      JSON.stringify(["docs/main", "docs/main", "tasks/main"]),
    );
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(["tasks/main"]),
    );

    const [first, second] = await Promise.all([
      migrateHiddenPluginNavPanels({ storage, registrationOrder, lockManager }),
      migrateHiddenPluginNavPanels({ storage, registrationOrder, lockManager }),
    ]);
    expect(first).toEqual({
      order: ["docs/main", "github/main", "notes/main", "tasks/main"],
      remainingHiddenKeys: [],
      migratedVisibleLimit: 3,
    });
    expect(second).toEqual(first);
    expect(
      JSON.parse(storage.getItem(PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY) ?? "[]"),
    ).toEqual(first.order);
  });

  it("records a zero-row fold when every registered page was hidden", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
      JSON.stringify(registrationOrder),
    );

    await expect(
      migrateHiddenPluginNavPanels({
        storage,
        registrationOrder,
        lockManager: null,
      }),
    ).resolves.toMatchObject({
      order: registrationOrder,
      migratedVisibleLimit: 0,
    });
  });
});
