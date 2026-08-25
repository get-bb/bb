import { describe, expect, it } from "vitest";
import { defaultExperiments } from "@bb/domain";
import {
  createConnection,
  getExperiments,
  getStoredExperiments,
  migrate,
  setExperiments,
} from "../src/index.js";

describe("experiments", () => {
  it("stores typed experiment keys and ignores unknown stored keys", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      expect(getExperiments(db)).toEqual(defaultExperiments);
      // Never-saved keys are omitted from the stored view, not defaulted.
      expect(getStoredExperiments(db)).toEqual({});

      const experiments = {
        ...defaultExperiments,
        mobileApp: true,
      };
      setExperiments(db, experiments);
      expect(getStoredExperiments(db)).toEqual(experiments);
      db.$client
        .prepare(
          "INSERT INTO system_experiments (key, value, updated_at) VALUES ('futureExperiment', true, 1)",
        )
        .run();

      expect(getExperiments(db)).toEqual(experiments);
      expect(
        db.$client
          .prepare<[], { key: string }>(
            "SELECT key FROM system_experiments ORDER BY key",
          )
          .all()
          .map((row) => row.key),
      ).toEqual([
        "changelogPreview",
        "editMessages",
        "futureExperiment",
        "mobileApp",
        "providerSessionReaping",
        "timelineWindowing",
      ]);
    } finally {
      db.$client.close();
    }
  });
});
