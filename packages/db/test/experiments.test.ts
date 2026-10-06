import { describe, expect, it } from "vitest";
import { defaultExperiments } from "@bb/domain";
import {
  createConnection,
  getExperiments,
  migrate,
  setExperiments,
} from "../src/index.js";

function storedExperimentRows(db: ReturnType<typeof createConnection>) {
  return db.$client
    .prepare<[], { key: string; value: number }>(
      "SELECT key, value FROM system_experiments ORDER BY key",
    )
    .all();
}

describe("experiments", () => {
  it("stores typed experiment keys and ignores unknown stored keys", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      expect(getExperiments(db)).toEqual(defaultExperiments);

      setExperiments(db, { changelogPreview: true });
      db.$client
        .prepare(
          "INSERT INTO system_experiments (key, value, updated_at) VALUES ('futureExperiment', true, 1)",
        )
        .run();

      expect(getExperiments(db)).toEqual({
        ...defaultExperiments,
        changelogPreview: true,
      });
    } finally {
      db.$client.close();
    }
  });

  it("stores only the experiments a write names so the rest follow their defaults", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);
      setExperiments(db, { serverMove: true });
      setExperiments(db, { serverMove: false });

      expect(storedExperimentRows(db)).toEqual([
        { key: "serverMove", value: 0 },
      ]);
      expect(getExperiments(db)).toEqual({
        ...defaultExperiments,
        serverMove: false,
      });
    } finally {
      db.$client.close();
    }
  });
});
