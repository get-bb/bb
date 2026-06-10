import { describe, expect, it } from "vitest";
import { defaultExperiments } from "@bb/domain";
import { createConnection } from "../../src/connection.js";
import {
  getExperiments,
  setExperiments,
} from "../../src/data/app-settings.js";
import { appSettings } from "../../src/schema.js";
import { migrate } from "../../src/migrate.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  return db;
}

describe("app settings", () => {
  it("returns default experiments when nothing is stored", () => {
    const db = setup();
    expect(getExperiments(db)).toEqual(defaultExperiments);
    expect(defaultExperiments.workflows).toBe(false);
  });

  it("round-trips experiments through set/get", () => {
    const db = setup();
    setExperiments(db, { workflows: true });
    expect(getExperiments(db)).toEqual({ workflows: true });
    setExperiments(db, { workflows: false });
    expect(getExperiments(db)).toEqual({ workflows: false });
  });

  it("falls back to defaults on an unreadable stored value", () => {
    const db = setup();
    db.insert(appSettings)
      .values({ key: "experiments", value: "not json", updatedAt: 1 })
      .run();
    expect(getExperiments(db)).toEqual(defaultExperiments);

    // A value written by a different schema version (wrong shape) also
    // fails closed instead of throwing into config reads.
    setExperiments(db, { workflows: true });
    db.update(appSettings).set({ value: '{"unknown":true}' }).run();
    expect(getExperiments(db)).toEqual(defaultExperiments);
  });
});
