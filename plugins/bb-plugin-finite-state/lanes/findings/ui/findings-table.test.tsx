// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../test/app-connections.js";
import { parseFindingsRoute, serializeFindingsFilter } from "./route.js";

const freshCache = { state: "fresh" as const, asOf: "2026-08-13T00:00:00.000Z", message: null, acceptedGenerationId: "generation-1", baseRevision: 1 };

function inputField(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null ? Reflect.get(input, key) : undefined;
}

function finding(index: number, stableKey = `stable-${index}`) {
  return {
    projectId: "project-1",
    projectVersionId: "version-1",
    kind: "finding",
    key: `finding-${index}`,
    label: `Finding ${index}`,
    fields: {
      stableKey,
      findingType: "vulnerability",
      cve: `CVE-2026-${String(index).padStart(4, "0")}`,
      title: `Finding ${index}`,
      componentName: `component-${index}`,
      componentVersion: "1.0.0",
      severity: index % 2 === 0 ? "critical" : "high",
      epssScore: 0.42,
      inKev: index === 0,
      inVcKev: false,
      reachabilityVerdict: "reachable",
      vexStatus: null,
      firstSeen: "2026-08-01T00:00:00.000Z",
      localState: index === 1 ? "conflicted" : "none",
      localFile: index === 1 ? ".fs/triage/one.yaml" : null,
    },
  };
}

class FindingsResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 1200, 600), borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }], contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }], devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }] }], this));
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.setConfig({ testTimeout: 15_000 });
  vi.stubGlobal("ResizeObserver", FindingsResizeObserver);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
    this.dispatchEvent(new Event("scroll"));
  };
});

afterEach(() => cleanup());

async function renderFindings(
  list: (input: unknown) => unknown | Promise<unknown>,
  options: { subPath?: string; versions?: unknown; saved?: unknown; projectId?: string | null } = {},
) {
  const app = await loadPluginApp(() => import("../../../app.js"));
  const panel = app.navPanels.find(candidate => candidate.path === "findings");
  if (!panel) throw new Error("Findings panel not registered");
  const slot = renderSlot(panel, { subPath: options.subPath ?? "" }, {
    context: { projectId: options.projectId === undefined ? "project-1" : options.projectId },
    sidebarThreads: { status: "ready", projects: [{ id: "project-1", name: "Project One", isPersonal: false }] },
    rpc: {
      connectionsStatus: connectedRemoteStatus,
      cachedProjectVersions: () => options.versions ?? { versions: [{ projectVersionId: "version-1", asOf: "2026-08-13T00:00:00.000Z", state: "fresh" }], selectedProjectVersionId: "version-1" },
      findingsSavedViewsGet: () => options.saved ?? { views: [], sha256: null, recoveredFromCorrupt: false },
      findingsSavedViewsPut: input => ({ views: typeof input === "object" && input !== null ? Reflect.get(input, "views") : [], sha256: "a".repeat(64), recoveredFromCorrupt: false }),
      findingsUiList: input => list(input),
    },
  });
  await slot.findByLabelText("Saved finding view", {}, { timeout: 10_000 });
  return { slot, panel };
}

describe("findings table panel", () => {
  it("virtualizer bounds mounted rows for a 39,000-row result", async () => {
    const { slot } = await renderFindings(() => ({ items: Array.from({ length: 100 }, (_, index) => finding(index)), total: 39_000, next: "page-2", cache: freshCache }));
    await slot.findByText("CVE-2026-0000");
    expect(slot.container.querySelectorAll("[data-finding-row]").length).toBeLessThan(50);
    expect(slot.getByRole("grid").getAttribute("aria-rowcount")).toBe("39001");
    fireEvent.click(slot.getByRole("checkbox", { name: "epss" }));
    expect(slot.queryByRole("columnheader", { name: "EPSS" })).toBeNull();
  });

  it("appends cursor pages without duplicate stable keys and retains rows on a page fault", async () => {
    let pageAttempts = 0;
    const { slot } = await renderFindings(input => {
      if (inputField(input, "continuation") === "page-2") {
        pageAttempts += 1;
        if (pageAttempts === 1) throw new Error("Injected next-page fault");
        return { items: [finding(99), finding(100)], total: 101, next: null, cache: freshCache };
      }
      return { items: Array.from({ length: 100 }, (_, index) => finding(index)), total: 101, next: "page-2", cache: freshCache };
    });
    await slot.findByText("CVE-2026-0000");
    fireEvent.click(slot.getByRole("button", { name: "Load next page" }));
    expect(await slot.findByText(/Next page failed/u)).toBeTruthy();
    expect(slot.getByText("CVE-2026-0000")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry page" }));
    await waitFor(() => expect(slot.getByText("101 loaded / 101")).toBeTruthy());
    expect(pageAttempts).toBe(2);
  });

  it("round-trips every filter and issues the expected RPC input", async () => {
    const calls: unknown[] = [];
    const filter = { severity: ["critical", "high"], reachability: "reachable" as const, kev: "kev" as const, epssGte: 0.5, component: "openssl", cve: "CVE-2026", triage: ["unknown"], findingType: ["vulnerability"], localState: ["conflicted" as const] };
    const query = serializeFindingsFilter(filter);
    expect(parseFindingsRoute(`q/${query}`)).toMatchObject({ kind: "table", filter });
    await renderFindings(input => { calls.push(input); return { items: [], total: 0, next: null, cache: freshCache }; }, { subPath: `q/${query}` });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(inputField(calls.at(-1), "filters")).toEqual(filter);
  });

  it("preserves grid scroll and roving focus while the detail route opens", async () => {
    const { slot, panel } = await renderFindings(() => ({ items: Array.from({ length: 100 }, (_, index) => finding(index)), total: 100, next: null, cache: freshCache }));
    await slot.findByText("CVE-2026-0000");
    const grid = slot.getByRole("grid");
    const first = slot.container.querySelector("[data-finding-row]");
    if (!(first instanceof HTMLElement)) throw new Error("first row missing");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-rowindex")).toBe("3"));
    grid.scrollTop = 88;
    await Promise.resolve();
    const Component = panel.component;
    slot.lifecycle.rerender(<Component subPath="f/stable-1" />);
    expect(await slot.findByLabelText("Finding stable-1")).toBeTruthy();
    expect(slot.getByRole("grid").scrollTop).toBe(88);
    expect(document.activeElement?.getAttribute("aria-rowindex")).toBe("3");
  });

  it("predicate selection spans unloaded rows and records explicit exclusions", async () => {
    const { slot } = await renderFindings(() => ({ items: Array.from({ length: 100 }, (_, index) => finding(index)), total: 39_000, next: "page-2", cache: freshCache }));
    await slot.findByText("CVE-2026-0000");
    fireEvent.click(slot.getByRole("button", { name: "Select all 39,000" }));
    expect(slot.getByLabelText("39000 findings selected")).toBeTruthy();
    fireEvent.click(slot.getByRole("checkbox", { name: "Select CVE-2026-0000" }));
    expect(slot.getByLabelText("38999 findings selected")).toBeTruthy();
  });

  it("renders loading, empty, error, stale, and unconfigured states", async () => {
    const loading = await renderFindings(() => new Promise(() => {}));
    expect(await loading.slot.findByLabelText("Loading findings")).toBeTruthy();
    loading.slot.lifecycle.unmount();

    const empty = await renderFindings(() => ({ items: [], total: 0, next: null, cache: { ...freshCache, state: "empty" } }));
    expect(await empty.slot.findByText("No findings cached")).toBeTruthy();
    empty.slot.lifecycle.unmount();

    const failed = await renderFindings(() => Promise.reject(new Error("Indexed cache unavailable")));
    expect(await failed.slot.findByText("Findings unavailable")).toBeTruthy();
    failed.slot.lifecycle.unmount();

    const stale = await renderFindings(() => ({ items: [finding(0)], total: 1, next: null, cache: { ...freshCache, state: "stale", message: "Pull failed" } }));
    expect(await stale.slot.findByText("Showing accepted stale data")).toBeTruthy();
    stale.slot.lifecycle.unmount();

    const unconfigured = await renderFindings(() => ({ items: [], total: 0, next: null, cache: freshCache }), { versions: { versions: [], selectedProjectVersionId: null } });
    expect(await unconfigured.slot.findByText("Choose a findings scope")).toBeTruthy();
  });

  it("recovers malformed saved-view state to immutable defaults without crashing", async () => {
    const { slot } = await renderFindings(() => ({ items: [], total: 0, next: null, cache: freshCache }), { saved: { views: [], sha256: "b".repeat(64), recoveredFromCorrupt: true } });
    expect(await slot.findByText("Corrupt views quarantined; defaults restored.")).toBeTruthy();
    const options = Array.from(slot.getByLabelText("Saved finding view").querySelectorAll("option"), option => option.textContent);
    expect(options).toEqual(expect.arrayContaining(["Untriaged by risk", "Local changes", "Needs attention"]));
  });

  it("creates, renames, and deletes workspace saved views", async () => {
    const page = () => ({ items: [], total: 0, next: null, cache: freshCache });
    const created = await renderFindings(page);
    fireEvent.change(created.slot.getByLabelText("New saved view name"), { target: { value: "Reachable critical" } });
    fireEvent.click(created.slot.getByRole("button", { name: "Save current" }));
    await waitFor(() => expect(created.slot.inspection.rpcCalls.some(call => call.method === "findingsSavedViewsPut")).toBe(true));
    created.slot.lifecycle.unmount();

    const userView = {
      schema: "fs-findings-view/v1" as const,
      id: "user-one",
      name: "Workspace view",
      filter: {},
      sort: [{ field: "risk" as const, direction: "desc" as const }],
      columns: ["state", "severity", "cve", "component", "reachability", "kev", "epss", "triage", "age"],
    };
    const edited = await renderFindings(page, { subPath: "view/user-one", saved: { views: [userView], sha256: "b".repeat(64), recoveredFromCorrupt: false } });
    const rename = await edited.slot.findByLabelText("Rename saved view");
    fireEvent.change(rename, { target: { value: "Renamed view" } });
    fireEvent.click(edited.slot.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(edited.slot.inspection.rpcCalls.filter(call => call.method === "findingsSavedViewsPut")).toHaveLength(1));
    fireEvent.click(edited.slot.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(edited.slot.inspection.rpcCalls.filter(call => call.method === "findingsSavedViewsPut")).toHaveLength(2));
  });
});
