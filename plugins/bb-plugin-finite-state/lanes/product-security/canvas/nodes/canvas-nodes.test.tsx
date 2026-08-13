// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";
import type { PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { JsonValue } from "../../../../shared/contract.js";
import {
  buildArchitectureAdjacency,
  fromCanvasGraph,
  toCanvasGraph,
  type ArchitectureModel,
} from "./adapters.js";
import {
  ProductSecurityCanvasWorkspace,
  loadProductSecurityNodeTypes,
  toFoundationCanvasModel,
} from "./index.js";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-12T12:00:01.000Z",
  message: null,
  acceptedGenerationId: "generation-wp32",
  baseRevision: 32,
};

const componentTypes = [
  "software",
  "hardware",
  "sensor",
  "actuator",
  "ecu",
  "hsm",
  "tee",
  "medical_device",
  "network",
] as const;

function architectureFixture(): ArchitectureModel {
  return {
    revision: "project-1:generation-wp32:32",
    cache: { pulledAt: cache.asOf, stale: false },
    nodes: [
      {
        slug: "zone-clinical",
        kind: "zone",
        name: "Clinical network",
        sourceFile: "architecture/zones/zone-clinical.yaml",
        description: "Authenticated clinical boundary",
      },
      ...componentTypes.map((componentType, index) => ({
        slug: `component-${componentType}`,
        kind: "component" as const,
        name: `${componentType.replaceAll("_", " ")} node`,
        componentType,
        criticality: index === 0 ? "high" : "medium",
        zone: "zone-clinical",
        sourceFile: `architecture/components/component-${componentType}.yaml`,
        interfaces: Array.from({ length: index === 0 ? 45 : 1 }, (_, row) => ({
          name: `interface-${row}`,
          protocol: row % 2 === 0 ? "HTTPS" : "CAN",
          port: 443 + row,
          direction: "bidirectional",
        })),
        technologies: ["TLS 1.3", "AUTOSAR"],
        affectedAssets: ["asset-patient-data"],
        threatCount: 4,
      })),
      {
        slug: "asset-patient-data",
        kind: "asset",
        name: "Patient data",
        criticality: "critical",
        zone: "zone-clinical",
        sourceFile: "architecture/assets/asset-patient-data.yaml",
      },
    ],
    dataflows: [
      {
        slug: "flow-telemetry",
        name: "Clinical telemetry",
        sourceSlug: "component-sensor",
        targetSlug: "component-software",
        protocol: "HTTPS",
        encrypted: true,
        authenticated: true,
        bidirectional: true,
        sourceFile: "architecture/dataflows/flow-telemetry.yaml",
      },
      {
        slug: "flow-missing-target",
        name: "Repair required",
        sourceSlug: "component-software",
        targetSlug: "component-not-authored",
        protocol: "CAN",
        encrypted: false,
        authenticated: false,
        bidirectional: false,
        sourceFile: "architecture/dataflows/flow-missing-target.yaml",
      },
    ],
  };
}

function inputKind(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const kind = Reflect.get(input, "kind");
  return typeof kind === "string" ? kind : null;
}

function nodeFields(
  node: ReturnType<typeof architectureFixture>["nodes"][number],
): Record<string, JsonValue> {
  const fields: Record<string, JsonValue> = {
    source_file: node.sourceFile,
  };
  if (node.componentType) fields.component_type = node.componentType;
  if (node.criticality) fields.criticality = node.criticality;
  if (node.zone) fields.zone_slug = node.zone;
  if (node.technologies) fields.technologies = node.technologies;
  if (node.affectedAssets) fields.affected_assets = node.affectedAssets;
  if (node.threatCount !== undefined) fields.threat_count = node.threatCount;
  if (node.description) fields.description = node.description;
  if (node.interfaces) {
    fields.interfaces = node.interfaces.map((entry) => ({
      name: entry.name,
      protocol: entry.protocol ?? null,
      port: entry.port ?? null,
      direction: entry.direction ?? null,
    }));
  }
  return fields;
}

function taraPage(input: unknown) {
  const kind = inputKind(input);
  const fixture = architectureFixture();
  const items =
    kind === "dataflow"
      ? fixture.dataflows.map((flow) => ({
          projectId: "project-1",
          projectVersionId: null,
          kind: "dataflow",
          key: flow.slug,
          label: flow.name ?? flow.slug,
          fields: {
            source_slug: flow.sourceSlug,
            target_slug: flow.targetSlug,
            protocol: flow.protocol ?? null,
            encrypted: flow.encrypted,
            authenticated: flow.authenticated,
            bidirectional: flow.bidirectional,
            source_file: flow.sourceFile,
          },
        }))
      : fixture.nodes
          .filter((node) => node.kind === kind)
          .map((node) => ({
            projectId: "project-1",
            projectVersionId: null,
            kind: node.kind,
            key: node.slug,
            label: node.name,
            fields: nodeFields(node),
          }));
  return { items, total: items.length, next: null, cache };
}

const observedElements = new WeakSet<Element>();

class CanvasResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    if (observedElements.has(target)) return;
    observedElements.add(target);
    queueMicrotask(() => {
      const size = { blockSize: 720, inlineSize: 1280 };
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1280, 720),
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

beforeAll(() => {
  installTestPluginRuntime();
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
    new DOMRect(0, 0, 1280, 720),
  );
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: { configurable: true, get: () => 1280 },
    offsetHeight: { configurable: true, get: () => 720 },
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

describe("WP-32 architecture adapters", () => {
  it("keys every node type by stable slug and round-trips containment and direction", () => {
    const model = architectureFixture();
    const graph = toCanvasGraph(model);
    for (const componentType of componentTypes) {
      const slug = `component-${componentType}`;
      const node = graph.nodes.find((candidate) => candidate.id === slug);
      expect(node).toMatchObject({
        id: slug,
        type: "component",
        parentId: "zone-clinical",
        data: { componentType },
      });
    }
    expect(graph.nodes.find((node) => node.id === "zone-clinical")?.type).toBe(
      "zone",
    );
    expect(
      graph.nodes.find((node) => node.id === "asset-patient-data"),
    ).toMatchObject({ type: "asset", parentId: "zone-clinical" });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      id: "flow-telemetry",
      source: "component-sensor",
      target: "component-software",
      data: { bidirectional: true, encrypted: true, authenticated: true },
    });
    expect(graph.edges[0]?.markerStart).toBeTruthy();

    const roundTrip = fromCanvasGraph("round-trip", graph);
    expect(
      roundTrip.nodes.find((node) => node.slug === "component-software")?.zone,
    ).toBe("zone-clinical");
    expect(roundTrip.dataflows[0]).toMatchObject({
      sourceSlug: "component-sensor",
      targetSlug: "component-software",
      bidirectional: true,
    });
  });

  it("retains valid graph data and source repair evidence for a missing endpoint", () => {
    const graph = toCanvasGraph(architectureFixture());
    expect(graph.edges.map((edge) => edge.id)).toEqual(["flow-telemetry"]);
    expect(graph.unresolved).toEqual([
      expect.objectContaining({
        ownerSlug: "flow-missing-target",
        field: "target",
        targetSlug: "component-not-authored",
        sourceFile: "architecture/dataflows/flow-missing-target.yaml",
      }),
    ]);
  });

  it("drops server UUID fields and builds adjacency only once per revision", async () => {
    const { createRpcArchitectureDataSource, deriveArchitectureData } =
      await import("./useNodeData.js");
    const serverUuid = "018f-server-uuid-must-not-leak";
    const source = createRpcArchitectureDataSource(async (input) => {
      const page = taraPage(input);
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          fields: { ...item.fields, serverUuid },
        })),
      };
    });
    const model = await source.read("project-1");
    expect(JSON.stringify(model)).not.toContain(serverUuid);
    const build = vi.fn(buildArchitectureAdjacency);
    const first = deriveArchitectureData(model, build);
    const second = deriveArchitectureData({ ...model }, build);
    expect(first).toBe(second);
    expect(build).toHaveBeenCalledTimes(1);
    expect(first.adjacency.get("component-sensor")?.connectedFlowSlugs).toEqual(
      ["flow-telemetry"],
    );
  });
});

describe("WP-32 inspector and project scope", () => {
  it("pages large inspector lists and offers the missing-edge source repair path", () => {
    const model = architectureFixture();
    const graph = toCanvasGraph(model);
    const adjacency = buildArchitectureAdjacency(model);
    const view = render(
      <ProductSecurityCanvasWorkspace
        adjacency={adjacency}
        focusId="component-software"
        graph={graph}
        model={model}
        onFocusRoute={() => undefined}
      >
        <div>Canvas placeholder</div>
      </ProductSecurityCanvasWorkspace>,
    );
    expect(view.getByText("Slug: component-software")).toBeTruthy();
    const interfaceList = view.container.querySelector(
      '[data-inspector-list="Interfaces"]',
    );
    expect(interfaceList?.children).toHaveLength(16);
    expect(
      view
        .getAllByRole("button", { name: /available in WP-35/iu })
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    fireEvent.click(view.getByRole("button", { name: "Next page (16)" }));
    expect(interfaceList?.children).toHaveLength(16);
    view.unmount();

    const repair = render(
      <ProductSecurityCanvasWorkspace
        adjacency={adjacency}
        focusId="flow-missing-target"
        graph={graph}
        model={model}
        onFocusRoute={() => undefined}
      >
        <div>Canvas placeholder</div>
      </ProductSecurityCanvasWorkspace>,
    );
    expect(repair.getByText("Unresolved target")).toBeTruthy();
    expect(
      repair.getAllByText("architecture/dataflows/flow-missing-target.yaml")[0],
    ).toBeTruthy();
  });

  it("selects and persists project scope without injected route context", async () => {
    const { ProductSecurityPanel } =
      await import("../../ui/ProductSecurityPanel.js");
    const EmptyLayer = () => null;
    const panel = {
      component(props: PluginNavPanelProps): React.JSX.Element {
        return (
          <ProductSecurityPanel
            {...props}
            features={{
              loadNodeTypes: loadProductSecurityNodeTypes,
              edgeTypes: {},
              ThreatOverlay: EmptyLayer,
              LinksLayer: EmptyLayer,
              EditingLayer: EmptyLayer,
              RequirementsCards: EmptyLayer,
              RequirementsTraceabilityLayer: EmptyLayer,
              RequirementsConversionLayer: EmptyLayer,
              VerificationMatrix: EmptyLayer,
              VerificationRunDetailLayer: EmptyLayer,
            }}
          />
        );
      },
    };
    const slot = renderSlot(
      panel,
      { subPath: "tara/nodes/component-software" },
      {
        context: { projectId: null, threadId: null },
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "project-1", name: "Medical device", isPersonal: false },
          ],
          threads: [],
        },
        rpc: { taraList: (input) => taraPage(input) },
      },
    );
    expect(slot.getByText("Choose a project")).toBeTruthy();
    fireEvent.change(slot.getByLabelText("Product Security project"), {
      target: { value: "project-1" },
    });
    const component = await slot.findByLabelText("component software node");
    expect(
      within(component).getByText("software", { selector: "div" }),
    ).toBeTruthy();
    expect(await slot.findByText("Slug: component-software")).toBeTruthy();
    for (const componentType of componentTypes) {
      expect(
        await slot.findByLabelText(
          `component ${componentType.replaceAll("_", " ")} node`,
        ),
      ).toBeTruthy();
    }
    expect(await slot.findByLabelText("zone Clinical network")).toBeTruthy();
    expect(await slot.findByLabelText("asset Patient data")).toBeTruthy();
    const flow = await slot.findByLabelText(
      "Dataflow Clinical telemetry: component-sensor to component-software",
    );
    expect(within(flow).getByText("Bidirectional")).toBeTruthy();
    expect(within(flow).getByText("Encrypted")).toBeTruthy();
    expect(within(flow).getByText("Authenticated")).toBeTruthy();
    expect(
      slot.getByText("Partial architecture:", { exact: false }),
    ).toBeTruthy();
    expect(slot.inspection.rpcCalls).toHaveLength(4);
    expect(
      slot.inspection.rpcCalls.every(
        (call) =>
          typeof call.input === "object" &&
          call.input !== null &&
          Reflect.get(call.input, "projectId") === "project-1",
      ),
    ).toBe(true);
    expect(
      window.localStorage.getItem(
        "finite-state:product-security:project-scope:v1",
      ),
    ).toBe("project-1");

    const nodeWrapper = component.closest(".react-flow__node");
    if (!nodeWrapper) throw new Error("React Flow node wrapper did not render");
    fireEvent.click(nodeWrapper);
    await waitFor(() => {
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "product-security",
        options: { subPath: "tara/nodes/component-software" },
      });
    });
    const hardware = slot.getByLabelText("component hardware node");
    const hardwareWrapper = hardware.closest(".react-flow__node");
    if (!hardwareWrapper) {
      throw new Error("Second React Flow node wrapper did not render");
    }
    fireEvent.keyDown(document, { key: "Shift" });
    fireEvent.click(hardwareWrapper, { shiftKey: true });
    fireEvent.keyUp(document, { key: "Shift" });
    expect(await slot.findByText("2 selected")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("keeps the foundation projection slug-keyed", () => {
    const model = architectureFixture();
    const graph = toCanvasGraph(model);
    const foundation = toFoundationCanvasModel(model, graph);
    expect(foundation.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(model.nodes.map((node) => node.slug)),
    );
    expect(foundation.edges).toEqual([
      expect.objectContaining({
        id: "flow-telemetry",
        source: "component-sensor",
        target: "component-software",
      }),
    ]);
  });
});
