// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@bb/plugin-sdk/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import { ProductSecurityEditingLayer } from "../editing/index.js";
import {
  ProductSecurityLinksLayer,
  productSecurityEdgeTypes,
} from "../links/index.js";
import { loadProductSecurityNodeTypes } from "../nodes/index.js";
import { ProductSecurityThreatOverlay } from "../threat-overlay/index.js";
import CanvasShell, { type CanvasFoundationFeatures } from "./CanvasShell.js";
import { canvasLayoutStorageKey } from "./layout-storage.js";
import type { CanvasModel, LayoutResult } from "./types.js";
import { resolveTestTaraScope } from "../scope/test-fixture.js";

const cache = {
  state: "fresh",
  asOf: "2026-08-12T12:00:01.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 3,
};

function inputKind(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const kind = Reflect.get(input, "kind");
  return typeof kind === "string" ? kind : null;
}

function taraPage(input: unknown, stale = false) {
  const kind = inputKind(input);
  const pageCache = stale
    ? {
        ...cache,
        state: "stale",
        message: "Accepted cache is stale.",
      }
    : cache;
  if (kind === "component") {
    return {
      items: [
        {
          projectId: "project-1",
          projectVersionId: null,
          kind: "component",
          key: "COMP-device",
          label: "Connected device",
          fields: { type: "device", criticality: "high" },
        },
        {
          projectId: "project-1",
          projectVersionId: null,
          kind: "component",
          key: "COMP-api",
          label: "API gateway",
          fields: { type: "service" },
        },
      ],
      total: 2,
      next: null,
      cache: pageCache,
    };
  }
  if (kind === "dataflow") {
    return {
      items: [
        {
          projectId: "project-1",
          projectVersionId: null,
          kind: "dataflow",
          key: "FLOW-https",
          label: "Telemetry",
          fields: {
            source: "COMP-device",
            target: "COMP-api",
            protocol: "HTTPS",
            encrypted: true,
            authenticated: true,
          },
        },
      ],
      total: 1,
      next: null,
      cache: pageCache,
    };
  }
  return { items: [], total: 0, next: null, cache: pageCache };
}

function requirementsPage() {
  return {
    items: [
      {
        projectId: "project-1",
        projectVersionId: null,
        kind: "requirement",
        key: "REQ-secure-update",
        label: "REQ-secure-update",
        fields: {
          requirement: {
            schema: "fs-requirement/v1",
            id: "REQ-secure-update",
            req_type: "security",
            priority: "P1",
            status: "draft",
            ears: {
              pattern: "ubiquitous",
              text: "The gateway SHALL reject unsigned firmware",
              parts: {
                system: "gateway",
                response: "reject unsigned firmware",
              },
            },
            source_description: "Protect the update trust boundary.",
            mitigations: [],
            controls: [],
            standards: [],
            verification: [],
          },
          evidenceState: "not_run",
          stale: false,
          local: true,
          tiers: [
            { tier: "static", state: "not_run", count: 0 },
            { tier: "emulation", state: "not_run", count: 0 },
            { tier: "hil", state: "not_run", count: 0 },
            { tier: "manual", state: "not_run", count: 0 },
          ],
          sourceSha256: null,
        },
      },
    ],
    total: 1,
    next: null,
    cache,
  };
}

const observedElements = new WeakSet<Element>();

class CanvasResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    if (observedElements.has(target)) return;
    observedElements.add(target);
    queueMicrotask(() => {
      const size = { blockSize: 600, inlineSize: 1000 };
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1000, 600),
            borderBoxSize: [size],
            contentBoxSize: [size],
            devicePixelContentBoxSize: [size],
          },
        ],
        this,
      );
    });
  }

  unobserve(): void {}
  disconnect(): void {}
}

const features: CanvasFoundationFeatures = {
  nodeTypes: await loadProductSecurityNodeTypes(),
  edgeTypes: productSecurityEdgeTypes,
  ThreatOverlay: ProductSecurityThreatOverlay,
  LinksLayer: ProductSecurityLinksLayer,
  EditingLayer: ProductSecurityEditingLayer,
};

const model: CanvasModel = {
  nodes: [
    {
      id: "COMP-device",
      kind: "component",
      label: "Connected device",
      width: 216,
      height: 112,
      componentType: "device",
      criticality: "high",
      isEntryPoint: true,
    },
    {
      id: "COMP-api",
      kind: "component",
      label: "API gateway",
      width: 216,
      height: 112,
      componentType: "service",
      criticality: null,
      isEntryPoint: false,
    },
  ],
  edges: [
    {
      id: "FLOW-https",
      source: "COMP-device",
      target: "COMP-api",
      label: "Telemetry",
      protocol: "HTTPS",
      encrypted: true,
      authenticated: true,
    },
  ],
  cache: { pulledAt: cache.asOf, stale: false },
};

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", CanvasResizeObserver);
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      readonly m22 = 1;
    },
  );
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => true,
    }),
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    (callback: FrameRequestCallback): number =>
      window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
    window.clearTimeout(handle);
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 1000, 600),
  );
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement): number {
        const width = Number.parseFloat(this.style.width);
        return Number.isFinite(width)
          ? width
          : this.classList.contains("react-flow__handle")
            ? 10
            : 1000;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement): number {
        const height = Number.parseFloat(this.style.height);
        return Number.isFinite(height)
          ? height
          : this.classList.contains("react-flow__handle")
            ? 10
            : 600;
      },
    },
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: () => new DOMRect(0, 0, 80, 16),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function productSecurityPanel() {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(
    (candidate) => candidate.id === "product-security",
  );
  if (!panel) throw new Error("Product Security panel was not registered");
  return panel;
}

describe("WP-31 bb panel qualification", () => {
  it("clears the old canvas and overlay before rendering a newly selected version", async () => {
    await loadPluginApp(() => import("../../../../app.js"));
    const { ProductSecurityPanel } =
      await import("../../ui/ProductSecurityPanel.js");
    const EmptyLayer = () => null;
    const ThreatScope = ({
      scope,
    }: {
      scope?: { projectVersionId: string | null };
    }) => (
      <output>
        {scope ? `overlay ${scope.projectVersionId}` : "no overlay"}
      </output>
    );
    const features = {
      loadNodeTypes: loadProductSecurityNodeTypes,
      edgeTypes: {},
      ThreatOverlay: ThreatScope,
      LinksLayer: EmptyLayer,
      EditingLayer: EmptyLayer,
      RequirementsCards: EmptyLayer,
      RequirementsTraceabilityLayer: EmptyLayer,
      RequirementsConversionLayer: EmptyLayer,
      VerificationMatrix: EmptyLayer,
      VerificationRunDetailLayer: EmptyLayer,
    };
    const versions = ["version-2", "version-1"].map((projectVersionId) => ({
      platformProjectId: "platform-1",
      projectVersionId,
      asOf: `2026-08-14T1${projectVersionId.endsWith("2") ? "2" : "1"}:00:00.000Z`,
    }));
    const slot = renderSlot(
      {
        component(props: PluginNavPanelProps): React.JSX.Element {
          return <ProductSecurityPanel {...props} features={features} />;
        },
      },
      { subPath: "tara" },
      {
        context: { projectId: "workspace-1", threadId: null },
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "workspace-1", name: "Medical device", isPersonal: false },
          ],
          threads: [],
        },
        rpc: {
          taraScopeResolve: (input) => {
            const explicit =
              typeof input === "object" && input !== null
                ? Reflect.get(input, "explicit")
                : null;
            const projectVersionId =
              typeof explicit === "object" && explicit !== null
                ? Reflect.get(explicit, "projectVersionId")
                : "version-2";
            const selected =
              versions.find(
                (version) => version.projectVersionId === projectVersionId,
              ) ?? versions[0]!;
            return {
              versions,
              selected,
              source: explicit ? "explicit" : "latest",
              legacy: null,
            };
          },
          taraCanvasList: (input) => {
            const page = taraPage(input);
            const projectVersionId =
              typeof input === "object" && input !== null
                ? Reflect.get(input, "projectVersionId")
                : null;
            return inputKind(input) === "component"
              ? {
                  ...page,
                  items: page.items.map((item) => ({
                    ...item,
                    label: `${item.label} ${projectVersionId}`,
                  })),
                }
              : page;
          },
        },
      },
    );
    expect(
      await slot.findByLabelText("component Connected device version-2"),
    ).toBeTruthy();
    expect(await slot.findByText("overlay version-2")).toBeTruthy();

    fireEvent.change(slot.getByLabelText("TARA version"), {
      target: {
        value: `${versions[1]!.platformProjectId}\0${versions[1]!.projectVersionId}`,
      },
    });
    expect(
      slot.queryByLabelText("component Connected device version-2"),
    ).toBeNull();
    expect(slot.queryByText("overlay version-2")).toBeNull();
    expect(slot.getByLabelText("Loading product-security model")).toBeTruthy();
    expect(
      await slot.findByLabelText("component Connected device version-1"),
    ).toBeTruthy();
    expect(await slot.findByText("overlay version-1")).toBeTruthy();
    const latestTaraCalls = slot.inspection.rpcCalls.filter(
      (call) =>
        call.method === "taraCanvasList" &&
        typeof call.input === "object" &&
        call.input !== null &&
        Reflect.get(call.input, "projectVersionId") === "version-1",
    );
    expect(latestTaraCalls).toHaveLength(4);
    slot.lifecycle.unmount();
  });

  it("registers three subpaths and self-loads requirements without reading TARA", async () => {
    const panel = await productSecurityPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          requirementsList: () => requirementsPage(),
        },
      },
    );
    expect(await slot.findByText("REQ-secure-update")).toBeTruthy();
    expect(slot.getByLabelText("Evidence status: Not run")).toBeTruthy();
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual([
      "connectionsStatus",
      "requirementsList",
    ]);
    expect(slot.getByRole("button", { name: "TARA" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Requirements" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Verifications" })).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("lazy-mounts one representative node and edge with selection and zoom controls", async () => {
    const panel = await productSecurityPanel();
    const slot = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => taraPage(input),
        },
      },
    );
    expect(
      await slot.findByLabelText("Loading product-security model"),
    ).toBeTruthy();

    const node = await slot.findByLabelText("component Connected device");
    const nodeWrapper = node.closest(".react-flow__node");
    if (!nodeWrapper) throw new Error("React Flow node wrapper did not render");
    fireEvent.click(nodeWrapper);
    await waitFor(() => {
      expect(
        slot.getByText("COMP-device", { selector: "output" }),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        slot.container.querySelector('[data-id="FLOW-https"]'),
      ).toBeTruthy();
    });
    const zoomIn = slot.getByRole("button", { name: /zoom in/iu });
    expect(zoomIn).toBeTruthy();
    expect(slot.getByRole("button", { name: /zoom out/iu })).toBeTruthy();
    fireEvent.click(zoomIn);

    const panelRegion = slot.getByRole("region", {
      name: "Product Security",
    });
    expect(panelRegion.className).toContain("bg-background");
    document.documentElement.classList.add("dark");
    expect(panelRegion.className).toContain("text-foreground");
    await waitFor(() => {
      expect(slot.container.querySelector(".react-flow.dark")).toBeTruthy();
    });
    document.documentElement.classList.remove("dark");
    await waitFor(() => {
      expect(slot.container.querySelector(".react-flow.light")).toBeTruthy();
    });
    slot.lifecycle.unmount();
  });

  it("keeps a warm-cache canvas readable when a refresh fails", async () => {
    const panel = await productSecurityPanel();
    let offline = false;
    const slot = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => {
            if (offline) throw new Error("offline");
            return taraPage(input);
          },
        },
      },
    );
    expect(
      await slot.findByLabelText("component Connected device"),
    ).toBeTruthy();
    offline = true;
    await slot.behavior.emitRealtime("tara:changed", {
      projectId: "project-1",
    });
    expect(
      await slot.findByText(
        "Refresh failed. The accepted warm-cache canvas remains available.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(slot.getByLabelText("component Connected device")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("surfaces a failed background read when the retained canvas is empty", async () => {
    const panel = await productSecurityPanel();
    let offline = false;
    const slot = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: () => {
            if (offline) throw new Error("offline");
            return { items: [], total: 0, next: null, cache };
          },
        },
      },
    );
    expect(await slot.findByText("No architecture model yet")).toBeTruthy();
    offline = true;
    await slot.behavior.emitRealtime("tara:changed", {
      projectId: "project-1",
    });
    expect(
      await slot.findByText("Product-security cache unavailable"),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("renders empty, error, stale, and unconfigured states", async () => {
    const panel = await productSecurityPanel();
    const empty = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: () => ({ items: [], total: 0, next: null, cache }),
        },
      },
    );
    expect(await empty.findByText("No architecture model yet")).toBeTruthy();
    empty.lifecycle.unmount();

    const failed = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: () => Promise.reject(new Error("cache failure")),
        },
      },
    );
    expect(
      await failed.findByText("Product-security cache unavailable"),
    ).toBeTruthy();
    failed.lifecycle.unmount();

    const stale = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => taraPage(input, true),
        },
      },
    );
    expect(
      await stale.findByText("Accepted cache is stale.", { exact: false }),
    ).toBeTruthy();
    stale.lifecycle.unmount();

    const onlyQuarantined = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => ({
            items: [],
            total: 0,
            next: null,
            cache: {
              ...cache,
              state: inputKind(input) === "component" ? "stale" : "empty",
              message:
                inputKind(input) === "component"
                  ? "Invalid working YAML quarantined at broken-controller.yaml. Reason: verification_status cannot be authored."
                  : "No accepted product-security cache is available.",
            },
          }),
        },
      },
    );
    expect(
      await onlyQuarantined.findByText("Architecture files need attention"),
    ).toBeTruthy();
    expect(
      onlyQuarantined.getByText("broken-controller.yaml", { exact: false }),
    ).toBeTruthy();
    expect(
      onlyQuarantined.queryByText("Product-security cache unavailable"),
    ).toBeNull();
    onlyQuarantined.lifecycle.unmount();

    const unsupported = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => {
            const unsupportedComponent = inputKind(input) === "component";
            const page = taraPage(input, unsupportedComponent);
            return {
              ...page,
              cache: {
                ...page.cache,
                state: unsupportedComponent ? "stale" : "empty",
                message: unsupportedComponent
                  ? "Unsupported component type in authored file product-security/architecture/components/unknown-1.yaml: component_type “mystery_1” is not recognized."
                  : "No accepted product-security cache is available.",
              },
            };
          },
        },
      },
    );
    expect(
      await unsupported.findByText("Unsupported component type", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      unsupported.getByText("unknown-1.yaml", { exact: false }),
    ).toBeTruthy();
    expect(
      unsupported.queryByText("No accepted product-security cache", {
        exact: false,
      }),
    ).toBeNull();
    unsupported.lifecycle.unmount();

    const refreshFailure = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: () => ({
            items: [],
            total: 0,
            next: null,
            cache: {
              ...cache,
              state: "stale",
              message:
                "The last product-security refresh failed; showing accepted cache.",
            },
          }),
        },
      },
    );
    expect(
      await refreshFailure.findByText("Product-security refresh failed"),
    ).toBeTruthy();
    expect(refreshFailure.getByText("Open Sync")).toBeTruthy();
    expect(
      refreshFailure.queryByText("Architecture files need attention"),
    ).toBeNull();
    refreshFailure.lifecycle.unmount();

    const refreshAndDiagnostics = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: resolveTestTaraScope,
          taraCanvasList: (input) => ({
            items: [],
            total: 0,
            next: null,
            cache: {
              ...cache,
              state: "stale",
              message:
                inputKind(input) === "component"
                  ? "The last product-security refresh failed; showing accepted cache. Invalid working YAML quarantined at broken-controller.yaml. Reason: verification_status cannot be authored."
                  : "The last product-security refresh failed; showing accepted cache.",
            },
          }),
        },
      },
    );
    expect(
      await refreshAndDiagnostics.findByText(
        "Architecture files need attention",
      ),
    ).toBeTruthy();
    expect(
      refreshAndDiagnostics.getByText("broken-controller.yaml", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(
      refreshAndDiagnostics.getByText("refresh also failed", { exact: false }),
    ).toBeTruthy();
    expect(refreshAndDiagnostics.getByText("Open Sync")).toBeTruthy();
    refreshAndDiagnostics.lifecycle.unmount();

    const unconfigured = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: null, threadId: null },
        rpc: { connectionsStatus: connectedRemoteStatus },
      },
    );
    expect(await unconfigured.findByText("Choose a project")).toBeTruthy();
    unconfigured.lifecycle.unmount();

    const freshProject = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "fresh-workspace", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: () => ({
            versions: [],
            selected: null,
            source: "local",
            legacy: null,
          }),
          taraCanvasList: () => ({
            items: [],
            total: 0,
            next: null,
            cache,
          }),
        },
      },
    );
    expect(
      await freshProject.findByText("No architecture model yet"),
    ).toBeTruthy();
    expect(
      freshProject.getByRole("button", { name: "Open Sync" }),
    ).toBeTruthy();
    const continueLocal = freshProject.getByRole("button", {
      name: "Continue local authoring",
    });
    expect(continueLocal).toBeTruthy();
    const localVersion = freshProject.getByRole("combobox", {
      name: "TARA version",
    });
    expect(localVersion).toBeInstanceOf(HTMLSelectElement);
    expect((localVersion as HTMLSelectElement).value).toBe("");
    fireEvent.click(continueLocal);
    expect(await freshProject.findByLabelText("Create component")).toBeTruthy();
    expect(freshProject.queryByText("Loading accepted model…")).toBeNull();
    freshProject.lifecycle.unmount();
  });

  it("requires and discloses explicit all-kind legacy promotion", async () => {
    const panel = await productSecurityPanel();
    let promoted = false;
    const selected = {
      platformProjectId: "platform-legacy",
      projectVersionId: "version-promoted",
      asOf: "2026-08-14T12:00:00.000Z",
    };
    const slot = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "workspace-legacy", threadId: null },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          taraScopeResolve: () =>
            promoted
              ? {
                  versions: [selected],
                  selected,
                  source: "explicit",
                  legacy: null,
                }
              : {
                  versions: [],
                  selected: null,
                  source: "local",
                  legacy: {
                    platformProjectId: "platform-legacy",
                    kinds: ["component", "threat"],
                  },
                },
          taraScopePromote: () => {
            promoted = true;
            return { selected, promotedKinds: ["component", "threat"] };
          },
          taraCanvasList: () => ({ items: [], total: 0, next: null, cache }),
        },
      },
    );
    expect(
      await slot.findByText("Promote legacy TARA to a version"),
    ).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Target version ID"), {
      target: { value: "version-promoted" },
    });
    fireEvent.click(
      slot.getByRole("button", { name: "Promote complete snapshot" }),
    );
    expect(
      await slot.findByText(
        "Promoted the complete legacy snapshot: component, threat.",
      ),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("paints Arrange state and persists successful positions", async () => {
    let complete = (_result: LayoutResult): void => undefined;
    const pending = new Promise<LayoutResult>((resolveLayout) => {
      complete = resolveLayout;
    });
    const view = render(
      <CanvasShell
        arrange={() => pending}
        features={features}
        model={model}
        projectId="project-1"
      />,
    );
    expect(
      await view.findByLabelText("component Connected device"),
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Arrange canvas" }));
    expect(
      await view.findByText("Dense models can pause", { exact: false }),
    ).toBeTruthy();
    expect(view.container.querySelector("section")?.ariaBusy).toBe("true");

    complete({
      positions: {
        "COMP-device": { x: 432, y: 96 },
        "COMP-api": { x: 864, y: 96 },
      },
      durationMs: 1_240,
    });
    expect(
      await view.findByText("Arranged in 1240 ms", { exact: false }),
    ).toBeTruthy();
    expect(
      window.localStorage.getItem(canvasLayoutStorageKey("project-1")),
    ).toContain('"x":432');
    view.unmount();

    const restored = render(
      <CanvasShell features={features} model={model} projectId="project-1" />,
    );
    const restoredNode = await restored.findByLabelText(
      "component Connected device",
    );
    expect(
      restoredNode.closest(".react-flow__node")?.getAttribute("style"),
    ).toContain("translate(432px,96px)");
    restored.unmount();
  });

  it("keeps the existing layout visible when Arrange fails and offers Retry", async () => {
    const view = render(
      <CanvasShell
        arrange={() => Promise.reject(new Error("representative ELK failure"))}
        features={features}
        model={model}
        projectId="project-1"
      />,
    );
    expect(
      await view.findByLabelText("component Connected device"),
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Arrange canvas" }));
    expect(
      await view.findByText("Existing positions are unchanged", {
        exact: false,
      }),
    ).toBeTruthy();
    expect(view.getByLabelText("component Connected device")).toBeTruthy();
    expect(view.getByRole("button", { name: "Retry arrange" })).toBeTruthy();
    view.unmount();
  });
});
