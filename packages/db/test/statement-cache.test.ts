import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { cacheSqliteStatements } from "../src/statement-cache.js";
import { createMigratedConnection } from "../src/testing.js";
import { appSettingsValues as benchSettings } from "../src/schema.js";

const SELECT_ITEMS = "SELECT id, name FROM items ORDER BY id";

describe("cacheSqliteStatements", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    cacheSqliteStatements(sqlite, 2);
    sqlite.exec(
      "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL); INSERT INTO items VALUES (1, 'a'), (2, 'b');",
    );
  });

  afterEach(() => {
    if (sqlite.open) sqlite.close();
  });

  it("hands out rows in the default shape after another caller used raw mode", () => {
    expect(sqlite.prepare(SELECT_ITEMS).raw().all()).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(sqlite.prepare(SELECT_ITEMS).all()).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });

  it("leaves statements a caller configured or bound to that caller", () => {
    const plucked = sqlite.prepare(SELECT_ITEMS).pluck();
    const bound = sqlite.prepare("SELECT name FROM items WHERE id = ?").bind(1);
    expect(sqlite.prepare(SELECT_ITEMS).all()).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(
      sqlite.prepare("SELECT name FROM items WHERE id = ?").get(2),
    ).toEqual({ name: "b" });
    expect(plucked.all()).toEqual([1, 2]);
    expect(bound.get()).toEqual({ name: "a" });
  });

  it("prepares a separate statement while the cached one is iterating", () => {
    const seen: unknown[] = [];
    for (const row of sqlite.prepare(SELECT_ITEMS).iterate()) {
      seen.push(row, sqlite.prepare(SELECT_ITEMS).get());
    }
    expect(seen).toEqual([
      { id: 1, name: "a" },
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 1, name: "a" },
    ]);
  });

  it("keeps only the most recently used statements", () => {
    const first = sqlite.prepare("SELECT 1");
    const second = sqlite.prepare("SELECT 2");
    expect(sqlite.prepare("SELECT 1")).toBe(first);
    sqlite.prepare("SELECT 3");
    expect(sqlite.prepare("SELECT 1")).toBe(first);
    expect(sqlite.prepare("SELECT 2")).not.toBe(second);
  });

  it("applies a later defaultSafeIntegers change to reused SQL", () => {
    expect(sqlite.prepare("SELECT 9007199254740993 AS n").get()).toEqual({
      n: 9007199254740992,
    });
    sqlite.defaultSafeIntegers(true);
    expect(sqlite.prepare("SELECT 9007199254740993 AS n").get()).toEqual({
      n: 9007199254740993n,
    });
  });
});

describe("createConnection statement cache", () => {
  it("returns objects from raw SQL that matches a builder query's SQL", () => {
    const db = createMigratedConnection();
    try {
      db.insert(benchSettings)
        .values({ key: "statement-cache", value: "1", updatedAt: 1 })
        .run();
      const builder = db.select({ key: benchSettings.key }).from(benchSettings);
      expect(builder.all()).toContainEqual({ key: "statement-cache" });
      expect(db.all(sql.raw(builder.toSQL().sql))).toEqual(builder.all());
    } finally {
      db.$client.close();
    }
  });
});
