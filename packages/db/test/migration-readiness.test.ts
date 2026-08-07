import { describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  readSqliteMigrationReadiness,
} from "../src/index.js";

describe("readSqliteMigrationReadiness", () => {
  it("reports not-at-head for a fresh, unmigrated connection", () => {
    const db = createConnection(":memory:");
    try {
      const readiness = readSqliteMigrationReadiness(db);
      expect(readiness.atHead).toBe(false);
      expect(readiness.appliedCount).toBe(0);
      expect(readiness.expectedCount).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }
  });

  it("reports at-head after a full migrate() with applied === expected", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      const readiness = readSqliteMigrationReadiness(db);
      expect(readiness.atHead).toBe(true);
      expect(readiness.expectedCount).toBeGreaterThan(0);
      expect(readiness.appliedCount).toBe(readiness.expectedCount);
    } finally {
      db.$client.close();
    }
  });

  it("reports not-at-head when the ledger is emptied under a migrated schema", () => {
    const db = createConnection(":memory:");
    try {
      migrate(db);
      db.$client.prepare("DELETE FROM __drizzle_migrations").run();
      const readiness = readSqliteMigrationReadiness(db);
      expect(readiness.atHead).toBe(false);
      expect(readiness.appliedCount).toBe(0);
      expect(readiness.expectedCount).toBeGreaterThan(0);
    } finally {
      db.$client.close();
    }
  });
});
