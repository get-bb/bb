import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { componentKeyFromIdentity, recomputeVulnRollup } from "./rollup.js";

interface RollupRow {
  component_key: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev_count: number;
  max_epss: number | null;
  reachability_verdict: string;
}

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}

function seedGeneration(db: Database.Database): void {
  db.exec(`
    INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status,
       requested_kinds_json, started_at, completed_at, accepted_at)
    VALUES
      ('p', 'v', 'sbom-g', 'accepted', '["sbomComponent"]', 'now', 'now', 'now'),
      ('p', 'v', 'finding-g', 'accepted', '["finding"]', 'now', 'now', 'now');
    INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id)
    VALUES
      ('p', 'v', 'sbomComponent', 'sbom-g'),
      ('p', 'v', 'finding', 'finding-g');
  `);
}

function insertComponent(db: Database.Database, name: string): string {
  const purl = `pkg:generic/${name}@1`;
  const key = componentKeyFromIdentity({ purl, name, group: null, version: "1" });
  db.prepare(
    `INSERT INTO sbom_components
       (project_id, project_version_id, generation_id, component_id,
        component_key, purl, name, version, raw, pulled_at)
     VALUES ('p', 'v', 'sbom-g', ?, ?, ?, ?, '1', '{}', 'now')`,
  ).run(`id-${name}`, key, purl, name);
  return key;
}

function insertFinding(
  db: Database.Database,
  id: string,
  name: string,
  severity: string,
  score: number | null,
  epss: number | null,
  kev = 0,
): void {
  db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        component_name, component_version, component_purl, severity, epss_score,
        in_kev, reachability_score, raw, pulled_at)
     VALUES ('p', 'v', 'finding-g', ?, ?, ?, '1', ?, ?, ?, ?, ?, '{}', 'now')`,
  ).run(id, `finding-${id}`, name, `pkg:generic/${name}@1`, severity, epss, kev, score);
}

describe("SBOM vulnerability rollup", () => {
  it("aggregates severity, KEV, EPSS, and every reachability truth-table state", () => {
    const db = createDb();
    seedGeneration(db);
    const keys = Object.fromEntries(
      ["reachable", "unreachable", "mixed", "unknown", "empty"].map((name) => [name, insertComponent(db, name)]),
    );
    insertFinding(db, "r1", "reachable", "critical", 0.8, 0.91, 1);
    insertFinding(db, "r2", "reachable", "high", 0.2, 0.34);
    insertFinding(db, "u1", "unreachable", "medium", -0.4, 0.12);
    insertFinding(db, "m1", "mixed", "low", -0.1, 0.4);
    insertFinding(db, "m2", "mixed", "critical", 0.1, 0.8);
    insertFinding(db, "x1", "unknown", "high", 0, null);

    expect(recomputeVulnRollup(db, "v")).toBe(5);
    const rows = db.prepare<[], RollupRow>(
      `SELECT component_key, critical, high, medium, low, kev_count,
              max_epss, reachability_verdict
         FROM sbom_vuln_rollup ORDER BY component_key`,
    ).all();
    const byKey = new Map(rows.map((row) => [row.component_key, row]));
    expect(byKey.get(keys.reachable)).toMatchObject({
      critical: 1, high: 1, medium: 0, low: 0, kev_count: 1,
      max_epss: 0.91, reachability_verdict: "reachable",
    });
    expect(byKey.get(keys.unreachable)).toMatchObject({ reachability_verdict: "unreachable" });
    expect(byKey.get(keys.mixed)).toMatchObject({ reachability_verdict: "mixed" });
    expect(byKey.get(keys.unknown)).toMatchObject({ reachability_verdict: "unknown" });
    expect(byKey.get(keys.empty)).toMatchObject({
      critical: 0, high: 0, medium: 0, low: 0, kev_count: 0,
      max_epss: null, reachability_verdict: "unknown",
    });
    db.close();
  });

  it("uses folded NVG identity without UUIDs and reports unresolved findings once", () => {
    const db = createDb();
    seedGeneration(db);
    const key = componentKeyFromIdentity({ purl: null, name: "OpenSSL", group: "Core", version: "3.0" });
    expect(key).toBe(componentKeyFromIdentity({ purl: null, name: "openssl", group: "core", version: "3.0" }));
    expect(key).not.toContain("component-uuid");
    expect(componentKeyFromIdentity({
      purl: "pkg:generic/openssl@3.0",
      name: "ignored-a",
      group: null,
      version: null,
    })).toBe(componentKeyFromIdentity({
      purl: "pkg:generic/openssl@3.0",
      name: "ignored-b",
      group: "different",
      version: "different",
    }));
    db.prepare(
      `INSERT INTO sbom_components
       (project_id, project_version_id, generation_id, component_id,
        component_key, name, component_group, version, raw, pulled_at)
       VALUES ('p', 'v', 'sbom-g', 'component-uuid', ?, 'OpenSSL', 'Core', '3.0', '{}', 'now')`,
    ).run(key);
    db.prepare(
      `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        component_name, component_group, component_version, severity,
        reachability_score, raw, pulled_at)
       VALUES
       ('p', 'v', 'finding-g', 'matched', 'finding-1', 'openssl', 'core', '3.0', 'high', -1, '{}', 'now'),
       ('p', 'v', 'finding-g', 'ignored', 'finding-2', 'other', NULL, '1', 'low', 1, '{}', 'now')`,
    ).run();
    const warn = vi.fn();
    recomputeVulnRollup(db, "v", { warn });
    expect(db.prepare("SELECT high, reachability_verdict FROM sbom_vuln_rollup").get()).toEqual({
      high: 1,
      reachability_verdict: "unreachable",
    });
    expect(warn).toHaveBeenCalledWith(
      "Ignored findings without a resolvable SBOM component",
      { count: 1, projectVersionId: "v" },
    );
    db.close();
  });
});
