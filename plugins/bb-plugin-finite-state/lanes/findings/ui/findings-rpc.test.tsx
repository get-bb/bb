import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { findingsUiRpcContract, registerFindingsRpc } from "../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () => Promise.all(hosts.splice(0).map(host => host.harness.lifecycle.dispose())));

describe("findings UI RPC seams", () => {
  it("quarantines malformed saved-view JSON and repairs the CAS-guarded workspace file", async () => {
    const corruptSha = "c".repeat(64);
    let write = 0;
    const host = createFakePluginHost({
      pluginId: "findings-ui-saved-views",
      sdk: {
        projects: { get: () => ({ sources: [{ hostId: "host-1", path: "/workspace", isDefault: true }] }) },
        files: {
          read: () => ({ content: "{malformed", contentEncoding: "utf8" as const, sha256: corruptSha }),
          write: () => {
            write += 1;
            return { outcome: "written" as const, sha256: (write === 1 ? "d" : "e").repeat(64), sizeBytes: 32 };
          },
        },
      },
    });
    hosts.push(host);
    registerFindingsRpc(host.bb, createPluginContext(host.bb).db());
    await expect(host.harness.callRpc("findingsSavedViewsGet", { projectId: "project-1" })).resolves.toEqual({
      views: [], sha256: "e".repeat(64), recoveredFromCorrupt: true,
    });
    const writes = host.harness.sdk.callsTo("files.write").map(call => call[0]);
    expect(writes[0]).toEqual(expect.objectContaining({
      path: `/workspace/product-security/findings/views.json.corrupt-${corruptSha.slice(0, 12)}.json`,
      expectedSha256: null,
    }));
    expect(writes[1]).toEqual(expect.objectContaining({
      path: "/workspace/product-security/findings/views.json",
      expectedSha256: corruptSha,
    }));
  });

  it("resolves cached versions and projects conflict state without changing frozen callers", async () => {
    const host = createFakePluginHost({ pluginId: "findings-ui-projection" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(`INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
      VALUES ('project-1','version-1','generation-1','accepted','["finding"]',?,?,?,NULL)`)
      .run("2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
    db.prepare(`INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
      VALUES ('project-1','version-1','finding','generation-1',NULL,1,NULL,0,0,?,NULL)`)
      .run("2026-08-13T00:00:00.000Z");
    db.prepare(`INSERT INTO findings
      (project_id, project_version_id, generation_id, finding_id, stable_key, cve, severity, risk_score, raw, pulled_at)
      VALUES ('project-1','version-1','generation-1','finding-1','stable-1','CVE-2026-1','critical',10,'{}',?)`)
      .run("2026-08-13T00:00:00.000Z");
    db.prepare(`INSERT INTO overlay_index
      (project_id, project_version_id, entity_kind, stable_key, file_path, file_sha256, local_state, drift_state, indexed_at)
      VALUES ('project-1','version-1','vexDecision','stable-1','.fs/triage/one.yaml',?,'conflict','needs_completion',?)`)
      .run("a".repeat(64), "2026-08-13T00:00:00.000Z");
    registerFindingsRpc(host.bb, db);

    await expect(host.harness.callRpc("cachedProjectVersions", { projectId: "project-1" })).resolves.toMatchObject({
      selectedProjectVersionId: "version-1",
      versions: [{ projectVersionId: "version-1", state: "fresh" }],
    });
    const page = findingsUiRpcContract.findingsUiList.output.parse(await host.harness.callRpc("findingsUiList", {
      projectId: "project-1", projectVersionId: "version-1", pageSize: 100, continuation: null,
      filters: { localState: ["conflicted"] },
    }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.fields).toMatchObject({ localState: "conflicted", localFile: ".fs/triage/one.yaml" });
  });
});
