import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { queryFindings } from "./query.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose()));
});

function fixture() {
  const host = createFakePluginHost({ pluginId: `findings-query-${hosts.length}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status, requested_kinds_json,
        started_at, completed_at, accepted_at, error)
     VALUES ('project-1', 'pv-1', 'generation-1', 'accepted', '["finding"]', ?, ?, ?, NULL)`,
  ).run("2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES ('project-1', 'pv-1', 'finding', 'generation-1', NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run("2026-08-13T00:00:00.000Z");
  const insert = db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        cve, component_name, component_version, severity, risk_score, epss_score,
        in_kev, in_vc_kev, reachability_verdict, vex_status, finding_type, raw, pulled_at)
     VALUES ('project-1', 'pv-1', 'generation-1', ?, ?, ?, ?, '1.0.0', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  );
  const at = "2026-08-13T00:00:00.000Z";
  insert.run("a", "key-a", "CVE-1", "alpha", "high", 10, 0.9, 1, 0, "reachable", "IN_TRIAGE", "vulnerability", at);
  insert.run("b", "key-b", "CVE-2", "beta", "high", 10, 0.5, 0, 1, "unreachable", "NOT_AFFECTED", "vulnerability", at);
  insert.run("c", "key-c", "CVE-3", "gamma", "medium", 10, 0.1, 0, 0, null, null, "secret", at);
  insert.run("d", "key-d", "CVE-4", "delta", "low", null, null, 0, 0, null, null, "vulnerability", at);
  return db;
}

describe("findings cache queries", () => {
  it("pages deterministically through equal risk values and rejects oversized limits", () => {
    const db = fixture();
    const first = queryFindings(db, { projectId: "project-1", pvId: "pv-1", limit: 2 });
    expect(first.items.map(item => item.findingId)).toEqual(["a", "b"]);
    expect(first.nextCursor).not.toBeNull();
    const second = queryFindings(db, {
      projectId: "project-1", pvId: "pv-1", limit: 2, cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map(item => item.findingId)).toEqual(["c", "d"]);
    expect(new Set([...first.items, ...second.items].map(item => item.findingId)).size).toBe(4);
    expect(() => queryFindings(db, { projectId: "project-1", pvId: "pv-1", limit: 201 })).toThrow(/between 1 and 200/u);
  });

  it("binds every filter value and returns stale cache metadata without remote access", () => {
    const db = fixture();
    const filtered = queryFindings(db, {
      projectId: "project-1",
      pvId: "pv-1",
      severity: ["high"],
      reachability: "reachable",
      kev: "kev",
      epssGte: 0.8,
      component: "alpha",
      cve: "CVE-1",
      triage: ["IN_TRIAGE"],
      findingType: ["vulnerability"],
    });
    expect(filtered.items.map(item => item.findingId)).toEqual(["a"]);
    expect(queryFindings(db, {
      projectId: "project-1", pvId: "pv-1", component: "%' OR 1=1 --",
    }).total).toBe(0);
    db.prepare(
      "UPDATE sync_state SET error = 'Platform unreachable' WHERE project_id = 'project-1' AND project_version_id = 'pv-1' AND entity_kind = 'finding'",
    ).run();
    const stale = queryFindings(db, { projectId: "project-1", pvId: "pv-1" });
    expect(stale.items).toHaveLength(4);
    expect(stale.cache).toMatchObject({ state: "stale", message: "Platform unreachable" });
    expect(stale.facets.severity).toEqual({ high: 2, low: 1, medium: 1 });
  });
});
