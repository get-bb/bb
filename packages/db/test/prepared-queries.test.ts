import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { getHost } from "../src/data/hosts.js";
import { getThread } from "../src/data/threads.js";
import { getProject } from "../src/data/projects.js";
import { getEnvironment } from "../src/data/environments.js";
import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { hosts } from "../src/schema.js";

describe("connection prepared queries", () => {
  it.each([getHost, getThread, getProject, getEnvironment])(
    "does not rebuild SQL for warm %s lookups",
    (lookup) => {
      const db = createConnection(":memory:");
      migrate(db);
      const compile = vi.spyOn(SQLiteSyncDialect.prototype, "sqlToQuery");
      try {
        expect(lookup(db, "missing-first")).toBeNull();
        expect(compile).toHaveBeenCalledOnce();
        compile.mockClear();
        for (let i = 0; i < 10; i++) {
          expect(lookup(db, `missing-${i}`)).toBeNull();
        }
        expect(compile).not.toHaveBeenCalled();
      } finally {
        compile.mockRestore();
        db.$client.close();
      }
    },
  );

  it("reuses compiled lookups across transactions while seeing writes and rollbacks", () => {
    const db = createConnection(":memory:");
    const other = createConnection(":memory:");
    migrate(db);
    migrate(other);
    try {
      db.insert(hosts)
        .values({
          id: "host",
          name: "original",
          type: "persistent",
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      expect(getHost(db, "host")?.name).toBe("original");
      expect(getHost(other, "host")).toBeNull();
      const compile = vi.spyOn(SQLiteSyncDialect.prototype, "sqlToQuery");
      try {
        for (let i = 0; i < 3; i++) {
          expect(() =>
            db.transaction((tx) => {
              db.$client
                .prepare("UPDATE hosts SET name = ? WHERE id = ?")
                .run(`changed-${i}`, "host");
              expect(getHost(tx, "host")?.name).toBe(`changed-${i}`);
              throw new Error("rollback");
            }),
          ).toThrow("rollback");
          expect(getHost(db, "host")?.name).toBe("original");
        }
        expect(compile).not.toHaveBeenCalled();
      } finally {
        compile.mockRestore();
      }
    } finally {
      other.$client.close();
      db.$client.close();
    }
  });
});
