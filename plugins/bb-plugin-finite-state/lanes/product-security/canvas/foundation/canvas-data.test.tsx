import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import { rpcContract } from "../../../../shared/contract.js";
import { registerProductSecurity } from "../../register.js";

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
