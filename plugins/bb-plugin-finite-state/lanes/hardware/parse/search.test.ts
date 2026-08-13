import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import {
  getHardwarePart,
  listHardwareNets,
  listHardwareSymbols,
} from "../search.js";

let db: Database.Database;

function createConnection(path = ":memory:"): Database.Database {
  return new Database(path);
}

function migrate(database: Database.Database): void {
  database.transaction(() => {
    for (const statement of MIGRATIONS) database.exec(statement);
  })();
}

beforeEach(() => {
  db = createConnection(":memory:");
  migrate(db);
  db.prepare(`INSERT INTO hw_project (
    project_id, project_version_id, project_key, name, sch_path, pcb_path,
    sch_hash, pcb_hash, kicad_version, discovered_at
  ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`).run(
    "project-1", "@project", "board/semantic.kicad_pro", "semantic",
    "board/semantic.kicad_sch", "a".repeat(64), "20231120", "2026-08-13T00:00:00.000Z",
  );
  const insertSymbol = db.prepare(`INSERT INTO hw_symbol (
    project_id, project_version_id, project_key, sheet_path, reference,
    value, footprint, mpn, manufacturer, at_x, at_y, angle, unit, fields
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const rows = [
    ["root.kicad_sch", "R10", "10k", "R_0805", "RES-10K", "Finite", 10, 10, 0, 1],
    ["root.kicad_sch", "R2", "1k", "R_0603", null, null, 2, 2, 0, 1],
    ["root.kicad_sch", "U3", "Dual op amp", "SOIC-8", "OP-2", "Finite", 3, 3, 0, 1],
    ["child.kicad_sch", "U3", "Dual op amp", "SOIC-8", "OP-2", "Finite", 4, 4, 90, 2],
  ];
  for (const row of rows) insertSymbol.run(
    "project-1", "@project", "board/semantic.kicad_pro", ...row, "{}",
  );
  db.prepare(`INSERT INTO hw_net (
    project_id, project_version_id, project_key, net_name, nodes
  ) VALUES (?, ?, ?, ?, ?)`).run(
    "project-1", "@project", "board/semantic.kicad_pro", "OP_OUT",
    JSON.stringify([{ reference: "U3", pin: "2" }, { reference: "R10", pin: "1" }]),
  );
});

afterEach(() => {
  db.close();
});

const scope = {
  projectId: "project-1",
  projectVersionId: null,
  projectKey: "board/semantic.kicad_pro",
};

describe("hardware semantic search", () => {
  it.each([
    ["r10", "R10"],
    ["dual OP", "U3"],
    ["r_0603", "R2"],
    ["op-2", "U3"],
  ])("finds %s across parsed symbol fields", (query, reference) => {
    const result = listHardwareSymbols(db, {
      ...scope, query, pageSize: 20, cursor: null,
    });
    expect(result.items.map((item) => item.reference)).toEqual([reference]);
  });

  it("naturally sorts stable pages and aggregates multi-unit parts", () => {
    const first = listHardwareSymbols(db, { ...scope, query: "R", pageSize: 1, cursor: null });
    expect(first.items.map((item) => item.reference)).toEqual(["R2"]);
    expect(first.total).toBe(2);
    expect(first.cursor).not.toBeNull();
    expect(listHardwareSymbols(db, {
      ...scope, query: "R", pageSize: 1, cursor: null,
    })).toEqual(first);
    const second = listHardwareSymbols(db, { ...scope, query: "R", pageSize: 1, cursor: first.cursor });
    expect(second.items.map((item) => item.reference)).toEqual(["R10"]);
    expect(listHardwareSymbols(db, {
      ...scope, query: "R", pageSize: 1, cursor: first.cursor,
    })).toEqual(second);

    const part = getHardwarePart(db, { ...scope, reference: "U3" });
    expect(part.units.map(({ unit, sheetPath }) => [unit, sheetPath])).toEqual([
      [2, "child.kicad_sch"],
      [1, "root.kicad_sch"],
    ]);
  });

  it("filters by sheet and exact net membership", () => {
    expect(listHardwareSymbols(db, {
      ...scope, sheetPath: "child.kicad_sch", pageSize: 20, cursor: null,
    }).items.map((item) => item.reference)).toEqual(["U3"]);
    expect(listHardwareSymbols(db, {
      ...scope, netName: "OP_OUT", pageSize: 20, cursor: null,
    }).items.map((item) => item.reference)).toEqual(["R10", "U3"]);
    expect(listHardwareNets(db, {
      ...scope, reference: "U3", pageSize: 20, cursor: null,
    }).items).toMatchObject([{ netName: "OP_OUT" }]);
  });

  it("rejects a cursor issued for a different hardware collection", () => {
    const nets = listHardwareNets(db, { ...scope, pageSize: 1, cursor: null });
    expect(nets.cursor).toBeNull();
    const wrongCursor = Buffer.from("nets:0").toString("base64url");
    expect(() => listHardwareSymbols(db, {
      ...scope, pageSize: 1, cursor: wrongCursor,
    })).toThrow("HW_CURSOR_INVALID");
  });
});
