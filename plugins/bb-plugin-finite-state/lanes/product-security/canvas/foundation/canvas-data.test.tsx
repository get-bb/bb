import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { rpcContract } from "../../../../shared/contract.js";
import { registerProductSecurity } from "../../register.js";
import { taraCanvasRpcContract } from "../scope/backend.js";
import { versionedCanvasEditingRpcContract } from "../editing/backend.js";
import { parseArchitectureEntity } from "../editing/schema.js";
import { serializeCanvasEntity } from "../editing/writer.js";

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function seedAcceptedTara(
  db: ReturnType<ReturnType<typeof createPluginContext>["db"]>,
): void {
  db.prepare(
    `INSERT INTO pull_generation
       (project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at)
     VALUES (?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(
    "project-1",
    "@project",
    "generation-1",
    '["component","zone","asset","dataflow"]',
    "2026-08-12T12:00:00.000Z",
    "2026-08-12T12:00:01.000Z",
    "2026-08-12T12:00:01.000Z",
  );

  const insertSync = db.prepare(
    `INSERT INTO sync_state
       (project_id, project_version_id, entity_kind, accepted_generation_id,
        base_revision, last_pull, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const kind of ["component", "zone", "asset", "dataflow"]) {
    insertSync.run(
      "project-1",
      "@project",
      kind,
      "generation-1",
      3,
      "2026-08-12T12:00:01.000Z",
      kind === "component" ? "upstream unavailable" : null,
    );
  }

  const insertSnapshot = db.prepare(
    `INSERT INTO base_snapshot
       (project_id, project_version_id, entity_kind, generation_id, entity_key,
        payload, content_hash, pulled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSnapshot.run(
    "project-1",
    "@project",
    "component",
    "generation-1",
    "COMP-api",
    JSON.stringify({
      name: "API gateway",
      type: "service",
      criticality: "high",
    }),
    "hash-component-a",
    "2026-08-12T12:00:01.000Z",
  );
  insertSnapshot.run(
    "project-1",
    "@project",
    "component",
    "generation-1",
    "COMP-device",
    JSON.stringify({ name: "Connected device", type: "device" }),
    "hash-component-b",
    "2026-08-12T12:00:01.000Z",
  );
  insertSnapshot.run(
    "project-1",
    "@project",
    "dataflow",
    "generation-1",
    "FLOW-https",
    JSON.stringify({
      name: "Telemetry",
      source: "COMP-device",
      target: "COMP-api",
      protocol: "HTTPS",
      encrypted: true,
      authenticated: true,
    }),
    "hash-flow",
    "2026-08-12T12:00:01.000Z",
  );
}

describe("WP-31 product-security RPC composition", () => {
  it("keeps workspace source lookup separate from Platform/version cache identity", async () => {
    const authored = serializeCanvasEntity(
      parseArchitectureEntity("component", {
        slug: "authored-gateway",
        name: "Authored gateway",
        component_type: "software",
        criticality: "high",
        interfaces: [],
        technologies: [],
        is_entry_point: true,
        stores_data: false,
      }),
    );
    const files = new Map([
      [
        "/workspace/product-security/architecture/components/authored-gateway.yaml",
        authored,
      ],
    ]);
    const { bb, harness } = createFakePluginHost({
      pluginId: "finite-state-strict-identities",
      sdk: {
        projects: {
          get: ({ projectId }) => {
            if (projectId !== "workspace-1")
              throw new Error("unknown workspace");
            return {
              id: projectId,
              sources: [
                { hostId: "host-1", path: "/workspace", isDefault: true },
              ],
            };
          },
        },
        files: {
          list: ({ path }) => ({
            files: [...files.keys()]
              .filter((candidate) => dirname(candidate) === path)
              .map((candidate) => ({
                name: basename(candidate),
                path: candidate,
              })),
            truncated: false,
          }),
          read: ({ path }) => {
            const content = files.get(path);
            if (content === undefined) {
              throw new Error("ENOENT: file does not exist");
            }
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: contentHash(content),
            };
          },
          write: ({ path, content, expectedSha256 }) => {
            const current = files.get(path);
            const currentSha256 = current ? contentHash(current) : null;
            if (currentSha256 !== expectedSha256) {
              return { outcome: "conflict" as const, currentSha256 };
            }
            files.set(path, content);
            return {
              outcome: "written" as const,
              sha256: contentHash(content),
              sizeBytes: content.length,
            };
          },
          move: ({ sourcePath, destinationPath }) => {
            const content = files.get(sourcePath);
            if (content === undefined) throw new Error("ENOENT: not found");
            if (files.has(destinationPath)) throw new Error("path_exists");
            files.delete(sourcePath);
            files.set(destinationPath, content);
            return { ok: true as const };
          },
          remove: ({ path }) => {
            if (!files.delete(path)) throw new Error("ENOENT: not found");
            return { ok: true as const };
          },
        },
      },
    });
    const ctx = createPluginContext(bb);
    registerProductSecurity(bb, ctx);
    const db = ctx.db();
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
               '["component"]', '2026-08-14T10:00:00.000Z',
               '2026-08-14T10:00:00.000Z', '2026-08-14T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('platform-1', 'version-1', 'component', 'generation-1', 1,
               '2026-08-14T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO base_snapshot
         (project_id, project_version_id, entity_kind, generation_id, entity_key,
          payload, content_hash, pulled_at)
       VALUES ('platform-1', 'version-1', 'component', 'generation-1',
               'fs1.c2x1Zw.YWNjZXB0ZWQtYXBp',
               '{"slug":"accepted-api","kind":"component","name":"Accepted API","component_type":"software","criticality":"high","interfaces":[],"technologies":[],"is_entry_point":false,"stores_data":false}', 'hash',
               '2026-08-14T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO sync_state
         (project_id, project_version_id, entity_kind, accepted_generation_id,
          base_revision, last_pull)
       VALUES ('platform-1', 'version-1', 'threat', 'generation-1', 1,
               '2026-08-14T10:00:00.000Z'),
              ('platform-1', 'version-1', 'asset', 'generation-1', 1,
               '2026-08-14T10:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO base_snapshot
         (project_id, project_version_id, entity_kind, generation_id, entity_key,
          payload, content_hash, pulled_at)
       VALUES ('platform-1', 'version-1', 'threat', 'generation-1',
               'fs1.c2x1Zw.YWNjZXB0ZWQtdGhyZWF0',
               '{"slug":"accepted-threat","title":"Accepted threat","category":"spoofing","status":"open"}',
               'hash-threat', '2026-08-14T10:00:00.000Z'),
              ('platform-1', 'version-1', 'asset', 'generation-1',
               'fs1.c2x1Zw.cmVtb3RlLWFzc2V0',
               '{"slug":"remote-asset","name":"Remote asset"}',
               'hash-asset', '2026-08-14T10:00:00.000Z')`,
    ).run();

    const rawPage = await harness.behavior.callRpc("taraCanvasList", {
      workspaceProjectId: "workspace-1",
      platformProjectId: "platform-1",
      projectVersionId: "version-1",
      kind: "component",
      pageSize: 50,
      continuation: null,
    });
    const page = taraCanvasRpcContract.taraCanvasList.output.parse(rawPage);
    expect(page.items.map((item) => item.key)).toEqual([
      "accepted-api",
      "authored-gateway",
    ]);
    expect(harness.inspection.sdk.callsTo("projects.get")).toHaveLength(1);
    const acceptedEdit =
      versionedCanvasEditingRpcContract.canvasVersionedEditingLoad.output.parse(
        await harness.behavior.callRpc("canvasVersionedEditingLoad", {
          workspaceProjectId: "workspace-1",
          platformProjectId: "platform-1",
          projectVersionId: "version-1",
          kind: "component",
          slug: "accepted-api",
        }),
      );
    expect(acceptedEdit).toMatchObject({
      state: "ready",
      projectId: "workspace-1",
      projectVersionId: "version-1",
      slug: "accepted-api",
    });
    expect(harness.inspection.sdk.callsTo("projects.get")).toHaveLength(2);
    await expect(
      harness.behavior.callRpc("canvasVersionedDeleteImpact", {
        workspaceProjectId: "workspace-1",
        platformProjectId: "platform-1",
        projectVersionId: "version-1",
        kind: "component",
        stableKey: "accepted-api",
      }),
    ).resolves.toMatchObject({
      stableKey: "accepted-api",
      allowedActions: ["cascade", "detach"],
    });
    if (acceptedEdit.state !== "ready") {
      throw new Error("accepted component did not load for deletion");
    }
    await expect(
      harness.behavior.callRpc("canvasVersionedCommandApply", {
        workspaceProjectId: "workspace-1",
        platformProjectId: "platform-1",
        projectVersionId: "version-1",
        operation: "delete",
        kind: "component",
        stableKey: "accepted-api",
        mode: "detach",
        expectedContentSha256: acceptedEdit.sha256,
      }),
    ).resolves.toMatchObject({
      projectId: "workspace-1",
      projectVersionId: "version-1",
      stableKey: "accepted-api",
      afterSha256: null,
    });
    expect(
      files.has(
        "/workspace/product-security/architecture/components/accepted-api.yaml",
      ),
    ).toBe(false);
    const afterDeletion = await harness.behavior.callRpc("taraCanvasList", {
      workspaceProjectId: "workspace-1",
      platformProjectId: "platform-1",
      projectVersionId: "version-1",
      kind: "component",
      pageSize: 50,
      continuation: null,
    });
    expect(afterDeletion).toMatchObject({
      items: [{ key: "authored-gateway" }],
      total: 1,
    });
    const overlay = await harness.behavior.callRpc("threatOverlaySnapshot", {
      workspaceProjectId: "workspace-1",
      projectId: "platform-1",
      projectVersionId: "version-1",
    });
    expect(overlay).toMatchObject({
      projectVersionId: "version-1",
      total: 1,
      threats: [
        {
          slug: "fs1.c2x1Zw.YWNjZXB0ZWQtdGhyZWF0",
          rawCategory: "spoofing",
        },
      ],
    });
    await harness.lifecycle.dispose();
  });

  it("reads a typed stale warm cache through the frozen taraList method", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(bb);
    registerProductSecurity(bb, ctx);
    seedAcceptedTara(ctx.db());

    const first = rpcContract.taraList.output.parse(
      await harness.behavior.callRpc("taraList", {
        projectId: "project-1",
        projectVersionId: null,
        kind: "component",
        filters: {},
        pageSize: 1,
        continuation: null,
      }),
    );
    expect(first).toMatchObject({
      total: 2,
      cache: {
        state: "stale",
        baseRevision: 3,
        acceptedGenerationId: "generation-1",
      },
      items: [{ key: "COMP-api", label: "API gateway" }],
    });
    expect(first.next).not.toBeNull();

    const second = rpcContract.taraList.output.parse(
      await harness.behavior.callRpc("taraList", {
        projectId: "project-1",
        projectVersionId: null,
        kind: "component",
        filters: {},
        pageSize: 1,
        continuation: first.next,
      }),
    );
    expect(second).toMatchObject({
      total: 2,
      next: null,
      items: [{ key: "COMP-device", label: "Connected device" }],
    });
    await harness.lifecycle.dispose();
  });

  it("honors the runtime kind erased by pagedScopedInput's inferred type", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    const ctx = createPluginContext(bb);
    registerProductSecurity(bb, ctx);
    seedAcceptedTara(ctx.db());

    const page = rpcContract.taraList.output.parse(
      await harness.behavior.callRpc("taraList", {
        projectId: "project-1",
        projectVersionId: null,
        kind: "dataflow",
        filters: {},
        pageSize: 50,
        continuation: null,
      }),
    );
    expect(page.items).toEqual([
      expect.objectContaining({ kind: "dataflow", key: "FLOW-https" }),
    ]);
    await harness.lifecycle.dispose();
  });

  it("renders registered authored YAML in the local working scope before any pull", async () => {
    const local = serializeCanvasEntity(
      parseArchitectureEntity("component", {
        slug: "local-controller",
        name: "Local controller",
        component_type: "software",
        criticality: "medium",
        interfaces: [],
        technologies: [],
        is_entry_point: false,
        stores_data: false,
      }),
    );
    const { bb, harness } = createFakePluginHost({
      pluginId: "finite-state-local-authoring",
      sdk: {
        projects: {
          get: ({ projectId }) => {
            if (projectId !== "workspace-local") {
              throw new Error("unknown workspace");
            }
            return {
              id: projectId,
              sources: [
                { hostId: "host-local", path: "/workspace", isDefault: true },
              ],
            };
          },
        },
        files: {
          list: ({ path }) => ({
            files: path.endsWith("/components")
              ? [{ name: "local-controller.yaml", path }]
              : [],
            truncated: false,
          }),
          read: ({ path }) => {
            if (!path.endsWith("/local-controller.yaml")) {
              throw new Error("ENOENT: file does not exist");
            }
            return {
              content: local,
              contentEncoding: "utf8" as const,
              sha256: contentHash(local),
            };
          },
        },
      },
    });
    registerProductSecurity(bb, createPluginContext(bb));

    await expect(
      harness.behavior.callRpc("taraScopeResolve", {
        workspaceProjectId: "workspace-local",
        explicit: null,
      }),
    ).resolves.toMatchObject({
      versions: [],
      selected: null,
      source: "local",
      legacy: null,
    });
    await expect(
      harness.behavior.callRpc("taraCanvasList", {
        workspaceProjectId: "workspace-local",
        platformProjectId: "workspace-local",
        projectVersionId: null,
        kind: "component",
        pageSize: 50,
        continuation: null,
      }),
    ).resolves.toMatchObject({
      items: [{ key: "local-controller", label: "Local controller" }],
      total: 1,
      cache: { state: "empty", acceptedGenerationId: null },
    });
    await harness.lifecycle.dispose();
  });

  it("returns an explicit empty cache after only a local project lookup", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "finite-state" });
    registerProductSecurity(bb, createPluginContext(bb));
    const page = await harness.behavior.callRpc("taraList", {
      projectId: "project-without-cache",
      projectVersionId: null,
      kind: "component",
      filters: {},
      pageSize: 50,
      continuation: null,
    });
    expect(page).toMatchObject({
      items: [],
      total: 0,
      cache: { state: "empty", acceptedGenerationId: null },
    });
    expect(harness.inspection.sdk.callsTo("projects.get")).toHaveLength(1);
    expect(harness.inspection.sdk.callsTo("files.list")).toHaveLength(0);
    expect(harness.inspection.sdk.calls).toHaveLength(1);
    await harness.lifecycle.dispose();
  });
});
