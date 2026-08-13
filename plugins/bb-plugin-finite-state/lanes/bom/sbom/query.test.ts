import { performance } from "node:perf_hooks";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { registerBom } from "../register.js";
import { querySbom } from "./query.js";
import { componentKeyFromIdentity } from "./rollup.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const migration of MIGRATIONS) db.exec(migration);
  db.exec(`
    INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status,
       requested_kinds_json, started_at, completed_at, accepted_at)
    VALUES ('p', 'v', 'g', 'accepted', '["sbomComponent"]',
            '2026-08-12T20:00:00.000Z', '2026-08-12T20:00:00.000Z',
            '2026-08-12T20:00:00.000Z');
    INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id,
       base_revision, last_pull)
    VALUES ('p', 'v', 'sbomComponent', 'g', 1, '2026-08-12T20:00:00.000Z');
  `);
  return db;
}

function insert(
  db: Database.Database,
  input: {
    id: string;
    name: string;
    purl?: string | null;
    license?: string;
    reachability?: string;
    kev?: number;
    severity?: "critical" | "high" | "medium" | "low";
  },
): string {
  const purl = input.purl === undefined ? `pkg:generic/${input.id}@1` : input.purl;
  const key = componentKeyFromIdentity({ purl, name: input.name, group: "group", version: "1" });
  db.prepare(
    `INSERT INTO sbom_components
       (project_id, project_version_id, generation_id, component_id, component_key,
        purl, name, component_group, version, license, supplier, file_locations,
        raw, pulled_at)
     VALUES ('p', 'v', 'g', ?, ?, ?, ?, 'group', '1', ?, 'supplier', ?, '{}',
             '2026-08-12T20:00:00.000Z')`,
  ).run(input.id, key, purl, input.name, input.license ?? null, JSON.stringify([`/${input.id}`]));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  if (input.severity) counts[input.severity] = 1;
  db.prepare(
    `INSERT OR IGNORE INTO sbom_vuln_rollup
       (project_id, project_version_id, generation_id, component_key,
        critical, high, medium, low, kev_count, max_epss,
        reachability_verdict, computed_at)
     VALUES ('p', 'v', 'g', ?, ?, ?, ?, ?, ?, 0.7, ?, 'now')`,
  ).run(
    key,
    counts.critical,
    counts.high,
    counts.medium,
    counts.low,
    input.kev ?? 0,
    input.reachability ?? "unknown",
  );
  return key;
}

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

describe("cached SBOM query", () => {
  it("filters every supported predicate and returns stable cursor pages", () => {
    const db = createDb();
    insert(db, { id: "a", name: "Equal", license: "MIT", severity: "critical", kev: 1, reachability: "reachable" });
    const second = insert(db, { id: "b", name: "Equal", license: "Apache-2.0", severity: "medium", reachability: "unreachable" });
    const noPurl = insert(db, { id: "c", name: "No Purl", purl: null, license: "MIT", severity: "low", reachability: "unknown" });

    const firstPage = querySbom(db, { projectVersionId: "v", limit: 1, search: "equal" });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.cursor).not.toBeNull();
    const nextPage = querySbom(db, {
      projectVersionId: "v",
      limit: 1,
      search: "equal",
      cursor: firstPage.cursor ?? undefined,
    });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]!.componentKey).not.toBe(firstPage.items[0]!.componentKey);
    expect(querySbom(db, { projectVersionId: "v", purl: "generic/b", limit: 20 }).items[0]!.componentKey).toBe(second);
    expect(querySbom(db, { projectVersionId: "v", license: "MIT", limit: 20 }).total).toBe(2);
    expect(querySbom(db, { projectVersionId: "v", minimumSeverity: "high", limit: 20 }).total).toBe(1);
    expect(querySbom(db, { projectVersionId: "v", kev: true, limit: 20 }).total).toBe(1);
    expect(querySbom(db, { projectVersionId: "v", reachability: "unreachable", limit: 20 }).total).toBe(1);
    expect(querySbom(db, { projectVersionId: "v", componentKey: noPurl, limit: 20 }).items[0]).toMatchObject({
      componentKey: noPurl,
      purl: null,
      files: ["/c"],
    });
    db.close();
  });

  it("enforces the 200 row maximum and rejects malformed cursors with BAD_CURSOR", () => {
    const db = createDb();
    expect(() => querySbom(db, { projectVersionId: "v", limit: 201 })).toThrow(/between 1 and 200/u);
    expect(() => querySbom(db, { projectVersionId: "v", cursor: "not-a-cursor" })).toThrowError(
      expect.objectContaining({ code: "BAD_CURSOR" }),
    );
    db.close();
  });

  it("serves first and filtered pages for 10,000 cached components within the cache budget", () => {
    const db = createDb();
    const write = db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        insert(db, {
          id: `component-${index.toString().padStart(5, "0")}`,
          name: index % 200 === 0 ? `needle-${index}` : `component-${index}`,
          license: index % 2 ? "MIT" : "Apache-2.0",
        });
      }
    });
    write();
    const started = performance.now();
    expect(querySbom(db, { projectVersionId: "v", limit: 50 }).items).toHaveLength(50);
    const firstMs = performance.now() - started;
    const filteredStarted = performance.now();
    expect(querySbom(db, { projectVersionId: "v", search: "needle", limit: 50 }).total).toBe(50);
    const filteredMs = performance.now() - filteredStarted;
    expect(firstMs).toBeLessThan(1_000);
    expect(filteredMs).toBeLessThan(1_000);
    db.close();
  });

  it("registers every frozen BOM RPC and binary seam reload-safely", async () => {
    const host = createFakePluginHost({ pluginId: "finite-state-bom-registration" });
    hosts.push(host);
    registerBom(host.bb, createPluginContext(host.bb));
    const page = await host.harness.behavior.callRpc("bomSoftwareList", {
      projectId: "p",
      projectVersionId: "v",
      pageSize: 20,
      continuation: null,
    });
    expect(page).toMatchObject({ items: [], total: 0, next: null, cache: { state: "empty" } });
    await expect(host.harness.behavior.callRpc("hbomReviewList", {
      projectId: "p",
      projectVersionId: null,
      pageSize: 20,
      continuation: null,
    })).rejects.toThrow(/NOT_IMPLEMENTED/u);
    expect((await host.harness.behavior.fetchHttp("GET", "/sbom/export")).status).toBe(501);
    expect((await host.harness.behavior.fetchHttp("GET", "/hbom/export.xlsx")).status).toBe(501);
    expect((await host.harness.behavior.fetchHttp("GET", "/hbom/export.cdx.json")).status).toBe(501);

    const replacement = await host.harness.lifecycle.reload((bb) => {
      registerBom(bb, createPluginContext(bb));
    });
    hosts.push(replacement);
    expect(await replacement.harness.behavior.callRpc("bomSoftwareList", {
      projectId: "p",
      projectVersionId: "v",
      pageSize: 20,
      continuation: null,
    })).toMatchObject({ items: [], total: 0 });
  });
});
