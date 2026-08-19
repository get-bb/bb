import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  createConnection,
  getAppKeybindingOverrides,
  getAppSettings,
  migrate,
  setAppKeybindingOverrides,
  setAppSettings,
  type DbConnection,
} from "../../src/index.js";

describe("app settings data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("persists keyboard overrides without clobbering general settings", () => {
    const overrides = [
      { command: "thread.new" as const, shortcut: null },
    ];
    setAppSettings(db, {
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      codexMemoryEnabled: false,
    });
    setAppKeybindingOverrides(db, overrides);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      codexMemoryEnabled: false,
    });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);

    setAppSettings(db, defaultAppSettings);
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);
  });

  // Rows outlive the schema: a preference can be retired, and a value written
  // by a newer build can be a shape this one no longer accepts. Neither may
  // take the rest of the settings down with it.
  it("ignores retired keys and falls back per key on an unreadable value", () => {
    setAppSettings(db, {
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
    db.$client.exec(`
      INSERT INTO app_settings_values (key, value, updated_at)
      VALUES ('retiredPreference', 'true', 1)
      ON CONFLICT (key) DO UPDATE SET value = 'true';
      UPDATE app_settings_values
      SET value = '"yes"'
      WHERE key = 'showKeyboardHints';
      UPDATE app_settings_values
      SET value = 'not json'
      WHERE key = 'codexMemoryEnabled';
    `);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
  });
});
