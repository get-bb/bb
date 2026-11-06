import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  isSqliteForeignKeyConstraint,
  isSqliteUniqueConstraintOnColumns,
} from "../src/sqlite-errors.js";
import { createMigratedConnection } from "../src/testing.js";
import type { DbConnection } from "../src/connection.js";

const openConnections: DbConnection[] = [];

function connect(): DbConnection {
  const db = createMigratedConnection();
  db.run(
    sql`create table error_parents (id text primary key, slug text unique, name text)`,
  );
  db.run(
    sql`create table error_children (parent_id text not null references error_parents(id))`,
  );
  openConnections.push(db);
  return db;
}

function captureError(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the statement to fail");
}

afterEach(() => {
  for (const db of openConnections.splice(0)) {
    db.$client.close();
  }
});

describe("sqlite constraint errors raised through drizzle", () => {
  it("recognizes unique violations on the named columns", () => {
    const db = connect();
    db.run(sql`insert into error_parents values ('a', 'x', 'n')`);
    const error = captureError(() =>
      db.run(sql`insert into error_parents values ('b', 'x', 'n')`),
    );

    expect(
      isSqliteUniqueConstraintOnColumns(error, {
        columnNames: ["slug"],
        indexName: "unused_index",
        tableName: "error_parents",
      }),
    ).toBe(true);
    expect(
      isSqliteUniqueConstraintOnColumns(error, {
        columnNames: ["name"],
        indexName: "unused_index",
        tableName: "error_parents",
      }),
    ).toBe(false);
    expect(isSqliteForeignKeyConstraint(error)).toBe(false);
  });

  it("recognizes foreign key violations", () => {
    const db = connect();
    const error = captureError(() =>
      db.run(sql`insert into error_children values ('missing')`),
    );

    expect(isSqliteForeignKeyConstraint(error)).toBe(true);
    expect(
      isSqliteUniqueConstraintOnColumns(error, {
        columnNames: ["parent_id"],
        indexName: "unused_index",
        tableName: "error_children",
      }),
    ).toBe(false);
  });

  it("ignores errors that are not from sqlite", () => {
    const error = new Error("UNIQUE constraint failed: error_parents.id");

    expect(
      isSqliteUniqueConstraintOnColumns(error, {
        columnNames: ["id"],
        indexName: "unused_index",
        tableName: "error_parents",
      }),
    ).toBe(false);
  });
});
