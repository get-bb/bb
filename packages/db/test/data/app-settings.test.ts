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
});
