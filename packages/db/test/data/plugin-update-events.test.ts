import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createPluginUpdateEvent,
  listPluginUpdateEvents,
  migrate,
  pruneExpiredPluginUpdateEvents,
  type DbConnection,
} from "../../src/index.js";

describe("plugin update event persistence", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => db.$client.close());

  it("retains removal-safe history, orders newest first, and prunes expiry", () => {
    createPluginUpdateEvent(db, {
      id: "older",
      pluginId: "removed-plugin",
      kind: "check",
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      outcome: "update-available",
      detail: null,
      createdAt: 10,
      retainedUntil: 20,
    });
    createPluginUpdateEvent(db, {
      id: "newer",
      pluginId: "removed-plugin",
      kind: "activate",
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      outcome: "updated",
      detail: null,
      createdAt: 11,
      retainedUntil: 30,
    });

    expect(listPluginUpdateEvents(db, { pluginId: "removed-plugin", limit: 1 }))
      .toMatchObject([{ id: "newer" }]);
    expect(pruneExpiredPluginUpdateEvents(db, { now: 20, limit: 50 })).toBe(1);
    expect(listPluginUpdateEvents(db, { limit: 50 })).toMatchObject([
      { id: "newer" },
    ]);
  });
});
