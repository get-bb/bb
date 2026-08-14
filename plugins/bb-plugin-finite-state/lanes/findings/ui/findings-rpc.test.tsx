import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../lib/context.js";
import { findingStableKey } from "../../../lib/sync/registry.js";
import { AGENT_TOOL_NAMES } from "../../../lib/agentic/registry.js";
import { registerAgentic } from "../../agentic/register.js";
import { findingsUiRpcContract, registerFindingsRpc } from "../rpc.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
afterEach(async () =>
  Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose())),
);

describe("findings UI RPC seams", () => {
  it("quarantines malformed saved-view JSON and repairs the CAS-guarded workspace file", async () => {
    const corruptSha = "c".repeat(64);
    let write = 0;
    const host = createFakePluginHost({
      pluginId: "findings-ui-saved-views",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
        files: {
          read: () => ({
            content: "{malformed",
            contentEncoding: "utf8" as const,
            sha256: corruptSha,
          }),
          write: () => {
            write += 1;
            return {
              outcome: "written" as const,
              sha256: (write === 1 ? "d" : "e").repeat(64),
              sizeBytes: 32,
            };
          },
        },
      },
    });
    hosts.push(host);
    registerFindingsRpc(host.bb, createPluginContext(host.bb).db());
    await expect(
      host.harness.callRpc("findingsSavedViewsGet", { projectId: "project-1" }),
    ).resolves.toEqual({
      views: [],
      sha256: "e".repeat(64),
      recoveredFromCorrupt: true,
    });
    const writes = host.harness.sdk
      .callsTo("files.write")
      .map((call) => call[0]);
    expect(writes[0]).toEqual(
      expect.objectContaining({
        path: `/workspace/product-security/findings/views.json.corrupt-${corruptSha.slice(0, 12)}.json`,
        expectedSha256: null,
      }),
    );
    expect(writes[1]).toEqual(
      expect.objectContaining({
        path: "/workspace/product-security/findings/views.json",
        expectedSha256: corruptSha,
      }),
    );
  });

  it("resolves cached versions and projects conflict state without changing frozen callers", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-ui-projection",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
      },
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
      VALUES ('platform-project-1','version-1','generation-1','accepted','["finding"]',?,?,?,NULL),
             ('platform-project-2','version-2','generation-2','accepted','["finding"]',?,?,?,NULL),
             ('platform-project-3','foreign-version','foreign-generation','accepted','["finding"]',?,?,?,NULL)`,
    ).run(
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T01:00:00.000Z",
      "2026-08-13T01:00:00.000Z",
      "2026-08-13T01:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
      VALUES ('platform-project-1','version-1','finding','generation-1',NULL,1,NULL,0,0,?,NULL),
             ('platform-project-2','version-2','finding','generation-2',NULL,1,NULL,0,0,?,NULL),
             ('platform-project-3','foreign-version','finding','foreign-generation',NULL,1,NULL,0,0,?,NULL)`,
    ).run(
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T01:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO workspace_platform_project_binding
       (workspace_project_id, platform_project_id)
       VALUES ('workspace-project-1', 'platform-project-1'),
              ('workspace-project-1', 'platform-project-2'),
              ('workspace-project-2', 'platform-project-3')`,
    ).run();
    db.prepare(
      `INSERT INTO findings
      (project_id, project_version_id, generation_id, finding_id, stable_key, cve, severity, risk_score, raw, pulled_at)
      VALUES ('platform-project-1','version-1','generation-1','finding-1','stable-1','CVE-2026-1','critical',10,'{}',?)`,
    ).run("2026-08-13T00:00:00.000Z");
    db.prepare(
      `INSERT INTO overlay_index
      (project_id, project_version_id, entity_kind, stable_key, file_path, file_sha256, local_state, drift_state, indexed_at)
      VALUES ('platform-project-1','version-1','vexDecision','stable-1','.fs/triage/one.yaml',?,'conflict','needs_completion',?)`,
    ).run("a".repeat(64), "2026-08-13T00:00:00.000Z");
    registerFindingsRpc(host.bb, db);

    await expect(
      host.harness.callRpc("cachedProjectVersions", {
        projectId: "workspace-project-1",
      }),
    ).resolves.toEqual({
      selectedPlatformProjectId: "platform-project-2",
      selectedProjectVersionId: "version-2",
      versions: [
        {
          platformProjectId: "platform-project-2",
          projectVersionId: "version-2",
          asOf: "2026-08-13T01:00:00.000Z",
          state: "fresh",
        },
        {
          platformProjectId: "platform-project-1",
          projectVersionId: "version-1",
          asOf: "2026-08-13T00:00:00.000Z",
          state: "fresh",
        },
      ],
    });
    await expect(
      host.harness.callRpc("cachedProjectVersions", {
        projectId: "workspace-project-2",
      }),
    ).resolves.toEqual({
      selectedPlatformProjectId: "platform-project-3",
      selectedProjectVersionId: "foreign-version",
      versions: [
        {
          platformProjectId: "platform-project-3",
          projectVersionId: "foreign-version",
          asOf: "2026-08-13T02:00:00.000Z",
          state: "fresh",
        },
      ],
    });
    const page = findingsUiRpcContract.findingsUiList.output.parse(
      await host.harness.callRpc("findingsUiList", {
        projectId: "platform-project-1",
        projectVersionId: "version-1",
        pageSize: 100,
        continuation: null,
        filters: { localState: ["conflicted"] },
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.fields).toMatchObject({
      localState: "conflicted",
      localFile: ".fs/triage/one.yaml",
    });
  });

  it("keeps one-project legacy caches visible and backfills their workspace binding", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-ui-legacy-project-binding",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
      },
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('legacy-platform-project', 'legacy-version', 'legacy-generation',
               'accepted', '["finding"]', ?, ?, ?)`,
    ).run(
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        last_pull)
       VALUES ('legacy-platform-project', 'legacy-version', 'finding',
               'legacy-generation', '2026-08-12T00:00:00.000Z')`,
    ).run();
    registerFindingsRpc(host.bb, db);

    await expect(
      host.harness.callRpc("cachedProjectVersions", {
        projectId: "legacy-workspace-project",
      }),
    ).resolves.toMatchObject({
      versions: [
        {
          platformProjectId: "legacy-platform-project",
          projectVersionId: "legacy-version",
        },
      ],
    });
    expect(
      db
        .prepare(
          `SELECT platform_project_id
             FROM workspace_platform_project_binding
            WHERE workspace_project_id = ?`,
        )
        .pluck()
        .all("legacy-workspace-project"),
    ).toEqual(["legacy-platform-project"]);
  });

  it("resolves every stable-key collision and rejects invalid keys before DB access", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-detail-resolution",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
      },
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const stableKey = findingStableKey(
      {
        cve: "CVE-2026-39",
        purl: "pkg:generic/gateway@1",
        name: "gateway",
        version: "1",
      },
      "purl",
    );
    db.prepare(
      `INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
      VALUES ('platform-project-1','version-1','generation-1','accepted','["finding"]',?,?,?,NULL)`,
    ).run(
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
      VALUES ('platform-project-1','version-1','finding','generation-1',NULL,1,NULL,0,0,?,NULL)`,
    ).run("2026-08-13T00:00:00.000Z");
    const insert = db.prepare(`INSERT INTO findings
      (project_id, project_version_id, generation_id, finding_id, stable_key, cve, component_name, component_version, component_purl, severity, reachability_verdict, reachability_factors, raw, pulled_at)
      VALUES ('platform-project-1','version-1','generation-1',?,?,?,?,?,?,?,'reachable',?, '{}',?)`);
    for (const id of ["ephemeral-old", "ephemeral-new"]) {
      insert.run(
        id,
        stableKey,
        "CVE-2026-39",
        "gateway",
        "1",
        "pkg:generic/gateway@1",
        "high",
        '[{"label":"symbol","value":"called"}]',
        "2026-08-13T00:00:00.000Z",
      );
    }
    db.prepare(
      `INSERT INTO overlay_index
      (project_id, project_version_id, entity_kind, stable_key, file_path, file_sha256, vex_status, vex_reason, local_state, indexed_at)
      VALUES ('platform-project-1','version-1','vexDecision',?,'.fs/triage/gateway.yaml',?,'NOT_AFFECTED','reviewed call graph','dirty',?)`,
    ).run(stableKey, "a".repeat(64), "2026-08-13T00:00:00.000Z");
    registerFindingsRpc(host.bb, db);

    await expect(
      host.harness.callRpc("findingDetailGet", {
        projectId: "platform-project-1",
        projectVersionId: "version-1",
        stableKey,
      }),
    ).resolves.toMatchObject({
      state: "resolved",
      tier: 1,
      rows: [
        {
          key: "ephemeral-new",
          fields: {
            localVexStatus: "NOT_AFFECTED",
            localVexReason: "reviewed call graph",
            localState: "local",
            localFile: ".fs/triage/gateway.yaml",
          },
        },
        {
          key: "ephemeral-old",
          fields: {
            localVexStatus: "NOT_AFFECTED",
            localVexReason: "reviewed call graph",
            localState: "local",
            localFile: ".fs/triage/gateway.yaml",
          },
        },
      ],
    });

    const prepare = vi.spyOn(db, "prepare");
    await expect(
      host.harness.callRpc("findingDetailGet", {
        projectId: "platform-project-1",
        projectVersionId: "version-1",
        stableKey: "not-a-stable-key",
      }),
    ).rejects.toThrow(/malformed/u);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("leaves cached activity intact when online refresh fails", async () => {
    const host = createFakePluginHost({ pluginId: "findings-history-refresh" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO pull_generation
      (project_id, project_version_id, generation_id, status, requested_kinds_json, started_at, completed_at, accepted_at, error)
      VALUES ('p','v','g','accepted','["finding"]',?,?,?,NULL)`,
    ).run(
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
      "2026-08-13T00:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
      (project_id, project_version_id, entity_kind, accepted_generation_id, staging_generation_id, base_revision, staging_continuation, staged_pages, staged_rows, last_pull, error)
      VALUES ('p','v','finding','g',NULL,1,NULL,0,0,?,NULL)`,
    ).run("2026-08-13T00:00:00.000Z");
    db.prepare(
      `INSERT INTO findings
      (project_id, project_version_id, generation_id, finding_id, stable_key, cve, raw, pulled_at)
      VALUES ('p','v','g','finding-1','stable-1','CVE-2026-39','{}',?)`,
    ).run("2026-08-13T00:00:00.000Z");
    db.prepare(
      `INSERT INTO finding_activity
      (project_id, project_version_id, generation_id, finding_id, event_id, stable_key, actor, event_at, source, old_tuple, new_tuple, raw, pulled_at)
      VALUES ('p','v','g','finding-1','event-1','stable-1','Reviewer',?,'cached','{}','{"status":"fixed"}','{}',?)`,
    ).run("2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
    registerFindingsRpc(host.bb, db, {
      hydrateActivity: () => Promise.reject(new Error("Injected online fault")),
    });

    await expect(
      host.harness.callRpc("findingActivityRefresh", {
        projectId: "p",
        projectVersionId: "v",
        findingId: "finding-1",
      }),
    ).rejects.toThrow("Injected online fault");
    await expect(
      host.harness.callRpc("findingsActivityList", {
        projectId: "p",
        projectVersionId: "v",
        findingId: "finding-1",
        pageSize: 20,
        continuation: null,
      }),
    ).resolves.toMatchObject({ total: 1, items: [{ key: "event-1" }] });
  });

  it("registers zero-write drift reads and human import flags without adding an agent tool", async () => {
    const host = createFakePluginHost({
      pluginId: "findings-drift-rpc",
      sdk: {
        projects: {
          get: ({ projectId }) => ({
            id: projectId,
            sources: [
              { hostId: "host-1", path: "/workspace", isDefault: true },
            ],
          }),
        },
      },
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    db.prepare(
      `INSERT INTO workspace_platform_project_binding
       (workspace_project_id, platform_project_id)
       VALUES ('workspace-1', 'platform-1')`,
    ).run();
    db.prepare(
      `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
       VALUES ('platform-1', 'version-1', 'generation-1', 'accepted',
               '["finding"]', ?, ?, ?)`,
    ).run(
      "2026-08-14T12:00:00.000Z",
      "2026-08-14T12:00:00.000Z",
      "2026-08-14T12:00:00.000Z",
    );
    db.prepare(
      `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id)
       VALUES ('platform-1', 'version-1', 'finding', 'generation-1')`,
    ).run();
    const report = {
      pvId: "version-1",
      runId: "drift-run-1",
      createdAt: "2026-08-14T12:00:00.000Z",
      unclassifiedCount: 2,
      totals: {
        reattached_noop: 1,
        reapply: 0,
        stale: 0,
        orphaned: 0,
        conflict: 0,
        needs_completion: 0,
      },
      items: [
        {
          stableKey: "stable-key-1",
          state: "reattached_noop" as const,
          tier: 1 as const,
          reason: "Server tuple matches",
        },
      ],
      nextCursor: null,
    };
    const drift = {
      refresh: vi.fn(() => report),
      report: vi.fn(() => report),
      orphanState: vi.fn(() => ({
        baseStateSha256: "a".repeat(64),
        total: 0,
      })),
      stageVendorDocument: vi.fn(() => ({ documentSha256: "b".repeat(64) })),
      previewVendorVex: vi.fn(async () => ({
        importId: "vendor-import-1",
        source: {
          format: "openvex" as const,
          digest: "b".repeat(64),
          vendor: "Supplier",
        },
        matched: 0,
        unmatched: 0,
        needsCompletion: 0,
        keptLocal: 0,
        written: 0,
        proposals: [
          {
            stableKey: "stable-vendor-1",
            state: "proposal",
            sourceRef: "supplier.json#statement-1",
          },
        ],
        errors: [],
      })),
      applyVendorVex: vi.fn(async () => ({
        importId: "vendor-import-1",
        source: {
          format: "openvex" as const,
          digest: "b".repeat(64),
          vendor: "Supplier",
        },
        matched: 0,
        unmatched: 0,
        needsCompletion: 0,
        keptLocal: 0,
        written: 0,
        proposals: [],
        errors: [],
      })),
      pruneOrphans: vi.fn(async () => ({
        baseStateSha256: "a".repeat(64),
        selected: 0,
        pruned: 0,
        files: [],
        results: [],
      })),
    };
    registerFindingsRpc(host.bb, db, { drift });

    const changes = db.prepare("SELECT total_changes()").pluck().get();
    await expect(
      host.harness.behavior.callRpc("findingsDriftReport", {
        workspaceProjectId: "workspace-1",
        platformProjectId: "platform-1",
        projectVersionId: "version-1",
        cursor: null,
        limit: 100,
      }),
    ).resolves.toEqual(report);
    expect(db.prepare("SELECT total_changes()").pluck().get()).toBe(changes);
    expect(drift.report).toHaveBeenCalledWith({
      projectId: "platform-1",
      pvId: "version-1",
      cursor: null,
      limit: 100,
    });

    const vendorPreview = await host.harness.behavior.callRpc(
      "triageVendorVexPreview",
      {
        projectId: "workspace-1",
        projectVersionId: "version-1",
        pageSize: 100,
        continuation: null,
        documentSha256: "b".repeat(64),
        vendor: "Supplier",
      },
    );
    expect(vendorPreview).toMatchObject({
      projectId: "platform-1",
      items: [{ projectId: "platform-1", key: "stable-vendor-1" }],
    });
    expect(drift.previewVendorVex).toHaveBeenCalledWith(
      expect.objectContaining({
        root: "/workspace",
        documentSha256: "b".repeat(64),
      }),
    );
    await host.harness.behavior.callRpc("triageVendorVexApply", {
      projectId: "workspace-1",
      projectVersionId: "version-1",
      pageSize: 100,
      continuation: null,
      importId: "vendor-import-1",
      expectedDocumentSha256: "b".repeat(64),
      overwrite: true,
    });
    expect(drift.applyVendorVex).toHaveBeenCalledWith(
      expect.objectContaining({ overwrite: true }),
    );

    registerAgentic(host.bb, createPluginContext(host.bb));
    const registeredNames =
      host.harness.inspection.registrations.agentTools.map((tool) => tool.name);
    expect(registeredNames.length).toBeGreaterThan(0);
    expect(registeredNames).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/drift|orphan|vendor/iu)]),
    );
    expect(AGENT_TOOL_NAMES).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/drift|orphan|vendor/iu)]),
    );
  });
});
