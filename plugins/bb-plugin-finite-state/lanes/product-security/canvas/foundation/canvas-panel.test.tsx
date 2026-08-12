// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { ProductSecurityEditingLayer } from "../editing/index.js";
import {
  ProductSecurityLinksLayer,
  productSecurityEdgeTypes,
} from "../links/index.js";
import { loadProductSecurityNodeTypes } from "../nodes/index.js";
import { ProductSecurityThreatOverlay } from "../threat-overlay/index.js";
import CanvasShell, { type CanvasFoundationFeatures } from "./CanvasShell.js";
import type { CanvasModel, LayoutWorkerLike } from "./types.js";

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

afterEach(() => cleanup());

async function productSecurityPanel() {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(
    (candidate) => candidate.id === "product-security",
  );
  if (!panel) throw new Error("Product Security panel was not registered");
  return panel;
}

describe("WP-31 bb panel qualification", () => {
  it("registers three subpaths and does not read TARA on another tab", async () => {
    const panel = await productSecurityPanel();
    const slot = renderSlot(
      panel,
      { subPath: "requirements" },
      { context: { projectId: "project-1", threadId: null } },
    );
    expect(
      await slot.findByText("Requirements foundation reserved"),
    ).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual([]);
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
        rpc: { taraList: (input) => taraPage(input) },
      },
    );
    expect(slot.getByLabelText("Loading product-security model")).toBeTruthy();

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

    const main = slot.container.querySelector("main");
    expect(main?.className).toContain("bg-background");
    document.documentElement.classList.add("dark");
    expect(main?.className).toContain("text-foreground");
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
          taraList: (input) => {
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

  it("renders empty, error, stale, and unconfigured states", async () => {
    const panel = await productSecurityPanel();
    const empty = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: { taraList: () => ({ items: [], total: 0, next: null, cache }) },
      },
    );
    expect(await empty.findByText("No architecture model yet")).toBeTruthy();
    empty.lifecycle.unmount();

    const failed = renderSlot(
      panel,
      { subPath: "tara" },
      {
        context: { projectId: "project-1", threadId: null },
        rpc: { taraList: () => Promise.reject(new Error("cache failure")) },
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
        rpc: { taraList: (input) => taraPage(input, true) },
      },
    );
    expect(
      await stale.findByText("This canvas is stale", { exact: false }),
    ).toBeTruthy();
    stale.lifecycle.unmount();

    const unconfigured = renderSlot(
      panel,
      { subPath: "tara" },
      { context: { projectId: null, threadId: null } },
    );
    expect(await unconfigured.findByText("Choose a project")).toBeTruthy();
    unconfigured.lifecycle.unmount();
  });

  it("keeps the existing layout visible on timeout and offers Retry", async () => {
    const createLayoutWorker = (): LayoutWorkerLike => ({
      onmessage: null,
      onerror: null,
      postMessage() {},
      terminate() {},
    });
    const view = render(
      <CanvasShell
        createLayoutWorker={createLayoutWorker}
        features={features}
        layoutTimeoutMs={5}
        model={model}
      />,
    );
    expect(
      await view.findByLabelText("component Connected device"),
    ).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Tidy canvas" }));
    expect(
      await view.findByText("Auto-layout timed out", { exact: false }),
    ).toBeTruthy();
    expect(view.getByLabelText("component Connected device")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Retry auto-layout" }),
    ).toBeTruthy();
    view.unmount();
  });
});
