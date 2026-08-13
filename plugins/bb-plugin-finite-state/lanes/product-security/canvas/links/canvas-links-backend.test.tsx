import { createHash } from "node:crypto";
import { defineRpcContract } from "@bb/plugin-sdk";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createPluginContext } from "../../../../lib/context.js";
import {
  ENTITIES,
  isRemotePushable,
  isSemanticPlanEntity,
} from "../../../../lib/sync/registry.js";
import { rpcContract } from "../../../../shared/contract.js";
import {
  registerCanvasLinksBackend,
  resolveCachedProjectVersionId,
} from "./backend.js";
import {
  CANVAS_LAYOUT_FILE,
  mergeDiscoveredNodes,
  serializeCanvasLayout,
} from "./layout-store.js";
import {
  parseFirmwareLinksYaml,
  parseSbomLinksYaml,
  resolveCrossSurfaceLinks,
} from "./resolver.js";
import { canvasLinksRpcContract, type CanvasLayoutV1 } from "./schema.js";

const PROJECT_ID = "project-wp34";
const VERSION_ID = "version-current";
const SOURCE_SLUG = "component-gateway";
const WORKSPACE_ROOT = "/workspace";
const SHA_A = "a".repeat(64);

const downstreamRpcContract = defineRpcContract({
  bomSoftwareList: rpcContract.bomSoftwareList,
  firmwareMountGet: rpcContract.firmwareMountGet,
  firmwareFileGet: rpcContract.firmwareFileGet,
  requirementsList: rpcContract.requirementsList,
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function cache(state: "fresh" | "stale" | "empty" = "fresh") {
  return {
    state,
    asOf: "2026-08-13T12:00:00.000Z",
    message: null,
    acceptedGenerationId: "generation-1",
    baseRevision: 1,
  };
}

function layout(nodes: CanvasLayoutV1["nodes"]): CanvasLayoutV1 {
  return {
    schema: "fs-canvas-layout/v1",
    project: PROJECT_ID,
    nodes,
  };
}

function seedAcceptedVersion(
  context: ReturnType<typeof createPluginContext>,
): void {
  context
    .db()
    .prepare(
      `INSERT INTO pull_generation (
        project_id, project_version_id, generation_id, status,
        requested_kinds_json, started_at, completed_at, accepted_at
      ) VALUES (?, ?, 'generation-1', 'accepted', '["sbomComponent"]', ?, ?, ?)`,
    )
    .run(
      PROJECT_ID,
      VERSION_ID,
      "2026-08-13T12:00:00.000Z",
      "2026-08-13T12:00:01.000Z",
      "2026-08-13T12:00:01.000Z",
    );
  context
    .db()
    .prepare(
      `INSERT INTO sync_state (
        project_id, project_version_id, entity_kind,
        accepted_generation_id, last_pull
      ) VALUES (?, ?, 'sbomComponent', 'generation-1', ?)`,
    )
    .run(PROJECT_ID, VERSION_ID, "2026-08-13T12:00:01.000Z");
}

describe("WP-34 production link RPC boundary", () => {
  it("strips lane-only fields, resolves the current version, and isolates unshipped verification", async () => {
    let dispatchRpc:
      | ((method: string, input?: unknown) => Promise<unknown>)
      | undefined;
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: WORKSPACE_ROOT, isDefault: true },
            ],
          }),
        },
        files: {
          read: ({ path }) => {
            const content = path.endsWith("sbom.yaml")
              ? `schema: fs-sbom-links/v1\nlinks:\n  ${SOURCE_SLUG}:\n    - target: pkg:generic/gateway@1\n`
              : `schema: fs-firmware-links/v1\nlinks:\n  ${SOURCE_SLUG}:\n    - target: usr/bin/gateway\n`;
            return {
              content,
              contentEncoding: "utf8" as const,
              sha256: hash(content),
              sizeBytes: content.length,
            };
          },
        },
        plugins: {
          callRpc: async ({ method, input }) => {
            if (!dispatchRpc) throw new Error("RPC dispatcher is not ready.");
            return dispatchRpc(method, input);
          },
        },
      },
    });
    dispatchRpc = host.harness.callRpc;
    const captured = {
      bom: vi.fn(),
      mount: vi.fn(),
      file: vi.fn(),
      requirements: vi.fn(),
    };
    host.bb.rpc.register(downstreamRpcContract, {
      bomSoftwareList(input) {
        captured.bom(input);
        return {
          items: [
            {
              projectId: PROJECT_ID,
              projectVersionId: VERSION_ID,
              kind: "software-component",
              key: "gateway-component-key",
              label: "Gateway package",
              fields: { purl: "pkg:generic/gateway@1" },
            },
          ],
          total: 1,
          next: null,
          cache: cache(),
        };
      },
      firmwareMountGet(input) {
        captured.mount(input);
        return {
          projectId: PROJECT_ID,
          projectVersionId: VERSION_ID,
          kind: "firmware-mount",
          key: VERSION_ID,
          label: "Firmware mount",
          fields: {},
          links: [],
          cache: cache(),
        };
      },
      firmwareFileGet(input) {
        captured.file(input);
        return {
          projectId: PROJECT_ID,
          projectVersionId: VERSION_ID,
          firmwarePath: input.firmwarePath,
          fileSha256: "b".repeat(64),
          size: 42,
          mediaType: "application/octet-stream",
          fields: {},
          previewHex: null,
          previewBytes: 0,
          materialized: true,
          cache: cache(),
        };
      },
      requirementsList(input) {
        captured.requirements(input);
        return {
          items: [
            {
              projectId: PROJECT_ID,
              projectVersionId: null,
              kind: "requirement",
              key: "REQ-104",
              label: "Secure update",
              fields: {},
            },
          ],
          total: 1,
          next: null,
          cache: cache(),
        };
      },
    });
    const context = createPluginContext(host.bb);
    seedAcceptedVersion(context);
    registerCanvasLinksBackend(host.bb, context);

    const input = {
      projectId: PROJECT_ID,
      projectVersionId: null,
      sourceSlug: SOURCE_SLUG,
    };
    const [sbom, firmware, requirement, verification] = await Promise.all([
      host.harness.callRpc("canvasSbomLinks", input),
      host.harness.callRpc("canvasFirmwareLinks", input),
      host.harness.callRpc("canvasRequirementLinks", input),
      host.harness.callRpc("canvasVerificationLinks", input),
    ]);

    expect(sbom).toMatchObject({
      links: [{ kind: "sbom", ready: true, target: "gateway-component-key" }],
      readiness: { state: "ready" },
    });
    expect(firmware).toMatchObject({
      links: [{ kind: "firmware", ready: true, target: "usr/bin/gateway" }],
      readiness: { state: "ready" },
    });
    expect(requirement).toMatchObject({
      links: [{ kind: "requirement", ready: true, target: "REQ-104" }],
      readiness: { state: "ready" },
    });
    expect(verification).toMatchObject({
      links: [{ kind: "verification", ready: false, reason: "unavailable" }],
      readiness: {
        state: "unavailable",
        message: expect.stringMatching(/WP-39.*verification matrix/iu),
      },
    });
    expect(captured.bom).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      pageSize: 2,
      continuation: null,
      filters: { purl: "pkg:generic/gateway@1" },
    });
    expect(captured.mount).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
    });
    expect(captured.file).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectVersionId: VERSION_ID,
      firmwarePath: "usr/bin/gateway",
      includePreview: false,
    });
    expect(captured.requirements).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      projectVersionId: null,
      pageSize: 200,
      continuation: null,
      filters: { view: "traceability", threat: SOURCE_SLUG },
    });
    expect(
      host.harness.sdk
        .callsTo("plugins.callRpc")
        .some(
          ([call]) =>
            typeof call === "object" &&
            call !== null &&
            "method" in call &&
            call.method === "verificationsMatrix",
        ),
    ).toBe(false);
    await host.harness.lifecycle.dispose();
  });

  it("resolves the latest accepted local version without a Platform call", () => {
    const host = createFakePluginHost({ pluginId: "finite-state" });
    const context = createPluginContext(host.bb);
    seedAcceptedVersion(context);
    expect(resolveCachedProjectVersionId(context.db(), PROJECT_ID, null)).toBe(
      VERSION_ID,
    );
    expect(
      resolveCachedProjectVersionId(
        context.db(),
        PROJECT_ID,
        "selected-version",
      ),
    ).toBe("selected-version");
    expect(host.harness.sdk.calls).toEqual([]);
  });
});

describe("WP-34 production layout RPC boundary", () => {
  it("round-trips, reports orphans for explicit prune, suppresses no-ops, and preserves external edits", async () => {
    let currentContent: string | null = null;
    const writes: string[] = [];
    const host = createFakePluginHost({
      pluginId: "finite-state",
      sdk: {
        projects: {
          get: () => ({
            sources: [
              { hostId: "host-1", path: WORKSPACE_ROOT, isDefault: true },
            ],
          }),
        },
        files: {
          read: () => {
            if (currentContent === null) throw new Error("ENOENT: not found");
            return {
              content: currentContent,
              contentEncoding: "utf8" as const,
              sha256: hash(currentContent),
              sizeBytes: currentContent.length,
            };
          },
          write: ({ content, expectedSha256 }) => {
            const currentSha256 =
              currentContent === null ? null : hash(currentContent);
            if (currentSha256 !== expectedSha256) {
              return { outcome: "conflict" as const, currentSha256 };
            }
            currentContent = content;
            writes.push(content);
            return {
              outcome: "written" as const,
              sha256: hash(content),
              sizeBytes: content.length,
            };
          },
        },
      },
    });
    registerCanvasLinksBackend(host.bb, createPluginContext(host.bb));

    const initial = layout({
      orphan: { x: 900, y: 800 },
      known: { x: 40, y: 50, collapsed: true },
    });
    const first = canvasLinksRpcContract.canvasLayoutSave.output.parse(
      await host.harness.callRpc("canvasLayoutSave", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        layout: initial,
        expectedSha256: null,
      }),
    );
    expect(first).toMatchObject({ outcome: "saved", changed: true });
    const firstWritten = writes[0];
    expect(firstWritten).toBeDefined();
    expect(firstWritten?.indexOf('"known"')).toBeLessThan(
      firstWritten?.indexOf('"orphan"') ?? -1,
    );
    expect(firstWritten).not.toMatch(/viewport|selection|zoom|uuid/iu);

    const loaded = canvasLinksRpcContract.canvasLayoutLoad.output.parse(
      await host.harness.callRpc("canvasLayoutLoad", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        nodes: [{ slug: "known", width: 216, height: 112 }],
        edges: [],
      }),
    );
    expect(loaded).toMatchObject({
      layout: initial,
      needsSave: false,
      orphanSlugs: ["orphan"],
    });

    const pruned = canvasLinksRpcContract.canvasLayoutSave.output.parse(
      await host.harness.callRpc("canvasLayoutSave", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        layout: layout({ known: { x: 40, y: 50, collapsed: true } }),
        expectedSha256: first.outcome === "saved" ? first.sha256 : SHA_A,
      }),
    );
    expect(pruned).toMatchObject({ outcome: "saved", changed: true });
    expect(currentContent).not.toContain('"orphan"');

    const noOp = canvasLinksRpcContract.canvasLayoutSave.output.parse(
      await host.harness.callRpc("canvasLayoutSave", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        layout: layout({ known: { x: 40, y: 50, collapsed: true } }),
        expectedSha256: pruned.outcome === "saved" ? pruned.sha256 : SHA_A,
      }),
    );
    expect(noOp).toMatchObject({ outcome: "saved", changed: false });
    expect(writes).toHaveLength(2);

    const external = serializeCanvasLayout(
      layout({ known: { x: 700, y: 800 } }),
    );
    currentContent = external;
    const conflict = canvasLinksRpcContract.canvasLayoutSave.output.parse(
      await host.harness.callRpc("canvasLayoutSave", {
        projectId: PROJECT_ID,
        projectVersionId: null,
        layout: layout({ known: { x: 30, y: 40 } }),
        expectedSha256: pruned.outcome === "saved" ? pruned.sha256 : SHA_A,
      }),
    );
    expect(conflict).toEqual({
      outcome: "conflict",
      file: CANVAS_LAYOUT_FILE,
      currentSha256: hash(external),
    });
    expect(currentContent).toBe(external);
    expect(writes).toHaveLength(2);
    await host.harness.lifecycle.dispose();
  });

  it("keeps stored nodes fixed while ELK places only newly discovered slugs", async () => {
    const merged = await mergeDiscoveredNodes(
      PROJECT_ID,
      layout({
        known: { x: 40, y: 50, collapsed: true },
        orphan: { x: 900, y: 800 },
      }),
      [
        { slug: "known", width: 216, height: 112 },
        { slug: "new-node", width: 216, height: 112 },
      ],
      [{ source: "known", target: "new-node" }],
      async () => ({ "new-node": { x: 12, y: 24 } }),
    );
    expect(merged.layout.nodes.known).toEqual({
      x: 40,
      y: 50,
      collapsed: true,
    });
    expect(merged.layout.nodes["new-node"]).toEqual({ x: 372, y: 24 });
    expect(merged.layout.nodes.orphan).toEqual({ x: 900, y: 800 });
    expect(merged.orphanSlugs).toEqual(["orphan"]);
  });

  it("is VERSIONED LOCAL-ONLY and excluded from plan and push", () => {
    expect(ENTITIES.canvasLayout).toEqual({
      class: "VERSIONED",
      server: "none",
      localOnly: true,
      file: CANVAS_LAYOUT_FILE,
    });
    expect(isSemanticPlanEntity("canvasLayout")).toBe(false);
    expect(isRemotePushable("canvasLayout")).toBe(false);
    expect(isRemotePushable("firmwareLink")).toBe(false);
  });
});

describe("WP-34 mapping degradation", () => {
  it("keeps mapped families usable when another downstream surface fails", async () => {
    const sbom = parseSbomLinksYaml("schema: fs-sbom-links/v1\nlinks: {}\n");
    const firmware = parseFirmwareLinksYaml(`
schema: fs-firmware-links/v1
links:
  ${SOURCE_SLUG}:
    - target: opt/gateway.bin
`);
    const result = await resolveCrossSurfaceLinks({
      sourceSlug: SOURCE_SLUG,
      sbom: { document: sbom },
      firmware: { document: firmware },
      surfaces: {
        sbom: {
          resolve: async () => Promise.reject(new Error("SBOM RPC failed")),
        },
        firmware: {
          resolve: async ({ mappedTargets }) => ({
            state: "ready",
            targets: mappedTargets,
          }),
        },
      },
    });
    expect(result.readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "sbom", state: "not_mapped" }),
        expect.objectContaining({ kind: "firmware", state: "ready" }),
        expect.objectContaining({ kind: "requirement", state: "unavailable" }),
        expect.objectContaining({ kind: "verification", state: "unavailable" }),
      ]),
    );
  });
});
