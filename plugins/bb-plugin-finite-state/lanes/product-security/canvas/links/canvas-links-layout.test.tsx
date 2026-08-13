// @vitest-environment jsdom

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  ENTITIES,
  isRemotePushable,
  isSemanticPlanEntity,
} from "../../../../lib/sync/registry.js";
import { componentSubPath } from "../../../bom/app/sbom/routes.js";
import type {
  ArchitectureNodeData,
  CanvasArchitectureGraph,
} from "../nodes/adapters.js";
import {
  ArchitectureSelectionContext,
  type ArchitectureSelectionContextValue,
} from "../nodes/selection.js";
import { CrossSurfaceLinks } from "./CrossSurfaceLinks.js";
import {
  CANVAS_LAYOUT_FILE,
  CanvasLayoutConflictError,
  loadLayout,
  mergeDiscoveredNodes,
  pruneLayoutOrphans,
  saveLayout,
  serializeCanvasLayout,
} from "./layout-store.js";
import { DebouncedLayoutSaver } from "./layout.js";
import {
  ProductSecurityLinksLayer,
  type CanvasLinksAppRuntime,
} from "./index.js";
import {
  parseFirmwareLinksYaml,
  parseSbomLinksYaml,
  resolveCrossSurfaceLinks,
} from "./resolver.js";
import {
  canvasLinksRpcContract,
  resolvedCrossSurfaceLinksSchema,
  type CanvasLayoutV1,
  type CrossSurfaceLinkKind,
} from "./schema.js";

const PROJECT_ID = "project-wp34";
const SOURCE_SLUG = "component-gateway";
const COMPONENT: ArchitectureNodeData = {
  slug: SOURCE_SLUG,
  kind: "component",
  name: "Gateway",
  sourceFile: "product-security/architecture/components/component-gateway.yaml",
};
const EMPTY_GRAPH: CanvasArchitectureGraph = {
  nodes: [],
  edges: [],
  unresolved: [],
};
const temporaryRoots: string[] = [];

beforeAll(() => installTestPluginRuntime());

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs48-layout-"));
  temporaryRoots.push(root);
  return root;
}

function layout(
  nodes: CanvasLayoutV1["nodes"],
  project = PROJECT_ID,
): CanvasLayoutV1 {
  return { schema: "fs-canvas-layout/v1", project, nodes };
}

function readyFamily(
  kind: CrossSurfaceLinkKind,
  target: string,
  label: string,
) {
  return {
    sourceSlug: SOURCE_SLUG,
    links: [
      {
        kind,
        sourceSlug: SOURCE_SLUG,
        target,
        label,
        ready: true as const,
        provenance: { source: `${kind} readiness` },
      },
    ],
    readiness: {
      kind,
      state: "ready" as const,
      provenance: { source: `${kind} readiness` },
    },
  };
}

function installedAppRuntime(): CanvasLinksAppRuntime {
  const host = Reflect.get(globalThis, "__bbPluginRuntime");
  if (typeof host !== "object" || host === null) {
    throw new Error("BB test plugin runtime was not installed");
  }
  const runtime = Reflect.get(host, "pluginSdkApp");
  if (
    typeof runtime !== "object" ||
    runtime === null ||
    typeof Reflect.get(runtime, "useBbNavigate") !== "function" ||
    typeof Reflect.get(runtime, "useRpc") !== "function"
  ) {
    throw new Error("BB test plugin runtime is missing canvas link hooks");
  }
  return runtime as CanvasLinksAppRuntime;
}

function ArchitectureHarness({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  const value: ArchitectureSelectionContextValue = {
    graph: EMPTY_GRAPH,
    nodesBySlug: new Map([[SOURCE_SLUG, COMPONENT]]),
    edgesBySlug: new Map(),
    adjacency: new Map(),
    unresolved: [],
    selectedIds: [SOURCE_SLUG],
    focusId: SOURCE_SLUG,
    menu: null,
    setSelectedIds: () => undefined,
    setFitSelection: () => undefined,
    fitSelection: () => undefined,
    openMenu: () => undefined,
    closeMenu: () => undefined,
    onFocusRoute: () => undefined,
    onRepairSourceFile: () => undefined,
  };
  return (
    <ReactFlowProvider>
      <ArchitectureSelectionContext.Provider value={value}>
        <aside aria-label="Architecture inspector" />
        {children}
      </ArchitectureSelectionContext.Provider>
    </ReactFlowProvider>
  );
}

function layoutLoadResult() {
  return {
    layout: layout({}),
    file: CANVAS_LAYOUT_FILE,
    sha256: null,
    needsSave: false,
    orphanSlugs: [],
  };
}

describe("WP-34 cross-surface resolution", () => {
  it("validates explicit mappings and resolves all four link families with provenance", async () => {
    const sbom = parseSbomLinksYaml(`
schema: fs-sbom-links/v1
links:
  ${SOURCE_SLUG}:
    - target: pkg:generic/gateway@1
      label: Gateway package
`);
    const firmware = parseFirmwareLinksYaml(`
schema: fs-firmware-links/v1
links:
  ${SOURCE_SLUG}:
    - target: /usr/bin/gateway
      label: Gateway binary
`);
    expect(firmware.links[SOURCE_SLUG]?.[0]?.target).toBe("usr/bin/gateway");
    const result = await resolveCrossSurfaceLinks({
      sourceSlug: SOURCE_SLUG,
      sbom: { document: sbom },
      firmware: { document: firmware },
      surfaces: {
        sbom: {
          resolve: async ({ mappedTargets }) => ({
            state: "ready",
            targets: mappedTargets,
          }),
        },
        firmware: {
          resolve: async ({ mappedTargets }) => ({
            state: "ready",
            targets: mappedTargets,
          }),
        },
        requirement: {
          resolve: async () => ({
            state: "ready",
            targets: [
              {
                target: "REQ-104",
                label: "Secure update requirement",
                provenance: { source: "requirements cache" },
              },
            ],
          }),
        },
        verification: {
          resolve: async () => ({
            state: "ready",
            targets: [
              {
                target: "REQ-104/static",
                label: "Static verification",
                provenance: { source: "verification cache" },
              },
            ],
          }),
        },
      },
    });

    expect(result.links.map((link) => link.kind)).toEqual([
      "sbom",
      "firmware",
      "requirement",
      "verification",
    ]);
    expect(result.links.every((link) => link.ready && link.provenance)).toBe(
      true,
    );
    expect(result.readiness.map((entry) => entry.state)).toEqual([
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
  });

  it("degrades no mappings, absent surfaces, and one failed downstream independently", async () => {
    const emptySbom = parseSbomLinksYaml(
      "schema: fs-sbom-links/v1\nlinks: {}\n",
    );
    const firmware = parseFirmwareLinksYaml(`
schema: fs-firmware-links/v1
links:
  ${SOURCE_SLUG}:
    - target: opt/gateway.bin
`);
    const result = await resolveCrossSurfaceLinks({
      sourceSlug: SOURCE_SLUG,
      sbom: { document: emptySbom },
      firmware: { document: firmware },
      surfaces: {
        sbom: { resolve: async () => Promise.reject(new Error("SBOM RPC failed")) },
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
    expect(
      result.links.find((link) => link.kind === "firmware"),
    ).toMatchObject({ ready: true, target: "opt/gateway.bin" });
  });

  it("rejects UUID layout keys and path-traversing firmware mappings", () => {
    expect(() =>
      parseFirmwareLinksYaml(`
schema: fs-firmware-links/v1
links:
  ${SOURCE_SLUG}:
    - target: ../etc/shadow
`),
    ).toThrow(/within the materialized rootfs/iu);
    expect(() =>
      serializeCanvasLayout(
        layout({
          "550e8400-e29b-41d4-a716-446655440000": { x: 0, y: 0 },
        }),
      ),
    ).toThrow(/UUID/iu);
  });
});

describe("WP-34 inspector links", () => {
  it("renders loading, unconfigured, error, and no-mapping states safely", () => {
    const callbacks = {
      onNavigate: vi.fn(),
      onRetry: vi.fn(),
      onSafeAction: vi.fn(),
    };
    const view = render(
      <CrossSurfaceLinks {...callbacks} value={{ state: "loading" }} />,
    );
    expect(view.getByRole("status").textContent).toContain(
      "Loading cross-surface links",
    );
    view.rerender(
      <CrossSurfaceLinks {...callbacks} value={{ state: "unconfigured" }} />,
    );
    expect(view.getByText("Choose a project to resolve links")).toBeTruthy();
    view.rerender(
      <CrossSurfaceLinks
        {...callbacks}
        value={{ state: "error", message: "RPC unavailable" }}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Retry links" }));
    expect(callbacks.onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <CrossSurfaceLinks
        {...callbacks}
        value={{
          state: "ready",
          result: resolvedCrossSurfaceLinksSchema.parse({
            sourceSlug: SOURCE_SLUG,
            links: [
              {
                kind: "sbom",
                sourceSlug: SOURCE_SLUG,
                target: "",
                label: "SBOM entry",
                ready: false,
                reason: "not_mapped",
                provenance: { source: ".fs/links/sbom.yaml" },
              },
            ],
            readiness: [
              { kind: "sbom", state: "not_mapped" },
              { kind: "firmware", state: "unavailable" },
              { kind: "requirement", state: "unavailable" },
              { kind: "verification", state: "unavailable" },
            ],
          }),
        }}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: "Create mapping" }));
    expect(callbacks.onNavigate).not.toHaveBeenCalled();
    expect(callbacks.onSafeAction).toHaveBeenCalledWith(
      "sbom",
      "not_mapped",
    );
  });

  it("navigates all four ready link kinds through canonical bb panel routes", async () => {
    const appRuntime = installedAppRuntime();
    const slot = renderSlot<{}, typeof canvasLinksRpcContract>(
      {
        component: () => (
          <ArchitectureHarness>
            <ProductSecurityLinksLayer
              appRuntime={appRuntime}
              projectId={PROJECT_ID}
            />
          </ArchitectureHarness>
        ),
      },
      {},
      {
        rpc: {
          canvasSbomLinks: () =>
            readyFamily("sbom", "component-key", "Gateway package"),
          canvasFirmwareLinks: () =>
            readyFamily("firmware", "usr/bin/gateway", "Gateway binary"),
          canvasRequirementLinks: () =>
            readyFamily("requirement", "REQ-104", "Secure update"),
          canvasVerificationLinks: () =>
            readyFamily(
              "verification",
              "REQ-104/static",
              "Static verification",
            ),
          canvasLayoutLoad: layoutLoadResult,
          canvasLayoutSave: () => ({
            outcome: "saved",
            file: CANVAS_LAYOUT_FILE,
            sha256: "a".repeat(64),
            changed: false,
          }),
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", {
        name: "Open SBOM entry: Gateway package",
      }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open Files in firmware: Gateway binary",
      }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open Mitigating requirements: Secure update",
      }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open Verification runs: Static verification",
      }),
    );

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "bom",
        options: { subPath: componentSubPath("component-key") },
      },
      {
        method: "toPluginPanel",
        path: "firmware",
        options: { subPath: "tree/usr%2Fbin%2Fgateway" },
      },
      {
        method: "toPluginPanel",
        path: "product-security",
        options: { subPath: "requirements/REQ-104" },
      },
      {
        method: "toPluginPanel",
        path: "product-security",
        options: { subPath: "verifications/REQ-104/static" },
      },
    ]);
    slot.lifecycle.unmount();
  });

  it("keeps firmware and requirements interactive when the SBOM RPC fails", async () => {
    const appRuntime = installedAppRuntime();
    const slot = renderSlot<{}, typeof canvasLinksRpcContract>(
      {
        component: () => (
          <ArchitectureHarness>
            <ProductSecurityLinksLayer
              appRuntime={appRuntime}
              projectId={PROJECT_ID}
            />
          </ArchitectureHarness>
        ),
      },
      {},
      {
        rpc: {
          canvasSbomLinks: () => {
            throw new Error("SBOM link RPC failed");
          },
          canvasFirmwareLinks: () =>
            readyFamily("firmware", "opt/gateway.bin", "Gateway firmware"),
          canvasRequirementLinks: () =>
            readyFamily("requirement", "REQ-104", "Secure update"),
          canvasVerificationLinks: () =>
            readyFamily(
              "verification",
              "REQ-104/static",
              "Static verification",
            ),
          canvasLayoutLoad: layoutLoadResult,
          canvasLayoutSave: () => ({
            outcome: "saved",
            file: CANVAS_LAYOUT_FILE,
            sha256: "b".repeat(64),
            changed: false,
          }),
        },
      },
    );

    expect(await slot.findByText("Unavailable")).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open Files in firmware: Gateway firmware",
      }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open Mitigating requirements: Secure update",
      }),
    );
    expect(slot.inspection.navigateCalls).toHaveLength(2);
    slot.lifecycle.unmount();
  });

  it("shows reload and compare after a layout CAS conflict without retrying", async () => {
    const appRuntime = installedAppRuntime();
    const slot = renderSlot<{}, typeof canvasLinksRpcContract>(
      {
        component: () => (
          <ArchitectureHarness>
            <ProductSecurityLinksLayer
              appRuntime={appRuntime}
              projectId={PROJECT_ID}
            />
          </ArchitectureHarness>
        ),
      },
      {},
      {
        rpc: {
          canvasSbomLinks: () =>
            readyFamily("sbom", "component-key", "Gateway package"),
          canvasFirmwareLinks: () =>
            readyFamily("firmware", "usr/bin/gateway", "Gateway binary"),
          canvasRequirementLinks: () =>
            readyFamily("requirement", "REQ-104", "Secure update"),
          canvasVerificationLinks: () =>
            readyFamily(
              "verification",
              "REQ-104/static",
              "Static verification",
            ),
          canvasLayoutLoad: () => ({
            ...layoutLoadResult(),
            needsSave: true,
          }),
          canvasLayoutSave: () => ({
            outcome: "conflict",
            file: CANVAS_LAYOUT_FILE,
            currentSha256: "d".repeat(64),
          }),
        },
      },
    );

    expect(
      await slot.findByRole("button", { name: "Reload and compare" }),
    ).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "canvasLayoutSave",
      ),
    ).toHaveLength(1);
    slot.lifecycle.unmount();
  });
});

describe("WP-34 canvas layout persistence", () => {
  it("round-trips stable sorted integer layout and skips equal rounded writes", async () => {
    const root = await temporaryRoot();
    const first = await saveLayout(
      root,
      layout({
        zeta: { x: 10.4, y: 20.6, collapsed: false },
        alpha: { x: -5.5, y: 3.49, collapsed: true },
      }),
    );
    expect(first.changed).toBe(true);
    const bytes = await readFile(join(root, CANVAS_LAYOUT_FILE), "utf8");
    expect(bytes.indexOf('"alpha"')).toBeLessThan(bytes.indexOf('"zeta"'));
    expect(bytes).not.toMatch(/viewport|selection|zoom|uuid/iu);
    expect(JSON.parse(bytes)).toEqual({
      schema: "fs-canvas-layout/v1",
      project: PROJECT_ID,
      nodes: {
        alpha: { x: -5, y: 3, collapsed: true },
        zeta: { x: 10, y: 21 },
      },
    });

    const unchanged = await saveLayout(
      root,
      layout({
        zeta: { x: 10.49, y: 20.51 },
        alpha: { x: -5.4, y: 3.1, collapsed: true },
      }),
      first.sha256,
    );
    expect(unchanged).toMatchObject({ changed: false, sha256: first.sha256 });
    await expect(loadLayout(root)).resolves.toMatchObject({
      sha256: first.sha256,
      layout: {
        nodes: {
          alpha: { x: -5, y: 3, collapsed: true },
          zeta: { x: 10, y: 21 },
        },
      },
    });
  });

  it("debounces a drag burst to one write and ignores equal rounded positions", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockResolvedValue({
      outcome: "saved" as const,
      sha256: "c".repeat(64),
    });
    const saver = new DebouncedLayoutSaver({
      initial: layout({ gateway: { x: 0, y: 0 } }),
      write,
      onConflict: vi.fn(),
    });
    saver.schedule(layout({ gateway: { x: 1, y: 1 } }));
    saver.schedule(layout({ gateway: { x: 2, y: 2 } }));
    saver.schedule(layout({ gateway: { x: 3, y: 3 } }));
    await vi.advanceTimersByTimeAsync(499);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledWith(
      layout({ gateway: { x: 3, y: 3 } }),
      undefined,
    );
    expect(saver.schedule(layout({ gateway: { x: 3.2, y: 2.8 } }))).toBe(
      false,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledOnce();
    saver.dispose();
  });

  it("merges new nodes without moving known nodes and retains orphans until explicit prune", async () => {
    const stored = layout({
      known: { x: 40, y: 50, collapsed: true },
      orphan: { x: 900, y: 800 },
    });
    const merged = await mergeDiscoveredNodes(
      PROJECT_ID,
      stored,
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

    const pruned = pruneLayoutOrphans(merged.layout, merged.orphanSlugs);
    expect(pruned.pruned).toEqual(["orphan"]);
    expect(pruned.layout.nodes.orphan).toBeUndefined();
  });

  it("fails closed on CAS conflict and preserves the external bytes", async () => {
    const root = await temporaryRoot();
    const accepted = await saveLayout(
      root,
      layout({ gateway: { x: 10, y: 20 } }),
    );
    const external = serializeCanvasLayout(
      layout({ gateway: { x: 700, y: 800 } }),
    );
    await writeFile(join(root, CANVAS_LAYOUT_FILE), external, "utf8");

    await expect(
      saveLayout(
        root,
        layout({ gateway: { x: 30, y: 40 } }),
        accepted.sha256,
      ),
    ).rejects.toBeInstanceOf(CanvasLayoutConflictError);
    await expect(
      readFile(join(root, CANVAS_LAYOUT_FILE), "utf8"),
    ).resolves.toBe(external);
  });

  it("is represented as VERSIONED LOCAL-ONLY and excluded from plan and push", () => {
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
