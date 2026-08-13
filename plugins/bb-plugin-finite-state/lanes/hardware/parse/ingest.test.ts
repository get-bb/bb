import Database from "better-sqlite3";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { createPluginContext } from "../../../lib/context.js";
import { registerHardware } from "../register.js";
import {
  HardwareIngestHashNotRetainedError,
  diffSymbolSets,
  ingestProject,
  listConnectivityGaps,
  type HardwareSemanticScope,
} from "./ingest.js";
import type { ParsedProject } from "./sheets.js";
import { listHardwareSheets, parseProject } from "./sheets.js";

let db: Database.Database;
const fixtureRoot = dirname(fileURLToPath(new URL(
  "../../../test/fixtures/kicad/semantic/semantic.kicad_pro",
  import.meta.url,
)));
const customFieldsRoot = dirname(fileURLToPath(new URL(
  "../../../test/fixtures/kicad/custom-fields/custom_fields.kicad_pro",
  import.meta.url,
)));

const scope: HardwareSemanticScope = {
  projectId: "project-1",
  projectVersionId: null,
  projectKey: "board/semantic.kicad_pro",
};

function migrate(database: Database.Database): void {
  database.transaction(() => {
    for (const statement of MIGRATIONS) database.exec(statement);
  })();
}

function hash(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function parsed(reference: string): ParsedProject {
  return {
    sheets: [{
      sheetPath: "board/semantic.kicad_sch",
      name: "semantic",
      parent: null,
      pageOrder: 0,
      widthMm: 297,
      heightMm: 210,
      symbols: [{
        reference,
        unit: 1,
        value: "1k",
        footprint: "Resistor_SMD:R_0603",
        mpn: null,
        manufacturer: null,
        at: { x: 20, y: 20, angle: 0 },
        fields: {},
      }],
    }],
    nets: [{ netName: "SIGNAL", nodes: [{ reference, pin: "1" }] }],
    connectivityGaps: [{
      sheetPath: "board/semantic.kicad_sch",
      kind: "unresolved_label",
      detail: `Connected pin ${reference}.2 has no source-defined net name`,
      at: { x: 25, y: 20 },
    }],
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  db.prepare(`INSERT INTO hw_project (
    project_id, project_version_id, project_key, name, sch_path, pcb_path,
    sch_hash, pcb_hash, kicad_version, supported, discovered_at
  ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, 1, ?)`).run(
    scope.projectId, "@project", scope.projectKey, "semantic",
    "board/semantic.kicad_sch", hash(0), "20231120", "2026-08-13T00:00:00.000Z",
  );
});

afterEach(() => {
  db.close();
});

describe("hardware semantic ingest", () => {
  it("exposes empty connectivity diagnostics through the lane-local RPC", async () => {
    const host = createFakePluginHost({ pluginId: `finite-state-ingest-${Math.random()}` });
    const ctx = createPluginContext(host.bb);
    ctx.service("hardware.kicad-capability", async () => ({
      installed: false, cliPath: null, version: null, supported: false,
    }));
    registerHardware(host.bb, ctx);
    await expect(host.harness.behavior.callRpc("hardwareConnectivityGapsList", scope)).resolves.toEqual({
      ...scope, sourceHash: null, gaps: [],
    });
    await host.harness.lifecycle.dispose();
  });

  it("lands a real parsed fixture generation without KiCad exports", async () => {
    const realParsed = await parseProject(fixtureRoot, "semantic.kicad_pro");
    ingestProject(db, scope, hash(1), realParsed);
    const rows = db.prepare(
      "SELECT reference, unit, at_x, at_y FROM hw_symbol",
    ).all();
    expect(rows).toHaveLength(5);
    expect(rows).toEqual(expect.arrayContaining([
      { reference: "R2", unit: 1, at_x: 20, at_y: 20 },
      { reference: "R10", unit: 1, at_x: 60, at_y: 20 },
      { reference: "U3", unit: 1, at_x: 20, at_y: 50 },
      { reference: "U3", unit: 2, at_x: 60, at_y: 70 },
      { reference: "R4", unit: 1, at_x: 30, at_y: 20 },
    ]));
    expect(db.prepare("SELECT net_name FROM hw_net ORDER BY net_name").pluck().all()).toContain("OP_OUT");
  }, 30_000);

  it("ingests the KiCad-authored custom-fields project with strict plain gap points", async () => {
    db.prepare("DELETE FROM hw_project").run();
    const customScope = { ...scope, projectKey: "custom_fields.kicad_pro" };
    db.prepare(`INSERT INTO hw_project (
      project_id, project_version_id, project_key, name, sch_path, pcb_path,
      sch_hash, pcb_hash, kicad_version, supported, discovered_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, 1, ?)`).run(
      customScope.projectId, "@project", customScope.projectKey, "custom_fields",
      "custom_fields.kicad_sch", hash(2), "20210123", "2026-08-13T00:00:00.000Z",
    );
    const realParsed = await parseProject(customFieldsRoot, customScope.projectKey);
    expect(() => ingestProject(db, customScope, hash(2), realParsed)).not.toThrow();
    expect(db.prepare("SELECT reference FROM hw_symbol ORDER BY reference").pluck().all()).toEqual(["J1", "R1"]);
    expect(db.prepare("SELECT COUNT(*) FROM hw_ingest").pluck().get()).toBe(1);
    const gaps = listConnectivityGaps(db, customScope).gaps;
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) {
      if (gap.at) expect(Object.keys(gap.at).sort()).toEqual(["x", "y"]);
    }
  }, 30_000);

  it("replaces sheets, symbols, nets, and gaps atomically and hash-gates a repeat", () => {
    ingestProject(db, scope, hash(1), parsed("R2"));
    expect(db.prepare("SELECT sheet_path, name, page_order FROM hw_sheet").all()).toEqual([{
      sheet_path: "board/semantic.kicad_sch",
      name: "semantic",
      page_order: 0,
    }]);
    expect(db.prepare("SELECT reference, unit, at_x, at_y FROM hw_symbol").all()).toEqual([{
      reference: "R2", unit: 1, at_x: 20, at_y: 20,
    }]);
    expect(listHardwareSheets(db, {
      ...scope, pageSize: 20, cursor: null,
    })).toMatchObject({
      total: 1,
      items: [{
        sheetPath: "board/semantic.kicad_sch",
        name: "semantic",
        parentSheetPath: null,
        breadcrumbs: [{ sheetPath: "board/semantic.kicad_sch", name: "semantic" }],
        symbolCount: 1,
      }],
    });
    expect(listConnectivityGaps(db, scope)).toMatchObject({
      sourceHash: hash(1),
      gaps: [{ kind: "unresolved_label", sheetPath: "board/semantic.kicad_sch" }],
    });

    db.exec(`CREATE TRIGGER reject_repeat BEFORE INSERT ON hw_symbol
      BEGIN SELECT RAISE(ABORT, 'repeat attempted'); END`);
    expect(() => ingestProject(db, scope, hash(1), parsed("R99"))).not.toThrow();
    expect(db.prepare("SELECT reference FROM hw_symbol").pluck().all()).toEqual(["R2"]);
  });

  it("rolls a failed changed-hash replacement back to the prior generation", () => {
    ingestProject(db, scope, hash(1), parsed("R2"));
    db.exec(`CREATE TRIGGER reject_signal BEFORE INSERT ON hw_net
      WHEN NEW.net_name = 'SIGNAL'
      BEGIN SELECT RAISE(ABORT, 'mid-ingest failure'); END`);

    expect(() => ingestProject(db, scope, hash(2), parsed("R10"))).toThrow("mid-ingest failure");
    expect(db.prepare("SELECT reference FROM hw_symbol").pluck().all()).toEqual(["R2"]);
    expect(db.prepare("SELECT source_hash FROM hw_ingest").pluck().all()).toEqual([hash(1)]);
  });

  it("prunes oldest-first to 20 inside the transaction and rejects a pruned diff hash", () => {
    for (let index = 0; index < 20; index += 1) {
      ingestProject(db, scope, hash(index), parsed(`R${index}`));
    }
    db.exec(`CREATE TRIGGER reject_prune BEFORE DELETE ON hw_ingest
      WHEN OLD.source_hash = '${hash(0)}'
      BEGIN SELECT RAISE(ABORT, 'prune failure'); END`);
    expect(() => ingestProject(db, scope, hash(20), parsed("R20"))).toThrow("prune failure");
    expect(db.prepare("SELECT reference FROM hw_symbol").pluck().all()).toEqual(["R19"]);
    expect(db.prepare("SELECT count(*) FROM hw_ingest").pluck().get()).toBe(20);
    expect(db.prepare("SELECT 1 FROM hw_ingest WHERE source_hash = ?").pluck().get(hash(0))).toBe(1);

    db.exec("DROP TRIGGER reject_prune");
    ingestProject(db, scope, hash(20), parsed("R20"));
    expect(db.prepare(
      "SELECT source_hash FROM hw_ingest ORDER BY ingested_at, source_hash",
    ).pluck().all()).toEqual(Array.from({ length: 20 }, (_, index) => hash(index + 1)));
    expect(diffSymbolSets(db, scope, hash(19), hash(20))).toEqual({
      added: ["R20"],
      removed: ["R19"],
    });
    expect(() => diffSymbolSets(db, scope, hash(0), hash(20))).toThrowError(
      HardwareIngestHashNotRetainedError,
    );
    try {
      diffSymbolSets(db, scope, hash(0), hash(20));
    } catch (error) {
      expect(error).toMatchObject({
        code: "HW_INGEST_HASH_NOT_RETAINED",
        message: `HW_INGEST_HASH_NOT_RETAINED: source hash ${hash(0)} is no longer retained`,
      });
    }
  });
});
