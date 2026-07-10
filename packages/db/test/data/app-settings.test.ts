import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    setAppSettings(db, { caffeinate: true });
    setAppKeybindingOverrides(db, overrides);

    expect(getAppSettings(db)).toEqual({ caffeinate: true });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);

    setAppSettings(db, { caffeinate: false });
    expect(getAppKeybindingOverrides(db)).toEqual(overrides);
  });
});
