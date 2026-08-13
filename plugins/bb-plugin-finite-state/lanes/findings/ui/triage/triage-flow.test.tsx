// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const freshCache = { state: "fresh" as const, asOf: "2026-08-13T00:00:00.000Z", message: null, acceptedGenerationId: "generation-1", baseRevision: 1 };

function finding(index: number) {
  return { projectId: "platform-project-1", projectVersionId: "version-1", kind: "finding", key: `finding-${index}`, label: `Finding ${index}`, fields: { stableKey: `stable-${index}`, cve: `CVE-2026-${index}`, componentName: `component-${index}`, componentVersion: "1", severity: "high", reachabilityVerdict: "unreachable", localState: "none" } };
}

function target(findingId: string) {
  const index = Number(findingId.split("-").at(-1));
  return { findingId, stableKey: `stable-${index}`, cve: `CVE-2026-${index}`, label: `CVE-2026-${index} · component-${index} 1`, component: { purl: null, name: `component-${index}`, group: null, version: "1" }, evidence: "Call graph: no reachable path", reasonSeed: "Call graph: no reachable path", expectedSha256: null, file: null };
}

function success(findingId: string, stableKey: string) {
  return { success: true as const, findingId, stableKey, file: `.fs/triage/${findingId}.yaml`, afterSha256: SHA_B, undo: { file: `.fs/triage/${findingId}.yaml`, beforeSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", afterSha256: SHA_B, prior: null } };
}

class FlowResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element): void { queueMicrotask(() => this.callback([{ target: element, contentRect: new DOMRectReadOnly(0, 0, 1200, 600), borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }], contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }], devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }] }], this)); }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.setConfig({ testTimeout: 15_000 });
  vi.stubGlobal("ResizeObserver", FlowResizeObserver);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000041" });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }));
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number): void { this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0; this.dispatchEvent(new Event("scroll")); };
});

afterEach(() => cleanup());

async function renderFlow(options: {
  write?: (input: Record<string, unknown>) => unknown;
  undo?: () => unknown;
} = {}) {
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
        const record = input as Record<string, unknown>;
        const selection = record["selection"] as { mode?: string; findingIds?: string[] };
        const ids = selection.mode === "predicate" ? ["finding-0", "finding-1", "finding-2"] : selection.findingIds ?? [];
        return { items: ids.map(target), total: ids.length, next: null };
      },
      triageDecisionsWrite: input => {
        const record = input as Record<string, unknown>;
        return options.write?.(record) ?? { results: (record["decisions"] as Array<{ findingId: string; stableKey: string }>).map(item => success(item.findingId, item.stableKey)) };
      },
      triageDecisionUndo: () => options.undo?.() ?? ({ file: ".fs/triage/finding-0.yaml", afterSha256: SHA_A }),
    },
  });
  await waitFor(() => expect(slot.container.querySelectorAll("[data-finding-row]").length).toBeGreaterThan(0));
  return slot;
}

function confirmEditor(editor: HTMLElement, reason = "Reviewed the cached call graph evidence"): void {
  fireEvent.change(within(editor).getByLabelText("Reason"), { target: { value: reason } });
  fireEvent.click(within(editor).getByRole("checkbox"));
}

describe("manual triage flow", () => {
  it("writes one valid decision, announces success, and advances", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage CVE-2026-0/u });
    confirmEditor(editor);
    fireEvent.keyDown(within(editor).getByLabelText("Reason"), { key: "Enter", metaKey: true });
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "triageDecisionsWrite")).toHaveLength(1));
    const write = slot.inspection.rpcCalls.find(call => call.method === "triageDecisionsWrite");
    expect(write?.input).toMatchObject({ decisions: [{ findingId: "finding-0", stableKey: "stable-0", status: "EXPLOITABLE" }] });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-index")).toBe("1"));
    expect(slot.getByText(/EXPLOITABLE written locally/u)).toBeTruthy();
  });

  it("blocks NOT_AFFECTED until a frozen justification is chosen", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "n" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);
    expect(within(editor).getByText("NOT_AFFECTED requires a justification.")).toBeTruthy();
    expect((within(editor).getByRole("button", { name: /Write YAML/u }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("forces CODE_NOT_REACHABLE to exact-version and explains the disabled promotion", async () => {
    const slot = await renderFlow();
    fireEvent.keyDown(window, { key: "n" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    const trigger = within(editor).getByLabelText(/Justification/u);
    fireEvent.click(trigger);
    const option = await slot.findByRole("option", { name: /CODE NOT REACHABLE/u });
    fireEvent.click(option);
    expect((within(editor).getByLabelText("Version pin") as HTMLButtonElement).disabled).toBe(true);
    expect(within(editor).getByText(/promotion is disabled/u)).toBeTruthy();
  });

  it("retains the draft and offers Reload/Compare on CAS conflict", async () => {
    const slot = await renderFlow({ write: input => ({ results: (input.decisions as Array<{ findingId: string; stableKey: string }>).map(item => ({ success: false, findingId: item.findingId, stableKey: item.stableKey, code: "OVERLAY_CAS_CONFLICT", message: "Triage overlay changed concurrently.", retryable: true })) }) });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor, "My carefully reviewed rationale");
    fireEvent.click(within(editor).getByRole("button", { name: /Write YAML/u }));
    expect(await within(editor).findByText("A newer YAML file was preserved")).toBeTruthy();
    expect((within(editor).getByLabelText("Reason") as HTMLTextAreaElement).value).toBe("My carefully reviewed rationale");
    expect(within(editor).getByRole("button", { name: "Reload CAS base" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Compare" })).toBeTruthy();
  });

  it("preserves bulk successes, lists individual failures, and retries only failures", async () => {
    let attempt = 0;
    const slot = await renderFlow({ write: input => {
      attempt += 1;
      const decisions = input.decisions as Array<{ findingId: string; stableKey: string }>;
      return { results: decisions.map((item, index) => attempt === 1 && index === 1 ? { success: false, findingId: item.findingId, stableKey: item.stableKey, code: "OVERLAY_LOCK_HELD", message: "Writer busy", retryable: true } : success(item.findingId, item.stableKey)) };
    } });
    fireEvent.click(slot.getByRole("button", { name: "Select all 3" }));
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.click(slot.getByRole("button", { name: /eEXPLOITABLE/u }));
    const editor = await slot.findByRole("form", { name: /3 selected findings/u });
    fireEvent.change(within(editor).getByLabelText("Reason"), { target: { value: "Reviewed each selected finding locally" } });
    fireEvent.change(within(editor).getByLabelText("Evidence reviewed"), { target: { value: "Reviewed cached evidence for each selected row" } });
    fireEvent.click(within(editor).getByRole("checkbox"));
    fireEvent.click(within(editor).getByRole("button", { name: /Write YAML/u }));
    fireEvent.click(await slot.findByRole("button", { name: "Confirm local writes" }));
    expect(await slot.findByText(/1 decision failed; successful YAML changes were kept/u)).toBeTruthy();
    expect(slot.getByText(/stable-1: Writer busy/u)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method === "triageDecisionsWrite")).toHaveLength(2));
    const retry = slot.inspection.rpcCalls.filter(call => call.method === "triageDecisionsWrite").at(-1);
    expect(retry?.input).toMatchObject({ decisions: [{ findingId: "finding-1" }] });
  });

  it("fails undo closed after an external edit", async () => {
    const slot = await renderFlow({ undo: () => Promise.reject(new Error("Triage overlay changed concurrently")) });
    fireEvent.keyDown(window, { key: "e" });
    const editor = await slot.findByRole("form", { name: /Triage/u });
    confirmEditor(editor);
    fireEvent.click(within(editor).getByRole("button", { name: /Write YAML/u }));
    await waitFor(() => expect(slot.queryByRole("form", { name: /Triage/u })).toBeNull());
    fireEvent.keyDown(window, { key: "u" });
    expect(await slot.findByText(/Undo refused: Triage overlay changed concurrently/u)).toBeTruthy();
  });
});
