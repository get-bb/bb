import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { findingStableKey, type FindingKeyTier } from "../../../lib/sync/registry.js";
import { classifyDrift } from "./classify.js";

const PROJECT = "project-drift";
const PV = "pv-new";
const GENERATION = "generation-new";
const AT = "2026-08-13T12:00:00.000Z";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function fixture() {
  const host = createFakePluginHost({ pluginId: `drift-classify-${hosts.length}` });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status, requested_kinds_json,
        started_at, completed_at, accepted_at, error)
     VALUES (?, ?, ?, 'accepted', '["finding"]', ?, ?, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT, AT, AT);
  db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        staging_generation_id, base_revision, staging_continuation, staged_pages,
        staged_rows, last_pull, error)
     VALUES (?, ?, 'finding', ?, NULL, 1, NULL, 0, 0, ?, NULL)`,
  ).run(PROJECT, PV, GENERATION, AT);
  return db;
}

interface Identity {
  cve: string;
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
}

function stable(identity: Identity, tier: FindingKeyTier = identity.purl === null ? "name-group-version" : "purl"): string {
  return findingStableKey({
    cve: identity.cve,
    purl: identity.purl,
    name: identity.name,
    group: identity.group,
    version: identity.version,
  }, tier);
}

function finding(
  db: ReturnType<typeof fixture>,
  id: string,
  identity: Identity,
  tuple: { status: string | null; justification?: string | null; response?: string | null; reason?: string | null },
): void {
  db.prepare(
    `INSERT INTO findings
       (project_id, project_version_id, generation_id, finding_id, stable_key,
        cve, component_name, component_group, component_version, component_purl,
        vex_status, vex_justification, vex_response, vex_reason, raw, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    PROJECT,
    PV,
    GENERATION,
    id,
    stable(identity),
    identity.cve,
    identity.name,
    identity.group,
    identity.version,
    identity.purl,
    tuple.status,
    tuple.justification ?? null,
    tuple.response ?? null,
    tuple.reason ?? null,
    AT,
  );
}

function decision(
  db: ReturnType<typeof fixture>,
  identity: Identity,
  options: {
    pin?: "exact_version" | "any_version";
    local?: { status: string; justification?: string | null; response?: string | null; reason?: string | null };
    base?: { status: string | null; justification?: string | null; response?: string | null; reason?: string | null } | null;
    localState?: string;
    tier?: FindingKeyTier;
  } = {},
): string {
  const key = stable(identity, options.tier);
  const local = options.local ?? { status: "IN_TRIAGE", reason: "local review" };
  const base = options.base === undefined ? local : options.base;
  db.prepare(
    `INSERT INTO overlay_index
       (project_id, project_version_id, entity_kind, stable_key, component_key, cve, file_path,
        file_sha256, vex_status, vex_response, vex_justification, vex_reason, pin,
        provenance_by, provenance_at, evidence, sync_base, pushed_at, local_state,
        drift_state, match_tier, policy_warning_count, policy_violation_count, indexed_at)
     VALUES (?, ?, 'vexDecision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engineer', ?, 'ticket', ?, NULL, ?, NULL, NULL, 0, 0, ?)`,
  ).run(
    PROJECT,
    PV,
    key,
    JSON.stringify({ purl: identity.purl, name: identity.name, group: identity.group, version: identity.version }),
    identity.cve,
    `.fs/triage/${PROJECT}/${identity.name}.yaml`,
    "a".repeat(64),
    local.status,
    local.response ?? null,
    local.justification ?? null,
    local.reason ?? null,
    options.pin ?? "exact_version",
    AT,
    base === null ? null : JSON.stringify({
      status: base.status,
      justification: base.justification ?? null,
      response: base.response ?? null,
      reason: base.reason ?? null,
    }),
    options.localState ?? "dirty",
    AT,
  );
  return key;
}

describe("re-scan drift classification", () => {
  it("uses the canonical ladder, classifies every item once, and pages bounded samples", () => {
    const db = fixture();
    const noop = { cve: "CVE-NOOP", purl: "pkg:generic/acme/noop@1", name: "noop", group: "acme", version: "1" };
    finding(db, "old-soft-deleted-uuid", noop, { status: "RESOLVED", reason: "obsolete row" });
    db.prepare("UPDATE findings SET soft_deleted = 1 WHERE finding_id = 'old-soft-deleted-uuid'").run();
    finding(db, "new-uuid", noop, { status: "IN_TRIAGE", reason: "local review" });
    decision(db, noop);

    const reapply = { cve: "CVE-REAPPLY", purl: "pkg:generic/acme/reapply@1", name: "reapply", group: "acme", version: "1" };
    finding(db, "reapply-new-uuid", reapply, { status: null });
    decision(db, reapply);

    const folded = { cve: "CVE-FOLDED", purl: "pkg:generic/old/folded@4.1.0-Final", name: "FoLdEd", group: "ACME", version: "4.1.0-Final" };
    finding(db, "folded-new", { ...folded, purl: null, name: "folded", group: "acme" }, { status: null });
    decision(db, folded);

    const promoted = { cve: "CVE-PROMOTED", purl: null, name: "promoted", group: "acme", version: "1" };
    finding(db, "promoted-new", { ...promoted, version: "2" }, { status: null });
    decision(db, promoted, { pin: "any_version" });

    const stale = { cve: "CVE-STALE", purl: null, name: "stale", group: "acme", version: "1" };
    finding(db, "stale-new", { ...stale, version: "2" }, { status: null });
    decision(db, stale, { pin: "exact_version", local: { status: "NOT_AFFECTED", justification: "CODE_NOT_REACHABLE", reason: "old callgraph" } });

    const orphan = { cve: "CVE-ORPHAN", purl: null, name: "removed", group: "acme", version: "1" };
    decision(db, orphan);

    const conflict = { cve: "CVE-CONFLICT", purl: "pkg:generic/acme/conflict@1", name: "conflict", group: "acme", version: "1" };
    finding(db, "conflict-new", conflict, { status: "RESOLVED", reason: "server edit" });
    decision(db, conflict, {
      local: { status: "EXPLOITABLE", reason: "local edit" },
      base: { status: "IN_TRIAGE", reason: "old base" },
    });

    const incomplete = { cve: "CVE-INCOMPLETE", purl: null, name: "incomplete", group: "acme", version: "1" };
    decision(db, incomplete, { localState: "needs_completion" });

    const first = classifyDrift({ db, projectId: PROJECT, limit: 3 }, PV);
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).toBe(first.items[2]?.stableKey);
    expect(first.totals).toEqual({
      reattached_noop: 1,
      reapply: 3,
      stale: 1,
      orphaned: 1,
      conflict: 1,
      needs_completion: 1,
    });
    const all = classifyDrift({ db, projectId: PROJECT, limit: 200 }, PV);
    expect(all.items.map((item) => item.state).sort()).toEqual([
      "conflict",
      "needs_completion",
      "orphaned",
      "reapply",
      "reapply",
      "reapply",
      "reattached_noop",
      "stale",
    ].sort());
    expect(all.items.find((item) => item.stableKey === stable(folded))).toMatchObject({ state: "reapply", tier: 2 });
    expect(all.items.find((item) => item.stableKey === stable(promoted))).toMatchObject({ state: "reapply", tier: 3 });
    expect(all.items.find((item) => item.stableKey === stable(stale))).toMatchObject({
      state: "stale",
      previousVersion: "1",
      currentVersion: "2",
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM findings").get()).toEqual({ count: 7 });
  });
});
