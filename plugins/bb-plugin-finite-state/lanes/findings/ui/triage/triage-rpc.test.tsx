import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { findingStableKey } from "../../../../lib/sync/registry.js";
import { findingsUiRpcContract, registerFindingsRpc } from "../../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "fs40-triage-rpc-"));
  roots.push(root);
  const host = createFakePluginHost({
    pluginId: `fs40-triage-${hosts.length}`,
    sdk: { projects: { get: ({ projectId }) => ({ id: projectId, sources: [{ hostId: "host-1", path: root, isDefault: true }] }) } },
  });
  hosts.push(host);
  const db = createPluginContext(host.bb).db();
  db.prepare(`INSERT INTO pull_generation
    (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
    VALUES ('platform-project-1','version-1','generation-1','accepted','["finding"]',?,?,?,NULL)`)
    .run("2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
  db.prepare(`INSERT INTO sync_state
    (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
    VALUES ('platform-project-1','version-1','finding','generation-1',NULL,1,NULL,0,0,?,NULL)`)
    .run("2026-08-13T00:00:00.000Z");
  const stableKey = findingStableKey({ cve: "CVE-2026-0040", purl: "pkg:generic/gateway@1", name: "gateway", version: "1" }, "purl");
  const insert = db.prepare(`INSERT INTO findings
    (project_id, project_version_id, generation_id, finding_id, stable_key, cve, component_name, component_version, component_purl, reachability_verdict, reachability_factors, raw, pulled_at)
    VALUES ('platform-project-1','version-1','generation-1',?,?,?,?,?,?,'unreachable',?,'{}',?)`);
  for (const findingId of ["exact-row-a", "collision-row-b"]) {
    insert.run(findingId, stableKey, "CVE-2026-0040", "gateway", "1", "pkg:generic/gateway@1", '[{"label":"Call graph","value":"no path","source":"analysis"}]', "2026-08-13T00:00:00.000Z");
  }
  const secondStableKey = findingStableKey({ cve: "CVE-2026-0041", purl: "pkg:generic/gateway@1", name: "gateway", version: "1" }, "purl");
  insert.run("exact-row-c", secondStableKey, "CVE-2026-0041", "gateway", "1", "pkg:generic/gateway@1", '[{"label":"Call graph","value":"no path","source":"analysis"}]', "2026-08-13T00:00:00.000Z");
  registerFindingsRpc(host.bb, db);
  return { host, root, stableKey, secondStableKey };
}

function scope() {
  return { workspaceProjectId: "workspace-project-1", platformProjectId: "platform-project-1", projectVersionId: "version-1" };
}

function decision(findingId: string, stableKey: string, expectedSha256: string | null, reason = "Reviewed exact cached row") {
  return {
    findingId,
    stableKey,
    status: "NOT_AFFECTED" as const,
    justification: "CODE_NOT_REACHABLE" as const,
    response: null,
    reason,
    evidence: "Call graph: no path (source: analysis)",
    pin: "exact_version" as const,
    expectedSha256,
  };
}

describe("manual triage RPC boundary", () => {
  it("rejects a justification on a non-NOT_AFFECTED status at the RPC boundary", async () => {
    const { host, stableKey } = await fixture();
    const input = {
      ...scope(),
      decisions: [{ ...decision("exact-row-a", stableKey, null), status: "EXPLOITABLE", justification: "CODE_NOT_REACHABLE" }],
    };
    const parsed = findingsUiRpcContract.triageDecisionsWrite.input.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["decisions", 0, "justification"], message: "Justification is only valid for NOT_AFFECTED" })]));
    await expect(host.harness.callRpc("triageDecisionsWrite", input)).rejects.toThrow("rpc input validation failed");
  });

  it("reads and writes the exact selected row through WP-27 without remote mutation", async () => {
    const { host, root, stableKey } = await fixture();
    const target = findingsUiRpcContract.triageTargetsRead.output.parse(await host.harness.callRpc("triageTargetsRead", {
      ...scope(), selection: { mode: "exact", findingIds: ["exact-row-a"] }, continuation: null,
    }));
    expect(target).toMatchObject({ total: 1, next: null, items: [{ findingId: "exact-row-a", stableKey, expectedSha256: null, reasonSeed: "Call graph: no path (source: analysis)" }] });

    const written = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", {
      ...scope(), decisions: [decision("exact-row-a", stableKey, null)],
    }));
    expect(written).toMatchObject({ results: [{ success: true, findingId: "exact-row-a", stableKey }] });
    const success = written.results[0];
    if (!success?.success) throw new Error("expected successful write");
    const yaml = await readFile(join(root, success.file), "utf8");
    expect(yaml).toContain("status: NOT_AFFECTED");
    expect(yaml).toContain("pin: exact_version");
    expect(host.harness.sdk.callsTo("projects.get")).not.toHaveLength(0);
    expect(host.harness.sdk.callsTo("threads.spawn")).toHaveLength(0);
    expect(host.harness.sdk.callsTo("http.request")).toHaveLength(0);

    const replacementTarget = findingsUiRpcContract.triageTargetsRead.output.parse(await host.harness.callRpc("triageTargetsRead", {
      ...scope(), selection: { mode: "exact", findingIds: ["exact-row-a"] }, continuation: null,
    }));
    expect(replacementTarget.items[0]?.prior).toMatchObject({
      status: "NOT_AFFECTED",
      justification: "CODE_NOT_REACHABLE",
      reason: "Reviewed exact cached row",
      provenance: { evidence: "Call graph: no path (source: analysis)" },
    });
    const stale = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", {
      ...scope(), decisions: [decision("exact-row-a", stableKey, null, "Stale external replacement")],
    }));
    expect(stale.results[0]).toMatchObject({ success: false, code: "OVERLAY_CAS_CONFLICT", retryable: true });
  });

  it("chains a bounded batch across decisions sharing one component file", async () => {
    const { host, stableKey, secondStableKey } = await fixture();
    const written = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", {
      ...scope(),
      decisions: [
        decision("exact-row-a", stableKey, null),
        decision("exact-row-c", secondStableKey, null),
      ],
    }));

    expect(written.results).toHaveLength(2);
    expect(written.results.every(result => result.success)).toBe(true);
    if (!written.results[0]?.success || !written.results[1]?.success) throw new Error("expected successful batch");
    expect(written.results[1].undo.beforeSha256).toBe(written.results[0].afterSha256);
  });

  it("restores the exact prior decision by inverse CAS and refuses stale undo", async () => {
    const { host, stableKey } = await fixture();
    const first = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", { ...scope(), decisions: [decision("exact-row-a", stableKey, null, "Initial reviewed rationale")] }));
    const created = first.results[0];
    if (!created?.success) throw new Error("expected first write");
    const second = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", { ...scope(), decisions: [decision("exact-row-a", stableKey, created.afterSha256, "Replacement reviewed rationale")] }));
    const replaced = second.results[0];
    if (!replaced?.success) throw new Error("expected second write");

    await expect(host.harness.callRpc("triageDecisionUndo", {
      ...scope(), findingId: "exact-row-a", stableKey, token: replaced.undo,
    })).resolves.toMatchObject({ file: replaced.file });
    const restored = findingsUiRpcContract.triageTargetsRead.output.parse(await host.harness.callRpc("triageTargetsRead", {
      ...scope(), selection: { mode: "exact", findingIds: ["exact-row-a"] }, continuation: null,
    }));
    expect(restored.items[0]?.expectedSha256).toBe(created.afterSha256);

    const external = findingsUiRpcContract.triageDecisionsWrite.output.parse(await host.harness.callRpc("triageDecisionsWrite", { ...scope(), decisions: [decision("exact-row-a", stableKey, created.afterSha256, "External edit after commit")] }));
    expect(external.results[0]).toMatchObject({ success: true });
    await expect(host.harness.callRpc("triageDecisionUndo", {
      ...scope(), findingId: "exact-row-a", stableKey, token: created.undo,
    })).rejects.toThrow(/changed concurrently/u);
  });

  it("fails a mismatched row identity individually without writing its shared stable key", async () => {
    const { host, stableKey } = await fixture();
    const result = await host.harness.callRpc("triageDecisionsWrite", {
      ...scope(), decisions: [decision("exact-row-a", `${stableKey}-wrong`, null)],
    });
    expect(result).toMatchObject({ results: [{ success: false, findingId: "exact-row-a", code: "TRIAGE_WRITE_FAILED", retryable: false }] });
  });
});
