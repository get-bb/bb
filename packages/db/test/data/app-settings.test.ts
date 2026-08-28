import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultAppSettings, defaultThreadSettings } from "@bb/domain";
import {
  getAppKeybindingOverrides,
  getAppSettings,
  getThreadSettings,
  setAppKeybindingOverrides,
  setAppSettings,
  setThreadSettings,
  type DbConnection,
} from "../../src/index.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

describe("app settings data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("persists keyboard overrides without clobbering general settings", () => {
    const overrides = [{ command: "thread.new" as const, shortcut: null }];
    setAppSettings(db, {
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      providerOrder: ["pi"],
      defaultProviderId: "pi",
    });
    setAppKeybindingOverrides(db, overrides);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      showKeyboardHints: false,
      steerActiveThreadOnEnter: true,
      providerOrder: ["pi"],
      defaultProviderId: "pi",
    });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);

    setAppSettings(db, defaultAppSettings);
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);
  });

  it("defaults and persists thread settings without clobbering general settings", () => {
    expect(getThreadSettings(db)).toEqual(defaultThreadSettings);

    setAppSettings(db, {
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
    setThreadSettings(db, { archivedConversationRetention: "30-days" });

    expect(getThreadSettings(db)).toEqual({
      archivedConversationRetention: "30-days",
    });
    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
  });

  it("falls back to the thread-setting default for a corrupt value", () => {
    setThreadSettings(db, { archivedConversationRetention: "30-days" });
    db.$client.exec(`
      UPDATE app_settings_values
      SET value = '"one-year"'
      WHERE key = 'threads.archivedConversationRetention';
    `);

    expect(getThreadSettings(db)).toEqual(defaultThreadSettings);
  });

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
      WHERE key = 'providerOrder';
    `);

    expect(getAppSettings(db)).toEqual({
      ...defaultAppSettings,
      steerActiveThreadOnEnter: true,
    });
  });
});
