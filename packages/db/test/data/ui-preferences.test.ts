import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listStoredUiPreferences,
  overwriteStoredUiPreference,
  replaceStoredUiPreference,
  type DbConnection,
} from "../../src/index.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

describe("ui preferences data", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createMigratedConnection();
  });

  afterEach(() => {
    db.$client.close();
  });

  it("creates a row at revision 1 only when the expected revision is 0", () => {
    expect(listStoredUiPreferences(db)).toEqual([]);
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 3,
        key: "sidebar.organizationMode",
        valueJson: '"machine"',
      }),
    ).toEqual({ outcome: "conflict", revision: 0 });
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 0,
        key: "sidebar.organizationMode",
        valueJson: '"machine"',
      }),
    ).toEqual({ outcome: "updated", revision: 1 });
    expect(listStoredUiPreferences(db)).toEqual([
      {
        key: "sidebar.organizationMode",
        revision: 1,
        valueJson: '"machine"',
      },
    ]);
  });

  it("rejects stale writes and keeps the current value", () => {
    replaceStoredUiPreference(db, {
      expectedRevision: 0,
      key: "sidebar.collapsedProjects",
      valueJson: '["prj_1"]',
    });
    replaceStoredUiPreference(db, {
      expectedRevision: 1,
      key: "sidebar.collapsedProjects",
      valueJson: '["prj_1","prj_2"]',
    });
    expect(
      replaceStoredUiPreference(db, {
        expectedRevision: 1,
        key: "sidebar.collapsedProjects",
        valueJson: "[]",
      }),
    ).toEqual({ outcome: "conflict", revision: 2 });
    expect(listStoredUiPreferences(db)).toEqual([
      {
        key: "sidebar.collapsedProjects",
        revision: 2,
        valueJson: '["prj_1","prj_2"]',
      },
    ]);
  });

  it("overwrites without a revision check and still advances the revision", () => {
    expect(
      overwriteStoredUiPreference(db, {
        key: "sidebar.chronologicalSort",
        valueJson: '"alpha"',
      }),
    ).toEqual({ revision: 1 });
    replaceStoredUiPreference(db, {
      expectedRevision: 1,
      key: "sidebar.chronologicalSort",
      valueJson: '"created"',
    });
    expect(
      overwriteStoredUiPreference(db, {
        key: "sidebar.chronologicalSort",
        valueJson: '"updated"',
      }),
    ).toEqual({ revision: 3 });
    expect(listStoredUiPreferences(db)).toEqual([
      {
        key: "sidebar.chronologicalSort",
        revision: 3,
        valueJson: '"updated"',
      },
    ]);
  });
});
