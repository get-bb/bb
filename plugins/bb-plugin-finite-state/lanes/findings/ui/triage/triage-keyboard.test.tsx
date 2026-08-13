// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import { isShortcutSuppressed } from "./keyboard.js";
import { VEX_SHORTCUTS } from "./validation.js";

const freshCache = { state: "fresh" as const, asOf: "2026-08-13T00:00:00.000Z", message: null, acceptedGenerationId: "generation-1", baseRevision: 1 };

function finding(index: number) {
  return {
    projectId: "platform-project-1", projectVersionId: "version-1", kind: "finding", key: `finding-${index}`, label: `Finding ${index}`,
    fields: { stableKey: `stable-${index}`, cve: `CVE-2026-${index}`, componentName: `component-${index}`, componentVersion: "1", severity: "high", reachabilityVerdict: "unreachable", localState: "none" },
  };
}

function target(findingId: string) {
  const index = Number(findingId.split("-").at(-1));
  return { findingId, stableKey: `stable-${index}`, cve: `CVE-2026-${index}`, label: `CVE-2026-${index} · component-${index} 1`, component: { purl: null, name: `component-${index}`, group: null, version: "1" }, evidence: "Call graph: no path", reasonSeed: "Call graph: no path", expectedSha256: null, file: null, prior: null };
}

class TriageResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element): void { queueMicrotask(() => this.callback([{ target: element, contentRect: new DOMRectReadOnly(0, 0, 1200, 600), borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }], contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }], devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }] }], this)); }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  configure({ asyncUtilTimeout: 10_000 });
  vi.stubGlobal("ResizeObserver", TriageResizeObserver);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000040" });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number): void { this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0; this.dispatchEvent(new Event("scroll")); };
});

afterEach(() => cleanup());

async function renderTriage() {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(candidate => candidate.path === "findings");
  if (!panel) throw new Error("Findings panel missing");
  const slot = renderSlot(panel, { subPath: "" }, {
    context: { projectId: "workspace-project-1" },
    sidebarThreads: { status: "ready", projects: [{ id: "workspace-project-1", name: "Workspace", isPersonal: false }] },
    rpc: {
      connectionsStatus: connectedRemoteStatus,
      cachedProjectVersions: () => ({ versions: [{ platformProjectId: "platform-project-1", projectVersionId: "version-1", asOf: freshCache.asOf, state: "fresh" }], selectedPlatformProjectId: "platform-project-1", selectedProjectVersionId: "version-1" }),
      findingsSavedViewsGet: () => ({ views: [], sha256: null, recoveredFromCorrupt: false }),
      findingsUiList: () => ({ items: [finding(0), finding(1), finding(2)], total: 3, next: null, cache: freshCache }),
      triageTargetsRead: input => {
        const ids = typeof input === "object" && input !== null && "selection" in input && typeof input.selection === "object" && input.selection !== null && "findingIds" in input.selection ? input.selection.findingIds as string[] : [];
        return { items: ids.map(target), total: ids.length, next: null };
      },
      triageDecisionsWrite: () => ({ results: [] }),
      triageDecisionUndo: () => ({ file: ".fs/triage/component.yaml", afterSha256: "a".repeat(64) }),
    },
  });
  await waitFor(() => expect(slot.container.querySelectorAll("[data-finding-row]").length).toBeGreaterThan(0));
  return slot;
}

describe("findings keyboard triage", () => {
  it("moves j/k, opens detail with Enter, and preserves the roving cursor", async () => {
    const slot = await renderTriage();
    const rows = slot.container.querySelectorAll<HTMLElement>("[data-finding-row]");
    rows[0]?.focus();
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(document.activeElement).toBe(rows[1]));
    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(document.activeElement).toBe(rows[0]));
    const navigations = slot.inspection.navigateCalls.length;
    fireEvent.keyDown(window, { key: "Enter" });
    expect(slot.inspection.navigateCalls).toHaveLength(navigations + 1);
    expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "toPluginPanel", options: { subPath: "f/stable-0" } });
  });

  it("maps all six status letters one-to-one to drafts", async () => {
    const slot = await renderTriage();
    for (const [key, status] of Object.entries(VEX_SHORTCUTS)) {
      fireEvent.keyDown(window, { key, shiftKey: key === "R" });
      const editor = await slot.findByRole("form", { name: /Triage CVE/u });
      expect(within(editor).getByText(status)).toBeTruthy();
      fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(slot.queryByRole("form", { name: /Triage CVE/u })).toBeNull());
    }
  });

  it("suppresses text entry, dialogs, native control activation, and host chords without killing button letter shortcuts", async () => {
    const slot = await renderTriage();
    const filter = slot.getByLabelText("Filter component");
    filter.focus();
    fireEvent.keyDown(filter, { key: "n" });
    expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull();
    const firstRow = slot.container.querySelector<HTMLElement>("[data-finding-row]");
    firstRow?.focus();
    fireEvent.keyDown(window, { key: "x" });
    const button = slot.getByRole("button", { name: /Shortcuts/u });
    button.focus();
    fireEvent.keyDown(button, { key: "b" });
    expect(slot.getByRole("region", { name: /Bulk decision controls/u })).toBeTruthy();
    expect(isShortcutSuppressed(button, "Enter")).toBe(true);
    expect(isShortcutSuppressed(button, "n")).toBe(false);
    const link = document.createElement("a");
    expect(isShortcutSuppressed(link, "Enter")).toBe(true);
    expect(isShortcutSuppressed(link, "n")).toBe(false);
    const notAffected = slot.getByRole("button", { name: /nNOT AFFECTED/u });
    notAffected.focus();
    fireEvent.keyDown(notAffected, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    expect(within(editor).getByText("EXPLOITABLE")).toBeTruthy();
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /Shortcuts/u }));
    const dialog = await slot.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "e" });
    expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull();
  });

  it("selects an index-authoritative range with x then Shift-X", async () => {
    const slot = await renderTriage();
    fireEvent.keyDown(window, { key: "x" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "X", shiftKey: true });
    await waitFor(() => expect(slot.getAllByLabelText("2 findings selected").length).toBeGreaterThan(0));
  });

  it("documents navigation, selection, undo, bulk, and every status in the question-mark sheet", async () => {
    const slot = await renderTriage();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    const dialog = await slot.findByRole("dialog");
    for (const label of ["Next / previous row", "Toggle exact row", "Select range from anchor", "Open bulk decision bar", "Undo last session write", ...Object.values(VEX_SHORTCUTS)]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
  });
});
