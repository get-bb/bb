import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { registerBom } from "../register.js";
import {
  queryComponentFindings,
  queryComponentLinks,
  querySbom,
} from "./query.js";
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
    source?: string;
  },
): string {
  const purl =
    input.purl === undefined ? `pkg:generic/${input.id}@1` : input.purl;
  const key = componentKeyFromIdentity({
    purl,
    name: input.name,
    group: "group",
    version: "1",
  });
  db.prepare(
    `INSERT INTO sbom_components
       (project_id, project_version_id, generation_id, component_id, component_key,
        purl, name, component_group, version, license, supplier, source, file_locations,
        raw, pulled_at)
     VALUES ('p', 'v', 'g', ?, ?, ?, ?, 'group', '1', ?, 'supplier', ?, ?, '{}',
             '2026-08-12T20:00:00.000Z')`,
  ).run(
    input.id,
    key,
    purl,
    input.name,
    input.license ?? null,
    input.source ?? null,
    JSON.stringify([`/${input.id}`]),
  );
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
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

describe("cached SBOM query", () => {
  it("filters every supported predicate and returns stable cursor pages", () => {
    const db = createDb();
    insert(db, {
      id: "a",
      name: "Equal",
      license: "MIT",
      severity: "critical",
      kev: 1,
      reachability: "reachable",
    });
    const second = insert(db, {
      id: "b",
      name: "Equal",
      license: "Apache-2.0",
      severity: "medium",
      reachability: "unreachable",
    });
    const noPurl = insert(db, {
      id: "c",
      name: "No Purl",
      purl: null,
      license: "MIT",
      severity: "low",
      reachability: "unknown",
    });

    const firstPage = querySbom(db, {
      projectVersionId: "v",
      limit: 1,
      search: "equal",
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.cursor).not.toBeNull();
    const nextPage = querySbom(db, {
      projectVersionId: "v",
      limit: 1,
      search: "equal",
      cursor: firstPage.cursor ?? undefined,
    });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]!.componentKey).not.toBe(
      firstPage.items[0]!.componentKey,
    );
    expect(
      querySbom(db, { projectVersionId: "v", purl: "generic/b", limit: 20 })
        .items[0]!.componentKey,
    ).toBe(second);
    expect(
      querySbom(db, { projectVersionId: "v", license: "MIT", limit: 20 }).total,
    ).toBe(2);
    expect(
      querySbom(db, {
        projectVersionId: "v",
        minimumSeverity: "high",
        limit: 20,
      }).total,
    ).toBe(1);
    expect(
      querySbom(db, { projectVersionId: "v", kev: true, limit: 20 }).total,
    ).toBe(1);
    expect(
      querySbom(db, {
        projectVersionId: "v",
        reachability: "unreachable",
        limit: 20,
      }).total,
    ).toBe(1);
    expect(
      querySbom(db, { projectVersionId: "v", componentKey: noPurl, limit: 20 })
        .items[0],
    ).toMatchObject({
      componentKey: noPurl,
      purl: null,
      files: ["/c"],
    });
    db.close();
  });

  it("enforces the 200 row maximum and rejects malformed cursors with BAD_CURSOR", () => {
    const db = createDb();
    expect(() => querySbom(db, { projectVersionId: "v", limit: 201 })).toThrow(
      /between 1 and 200/u,
    );
    expect(() =>
      querySbom(db, { projectVersionId: "v", cursor: "not-a-cursor" }),
    ).toThrowError(expect.objectContaining({ code: "BAD_CURSOR" }));
    db.close();
  });

  it("filters source/link/local state and cursor-pages every supported sort", () => {
    const db = createDb();
    const linked = insert(db, {
      id: "linked",
      name: "Linked",
      license: "GPL-3.0-only",
      severity: "critical",
      kev: 2,
      source: "sca",
    });
    insert(db, {
      id: "plain",
      name: "Plain",
      license: "MIT",
      source: "manual",
    });
    db.exec(`
      INSERT INTO sync_state
        (project_id, project_version_id, entity_kind, accepted_generation_id,
         base_revision, last_pull)
      VALUES ('p', 'v', 'sbomLink', 'g', 1, '2026-08-12T20:00:00.000Z');
      INSERT INTO base_snapshot
        (project_id, project_version_id, entity_kind, generation_id, entity_key,
         payload, content_hash, pulled_at)
      VALUES ('p', 'v', 'sbomLink', 'g', 'architecture-component',
        '{"purl":"pkg:generic/linked@1","componentSlug":"gateway"}',
        'hash', '2026-08-12T20:00:00.000Z');
      INSERT INTO overlay_index
        (project_id, project_version_id, entity_kind, stable_key, component_key,
         file_path, file_sha256, local_state, indexed_at)
      VALUES ('p', 'v', 'vexDecision', 'finding-key', '${linked}',
        '.fs/triage/finding.yaml', 'hash', 'dirty',
        '2026-08-12T20:00:00.000Z');
    `);
    expect(
      querySbom(db, { projectVersionId: "v", source: "sca" }).items,
    ).toHaveLength(1);
    expect(
      querySbom(db, { projectVersionId: "v", linked: true }).items[0],
    ).toMatchObject({
      componentKey: linked,
      linked: true,
    });
    expect(
      querySbom(db, { projectVersionId: "v", localChange: true }).items[0],
    ).toMatchObject({
      componentKey: linked,
      localChange: true,
    });
    for (const sort of ["name", "severity", "kev", "license"] as const) {
      const first = querySbom(db, {
        projectVersionId: "v",
        limit: 1,
        sort,
        direction: "desc",
      });
      expect(first.cursor).not.toBeNull();
      const second = querySbom(db, {
        projectVersionId: "v",
        limit: 1,
        sort,
        direction: "desc",
        cursor: first.cursor ?? undefined,
      });
      expect(second.items).toHaveLength(1);
      expect(second.items[0]!.componentKey).not.toBe(
        first.items[0]!.componentKey,
      );
    }
    db.close();
  });

  it("projects joined findings, local VEX status, and stable cross-links", () => {
    const db = createDb();
    const componentKey = insert(db, { id: "gateway", name: "Gateway" });
    db.exec(`
      INSERT INTO sync_state
        (project_id, project_version_id, entity_kind, accepted_generation_id,
         base_revision, last_pull)
      VALUES ('p', 'v', 'finding', 'g', 1, '2026-08-12T20:00:00.000Z'),
             ('p', 'v', 'sbomLink', 'g', 1, '2026-08-12T20:00:00.000Z');
      INSERT INTO findings
        (project_id, project_version_id, generation_id, finding_id, stable_key,
         cve, title, component_name, component_group, component_version,
         component_purl, severity, epss_score, in_kev, reachability_verdict,
         raw, pulled_at)
      VALUES ('p', 'v', 'g', 'finding-1', 'stable-finding-1', 'CVE-2026-1',
        'Gateway issue', 'Gateway', 'group', '1', 'pkg:generic/gateway@1',
        'critical', 0.91, 1, 'reachable', '{}',
        '2026-08-12T20:00:00.000Z');
      INSERT INTO overlay_index
        (project_id, project_version_id, entity_kind, stable_key, component_key,
         file_path, file_sha256, vex_status, local_state, indexed_at)
      VALUES ('p', 'v', 'vexDecision', 'stable-finding-1', '${componentKey}',
        '.fs/triage/finding.yaml', 'hash', 'not_affected', 'dirty',
        '2026-08-12T20:00:00.000Z');
      INSERT INTO base_snapshot
        (project_id, project_version_id, entity_kind, generation_id, entity_key,
         payload, content_hash, pulled_at)
      VALUES ('p', 'v', 'sbomLink', 'g', 'gateway',
        '{"purl":"pkg:generic/gateway@1","links":[{"kind":"component","key":"gateway","label":"Gateway controller"},{"kind":"requirement","key":"REQ-7","label":"Secure boot"}]}',
        'hash', '2026-08-12T20:00:00.000Z');
    `);
    expect(queryComponentFindings(db, "p", "v", componentKey)).toEqual([
      expect.objectContaining({
        stableKey: "stable-finding-1",
        cve: "CVE-2026-1",
        kev: true,
        vexStatus: "not_affected",
        localChange: true,
      }),
    ]);
    expect(queryComponentLinks(db, "p", "v", "pkg:generic/gateway@1")).toEqual([
      { kind: "component", key: "gateway", label: "Gateway controller" },
      { kind: "requirement", key: "REQ-7", label: "Secure boot" },
    ]);
    db.close();
  });

  it("serves finding-bearing 10,000-component pages without embedding quadratic detail", () => {
    const db = createDb();
    db.exec(`
      INSERT INTO sync_state
        (project_id, project_version_id, entity_kind, accepted_generation_id,
         base_revision, last_pull)
      VALUES ('p', 'v', 'finding', 'g', 1, '2026-08-12T20:00:00.000Z');
    `);
    const findingInsert = db.prepare(
      `INSERT INTO findings
        (project_id, project_version_id, generation_id, finding_id, stable_key,
         cve, component_name, component_group, component_version, component_purl,
         severity, raw, pulled_at)
       VALUES ('p', 'v', 'g', ?, ?, ?, ?, 'group', '1', ?, 'high', '{}',
               '2026-08-12T20:00:00.000Z')`,
    );
    const write = db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        const id = `component-${index.toString().padStart(5, "0")}`;
        insert(db, {
          id,
          name: index % 200 === 0 ? `needle-${index}` : `component-${index}`,
          license: index % 2 ? "MIT" : "Apache-2.0",
        });
        for (let findingIndex = 0; findingIndex < 4; findingIndex += 1) {
          const findingId = `finding-${index}-${findingIndex}`;
          findingInsert.run(
            findingId,
            `stable-${findingId}`,
            `CVE-2026-${index * 4 + findingIndex}`,
            index % 200 === 0 ? `needle-${index}` : `component-${index}`,
            `pkg:generic/${id}@1`,
          );
        }
      }
    });
    write();
    const started = process.cpuUsage();
    const firstPage = querySbom(db, { projectVersionId: "v", limit: 50 });
    expect(firstPage.items).toHaveLength(50);
    expect("findings" in firstPage.items[0]!).toBe(false);
    const firstCpu = process.cpuUsage(started);
    const filteredStarted = process.cpuUsage();
    expect(
      querySbom(db, { projectVersionId: "v", search: "needle", limit: 50 })
        .total,
    ).toBe(50);
    const filteredCpu = process.cpuUsage(filteredStarted);
    const detailStarted = process.cpuUsage();
    expect(
      queryComponentFindings(
        db,
        "p",
        "v",
        componentKeyFromIdentity({
          purl: "pkg:generic/component-00000@1",
          name: "needle-0",
          group: "group",
          version: "1",
        }),
      ),
    ).toHaveLength(4);
    const detailCpu = process.cpuUsage(detailStarted);
    expect((firstCpu.user + firstCpu.system) / 1_000).toBeLessThan(500);
    expect((filteredCpu.user + filteredCpu.system) / 1_000).toBeLessThan(500);
    expect((detailCpu.user + detailCpu.system) / 1_000).toBeLessThan(1_000);
    db.close();
  });

  it("registers every frozen BOM RPC and binary seam reload-safely", async () => {
    const host = createFakePluginHost({
      pluginId: "finite-state-bom-registration",
    });
    hosts.push(host);
    registerBom(host.bb, createPluginContext(host.bb));
    const page = await host.harness.behavior.callRpc("bomSoftwareList", {
      projectId: "p",
      projectVersionId: "v",
      pageSize: 20,
      continuation: null,
    });
    expect(page).toMatchObject({
      items: [],
      total: 0,
      next: null,
      cache: { state: "empty" },
    });
    await expect(
      host.harness.behavior.callRpc("bomSoftwareList", {
        projectId: "p",
        projectVersionId: "v",
        pageSize: 20,
        continuation: null,
        filters: { unsupported: true },
      }),
    ).rejects.toThrow(/unsupported filters: unsupported/u);
    await expect(
      host.harness.behavior.callRpc("hbomReviewList", {
        projectId: "p",
        projectVersionId: null,
        pageSize: 20,
        continuation: null,
      }),
    ).rejects.toThrow(/NOT_IMPLEMENTED/u);
    const missingExportQuery = await host.harness.behavior.fetchHttp(
      "GET",
      "/sbom/export",
    );
    expect(missingExportQuery.status).toBe(400);
    expect(await missingExportQuery.json()).toEqual({
      error: {
        code: "SBOM_PROJECT_VERSION_INVALID",
        message: "projectVersionId is required.",
      },
    });
    expect(
      (await host.harness.behavior.fetchHttp("GET", "/hbom/export.xlsx"))
        .status,
    ).toBe(501);
    expect(
      (await host.harness.behavior.fetchHttp("GET", "/hbom/export.cdx.json"))
        .status,
    ).toBe(501);

    const replacement = await host.harness.lifecycle.reload((bb) => {
      registerBom(bb, createPluginContext(bb));
    });
    hosts.push(replacement);
    expect(
      await replacement.harness.behavior.callRpc("bomSoftwareList", {
        projectId: "p",
        projectVersionId: "v",
        pageSize: 20,
        continuation: null,
      }),
    ).toMatchObject({ items: [], total: 0 });
  });
});
