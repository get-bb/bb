import { describe, expect, it } from "vitest";
import { createConnection, migrate } from "../src/index.js";
import { restoreDiffViewedFilesTable } from "./helpers/rewind.js";

const handoffMigrationWhen = 1793738260717;

function databaseBeforeHandoff(
  marks: readonly [string, string, string, string, number][],
) {
  const db = createConnection(":memory:");
  migrate(db);
  restoreDiffViewedFilesTable(db);
  db.$client.pragma("foreign_keys = OFF");
  const insert = db.$client.prepare(
    "INSERT INTO diff_viewed_files (environment_id, target_key, path, revision, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const mark of marks) insert.run(...mark);
  db.$client.pragma("foreign_keys = ON");
  db.$client
    .prepare("DELETE FROM __drizzle_migrations WHERE created_at >= ?")
    .run(handoffMigrationWhen);
  return db;
}

function gitPluginRows(db: ReturnType<typeof createConnection>) {
  return db.$client
    .prepare<[], { key: string; value: string; updatedAt: number }>(
      "SELECT key, value, updated_at AS updatedAt FROM plugin_kv WHERE plugin_id = 'bb--git'",
    )
    .all();
}

describe("Viewed marks handoff migration", () => {
  it("hands every Viewed mark to the Git plugin and drops core's table", () => {
    const db = databaseBeforeHandoff([
      ["env_1", "uncommitted", "a.ts", "rev-a", 10],
      ["env_1", "commit:abcdef1", "b.ts", "rev-b", 30],
      ["env_2", "all:main", "c.ts", "rev-c", 20],
    ]);
    try {
      migrate(db);
      const rows = gitPluginRows(db);
      expect(rows).toEqual([
        { key: "viewedMarksFromCore", value: expect.any(String), updatedAt: 30 },
      ]);
      expect(JSON.parse(rows[0]!.value)).toEqual(
        expect.arrayContaining([
          {
            environmentId: "env_1",
            targetKey: "uncommitted",
            path: "a.ts",
            revision: "rev-a",
            updatedAt: 10,
          },
          {
            environmentId: "env_1",
            targetKey: "commit:abcdef1",
            path: "b.ts",
            revision: "rev-b",
            updatedAt: 30,
          },
          {
            environmentId: "env_2",
            targetKey: "all:main",
            path: "c.ts",
            revision: "rev-c",
            updatedAt: 20,
          },
        ]),
      );
      expect(
        db.$client
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'diff_viewed_files'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      db.$client.close();
    }
  });

  it("stores nothing for the Git plugin when there were no marks", () => {
    const db = databaseBeforeHandoff([]);
    try {
      migrate(db);
      expect(gitPluginRows(db)).toEqual([]);
    } finally {
      db.$client.close();
    }
  });
});
