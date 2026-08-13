import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import { findingStableKey } from "../../../lib/sync/registry.js";
import { rebuildOverlayIndex } from "../overlay/indexer.js";
import { readOverlayFiles, serializeOverlay } from "../overlay/reader.js";
import { decisionFromInput, stableKeyFor, type DecisionInput, type VexTuple } from "../overlay/schema.js";
import { setDecision } from "../overlay/writer.js";
import { classifyDrift, readDriftReport } from "./classify.js";
import { driftTotals, type DriftItem, type DriftState } from "./report.js";

const PROJECT = "project-drift";
const PV = "pv-new";
const GENERATION = "generation-new";
const AT = "2026-08-13T12:00:00.000Z";
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

interface Identity {
  cve: string;
  purl: string | null;
  name: string;
  group: string | null;
  version: string | null;
}

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "fs-drift-classify-")));
  roots.push(root);
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
  return { root, db };
}

function findingKey(identity: Identity): string {
  return findingStableKey({
    cve: identity.cve,
    purl: identity.purl,
    name: identity.name,
    group: identity.group,
    version: identity.version,
  });
}

function addFinding(
  value: Awaited<ReturnType<typeof fixture>>,
  id: string,
  identity: Identity,
  tuple: Partial<VexTuple> = {},
): void {
  value.db.prepare(
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
    findingKey(identity),
    identity.cve,
    identity.name,
    identity.group,
    identity.version,
    identity.purl,
    tuple.status ?? null,
    tuple.justification ?? null,
    tuple.response ?? null,
    tuple.reason ?? null,
    AT,
  );
}

async function addDecision(
  value: Awaited<ReturnType<typeof fixture>>,
  identity: Identity,
  options: {
    pin?: DecisionInput["pin"];
    local?: VexTuple;
    base?: VexTuple | null;
  } = {},
): Promise<string> {
  const component = {
    purl: identity.purl,
    name: identity.name,
    group: identity.group,
    version: identity.version,
  };
  const local = options.local ?? {
    status: "IN_TRIAGE",
    justification: null,
    response: null,
    reason: "local review",
  };
  const stableKey = stableKeyFor(PROJECT, component, identity.cve);
  await setDecision(value.root, {
    project: PROJECT,
    component,
    cve: identity.cve,
    stableKey,
    status: local.status ?? "IN_TRIAGE",
    justification: local.justification,
    response: local.response,
    reason: local.reason ?? "local review",
    pin: options.pin ?? "exact_version",
    provenance: { by: "engineer", at: AT, evidence: "ticket FS-44" },
    sync: { base: options.base === undefined ? local : options.base, pushed_at: null },
  });
  return stableKey;
}

async function refresh(value: Awaited<ReturnType<typeof fixture>>) {
  await rebuildOverlayIndex(value.db, value.root);
  return classifyDrift({ db: value.db, root: value.root, projectId: PROJECT }, PV);
}

function expectOnly(item: DriftItem, state: DriftState, totals: Record<DriftState, number>): void {
  expect(item.state).toBe(state);
  expect(totals).toEqual({ ...driftTotals(), [state]: 1 });
}

describe("re-scan drift classification", () => {
  it("reattaches a new UUID at the same purl as noop", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-NOOP", purl: "pkg:generic/acme/noop@1", name: "noop", group: "acme", version: "1" };
    addFinding(value, "new-uuid", identity, { status: "IN_TRIAGE", reason: "local review" });
    await addDecision(value, identity);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "reattached_noop", report.totals);
    expect(value.db.prepare("SELECT component_key FROM overlay_index WHERE entity_kind = 'vexDecision'").get())
      .toEqual({ component_key: null });
  });

  it("classifies a resolved identity with missed carry-forward as reapply", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-REAPPLY", purl: "pkg:generic/acme/reapply@1", name: "reapply", group: "acme", version: "1" };
    addFinding(value, "new-uuid", identity);
    await addDecision(value, identity);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "reapply", report.totals);
  });

  it("falls back from authored purl to folded name-group-version", async () => {
    const value = await fixture();
    const authored = { cve: "CVE-FOLDED", purl: "pkg:generic/old/folded@4.1.0-Final", name: "FoLdEd", group: "ACME", version: "4.1.0-Final" };
    addFinding(value, "folded-new", { ...authored, purl: null, name: "folded", group: "acme" });
    await addDecision(value, authored);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "reapply", report.totals);
    expect(report.items[0]?.tier).toBe(2);
  });

  it("promotes an any-version decision through name-group matching", async () => {
    const value = await fixture();
    const authored = { cve: "CVE-PROMOTED", purl: null, name: "promoted", group: "acme", version: "1" };
    addFinding(value, "promoted-new", { ...authored, version: "2" });
    await addDecision(value, authored, { pin: "any_version" });
    const report = await refresh(value);
    expectOnly(report.items[0]!, "reapply", report.totals);
    expect(report.items[0]?.tier).toBe(3);
  });

  it("stales exact-version CODE_NOT_REACHABLE decisions and distinguishes re-casing", async () => {
    const value = await fixture();
    const authored = { cve: "CVE-STALE", purl: null, name: "stale", group: "acme", version: "4.1.0-Final" };
    addFinding(value, "stale-new", { ...authored, version: "4.1.0-final" });
    await addDecision(value, authored, {
      local: {
        status: "NOT_AFFECTED",
        justification: "CODE_NOT_REACHABLE",
        response: null,
        reason: "old callgraph",
      },
    });
    const report = await refresh(value);
    expectOnly(report.items[0]!, "stale", report.totals);
    expect(report.items[0]).toMatchObject({
      previousVersion: "4.1.0-Final",
      currentVersion: "4.1.0-final",
      reason: expect.stringContaining("re-cased"),
    });
  });

  it("describes a genuine exact-version bump as a changed version", async () => {
    const value = await fixture();
    const authored = { cve: "CVE-BUMP", purl: null, name: "bumped", group: "acme", version: "1.0.0" };
    addFinding(value, "bump-new", { ...authored, version: "2.0.0" });
    await addDecision(value, authored);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "stale", report.totals);
    expect(report.items[0]).toMatchObject({
      previousVersion: "1.0.0",
      currentVersion: "2.0.0",
      reason: expect.stringContaining("version changed"),
    });
    expect(report.items[0]?.reason).not.toContain("re-cased");
  });

  it("recovers a soft-deleted decision when a new UUID is re-confirmed without VEX", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-RECOVER", purl: "pkg:generic/acme/recover@1", name: "recover", group: "acme", version: "1" };
    addFinding(value, "old-uuid", identity, { status: "IN_TRIAGE", reason: "local review" });
    value.db.prepare("UPDATE findings SET soft_deleted = 1 WHERE finding_id = 'old-uuid'").run();
    addFinding(value, "new-uuid", identity);
    await addDecision(value, identity);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "reapply", report.totals);
  });

  it("proves a removed component is orphaned", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-ORPHAN", purl: null, name: "removed", group: "acme", version: "1" };
    await addDecision(value, identity);
    const report = await refresh(value);
    expectOnly(report.items[0]!, "orphaned", report.totals);
  });

  it("detects a three-way human conflict", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-CONFLICT", purl: "pkg:generic/acme/conflict@1", name: "conflict", group: "acme", version: "1" };
    addFinding(value, "conflict-new", identity, { status: "RESOLVED", reason: "server edit" });
    await addDecision(value, identity, {
      local: { status: "EXPLOITABLE", justification: null, response: null, reason: "local edit" },
      base: { status: "IN_TRIAGE", justification: null, response: null, reason: "old base" },
    });
    const report = await refresh(value);
    expectOnly(report.items[0]!, "conflict", report.totals);
  });

  it("reports a persisted incomplete local row as needs_completion", async () => {
    const value = await fixture();
    const identity = { cve: "CVE-INCOMPLETE", purl: null, name: "incomplete", group: "acme", version: "1" };
    await addDecision(value, identity);
    await rebuildOverlayIndex(value.db, value.root);
    value.db.prepare("UPDATE overlay_index SET local_state = 'needs_completion'").run();
    const report = classifyDrift({ db: value.db, root: value.root, projectId: PROJECT }, PV);
    expectOnly(report.items[0]!, "needs_completion", report.totals);
  });

  it("refreshes once and serves every large-report page without writes or repeated totals", async () => {
    const value = await fixture();
    const component = { purl: null, name: "paged", group: "acme", version: "1" };
    const firstIdentity = { ...component, cve: "CVE-PAGE-0000" };
    addFinding(value, "page-0", firstIdentity);
    await addDecision(value, firstIdentity);
    const parsed = (await readOverlayFiles(value.root)).files[0]!;
    for (let index = 1; index < 205; index += 1) {
      const cve = `CVE-PAGE-${index.toString().padStart(4, "0")}`;
      const identity = { ...component, cve };
      addFinding(value, `page-${index}`, identity);
      parsed.overlay.decisions[cve] = decisionFromInput({
        project: PROJECT,
        component,
        cve,
        stableKey: stableKeyFor(PROJECT, component, cve),
        status: "IN_TRIAGE",
        justification: null,
        response: null,
        reason: "local review",
        pin: "exact_version",
        provenance: { by: "engineer", at: AT, evidence: "ticket FS-44" },
        sync: {
          base: { status: "IN_TRIAGE", justification: null, response: null, reason: "local review" },
          pushed_at: null,
        },
      });
    }
    await writeFile(parsed.absoluteFile, serializeOverlay(parsed.overlay));
    await rebuildOverlayIndex(value.db, value.root);
    const first = classifyDrift({ db: value.db, root: value.root, projectId: PROJECT, limit: 20 }, PV);
    expect(first.totals.reapply).toBe(205);
    expect(value.db.prepare("SELECT COUNT(*) AS count FROM triage_runs WHERE source = 'drift'").get()).toEqual({ count: 1 });
    const before = value.db.prepare("SELECT total_changes() AS count").get() as { count: number };
    const keys: string[] = [];
    let cursor: string | null = null;
    do {
      const page = readDriftReport({ db: value.db, root: value.root, projectId: PROJECT, cursor, limit: 20 }, PV);
      expect(page.totals.reapply).toBe(205);
      keys.push(...page.items.map((item) => item.stableKey));
      cursor = page.nextCursor;
    } while (cursor !== null);
    const after = value.db.prepare("SELECT total_changes() AS count").get() as { count: number };
    expect(keys).toHaveLength(205);
    expect(new Set(keys)).toHaveLength(205);
    expect(after.count).toBe(before.count);
    expect(value.db.prepare("SELECT COUNT(*) AS count FROM triage_runs WHERE source = 'drift'").get()).toEqual({ count: 1 });
  });
});
