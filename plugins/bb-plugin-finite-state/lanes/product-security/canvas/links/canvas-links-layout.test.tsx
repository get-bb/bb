// @vitest-environment jsdom

import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { CANVAS_LAYOUT_FILE } from "./layout-store.js";
import { DebouncedLayoutSaver } from "./layout.js";
import {
  ProductSecurityLinksLayer,
  type CanvasLinksAppRuntime,
} from "./index.js";
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

beforeAll(() => installTestPluginRuntime());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

function unavailableVerificationFamily() {
  return {
    sourceSlug: SOURCE_SLUG,
    links: [
      {
        kind: "verification" as const,
        sourceSlug: SOURCE_SLUG,
        target: "",
        label: "Verification runs",
        ready: false as const,
        reason: "unavailable" as const,
      },
    ],
    readiness: {
      kind: "verification" as const,
      state: "unavailable" as const,
      message:
        "Verification links are not implemented yet. They become available when WP-39 registers the verification matrix.",
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
    expect(callbacks.onSafeAction).toHaveBeenCalledWith("sbom", "not_mapped");
  });

  it("navigates shipped link kinds and truthfully degrades verification", async () => {
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
          canvasVerificationLinks: unavailableVerificationFamily,
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
    expect(
      slot.getByText(
        "Verification links are not implemented yet. They become available when WP-39 registers the verification matrix.",
      ),
    ).toBeTruthy();
    expect(
      slot.queryByRole("button", { name: /Open Verification runs/iu }),
    ).toBeNull();

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
        options: { subPath: "requirements/trace/REQ-104" },
      },
    ]);
    slot.lifecycle.unmount();
  });

  it("keeps workspace layout identity separate from version-scoped link reads", async () => {
    const appRuntime = installedAppRuntime();
    const workspaceProjectId = "workspace-wp34";
    const slot = renderSlot<{}, typeof canvasLinksRpcContract>(
      {
        component: () => (
          <ArchitectureHarness>
            <ProductSecurityLinksLayer
              appRuntime={appRuntime}
              scope={{
                workspaceProjectId,
                platformProjectId: PROJECT_ID,
                projectVersionId: "version-wp34",
                mode: "version",
              }}
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
          canvasVerificationLinks: unavailableVerificationFamily,
          canvasLayoutLoad: () => ({
            ...layoutLoadResult(),
            layout: layout({}, workspaceProjectId),
          }),
          canvasLayoutSave: () => ({
            outcome: "saved",
            file: CANVAS_LAYOUT_FILE,
            sha256: "c".repeat(64),
            changed: false,
          }),
        },
      },
    );

    await slot.findByRole("button", {
      name: "Open SBOM entry: Gateway package",
    });
    const layoutCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "canvasLayoutLoad",
    );
    expect(layoutCall?.input).toMatchObject({
      projectId: workspaceProjectId,
    });
    const linkCall = slot.inspection.rpcCalls.find(
      (call) => call.method === "canvasSbomLinks",
    );
    expect(linkCall?.input).toMatchObject({
      workspaceProjectId,
      platformProjectId: PROJECT_ID,
      projectVersionId: "version-wp34",
    });
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
          canvasVerificationLinks: unavailableVerificationFamily,
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

    expect(await slot.findByText("SBOM link RPC failed")).toBeTruthy();
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
          canvasVerificationLinks: unavailableVerificationFamily,
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
    expect(saver.schedule(layout({ gateway: { x: 3.2, y: 2.8 } }))).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledOnce();
    saver.dispose();
  });
});
