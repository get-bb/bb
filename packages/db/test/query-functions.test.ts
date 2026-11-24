import { describe, expect, it } from "vitest";
import { listQueryFunctionsInSource } from "../scripts/query-functions.js";

const FILE = "packages/db/src/data/example.ts";

describe("listQueryFunctionsInSource", () => {
  it("lists exported functions that query directly or through local helpers", () => {
    const source = `
      const prepareLatest = (db) => db.select().from(events).prepare();
      function selectRows(db, threadId) {
        return db.select().from(events).where(eq(events.threadId, threadId)).all();
      }
      function viaHelper(db, threadId) {
        return selectRows(db, threadId);
      }
      export function direct(db) {
        return db.select().from(events).all();
      }
      export function throughHelper(db, threadId) {
        return viaHelper(db, threadId).map((row) => row.id);
      }
      export function throughPreparedHelper(db) {
        return prepareCachedQuery(db, prepareLatest).get();
      }
      export function pure(rows) {
        return rows.map((row) => row.id);
      }
    `;

    expect(listQueryFunctionsInSource(FILE, source)).toEqual([
      `${FILE}#direct`,
      `${FILE}#throughHelper`,
      `${FILE}#throughPreparedHelper`,
    ]);
  });

  it("lists public methods of exported classes that query through this.db", () => {
    const file = "plugins/example/src/store.ts";
    const source = `
      export class Store {
        constructor(private readonly db) {}
        get(id) {
          return this.db.prepare("SELECT * FROM rows WHERE id = ?").get(id);
        }
        latest() {
          return this.#newest();
        }
        #newest() {
          return this.db.prepare("SELECT * FROM rows ORDER BY id DESC").get();
        }
        private count() {
          return this.db.prepare("SELECT count(*) FROM rows").get();
        }
        describe(row) {
          return row.id;
        }
      }
      class Hidden {
        constructor(db) { this.db = db; }
        get() {
          return this.db.prepare("SELECT 1").get();
        }
      }
    `;

    expect(listQueryFunctionsInSource(file, source)).toEqual([
      `${file}#Store.get`,
      `${file}#Store.latest`,
    ]);
  });
});
