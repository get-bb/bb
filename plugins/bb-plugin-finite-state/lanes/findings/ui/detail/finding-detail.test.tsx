// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { findingStableKey } from "../../../../lib/sync/registry.js";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";

const stableKey = findingStableKey({
  cve: "CVE-2026-0039",
  purl: "pkg:generic/gateway@1.0.0",
  name: "gateway",
  version: "1.0.0",
}, "purl");

const freshCache = {
  state: "fresh" as const,
  asOf: "2026-08-13T00:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

function listRow(id = "transient-old") {
  return {
    projectId: "platform-project-1",
    projectVersionId: "version-1",
    kind: "finding",
    key: id,
    label: "Gateway vulnerability",
    fields: {
      stableKey,
      cve: "CVE-2026-0039",
      title: "Gateway vulnerability",
      componentName: "gateway",
      componentVersion: "1.0.0",
      severity: "high",
      reachabilityVerdict: "reachable",
      localState: "none",
    },
  };
}

function detailRow(id: string, location: string) {
  return {
    ...listRow(id),
    fields: {
      ...listRow(id).fields,
      findingType: "vulnerability",
      componentGroup: "edge",
      componentPurl: "pkg:generic/gateway@1.0.0",
      componentSlug: "gateway",
      cvssScore: 8.2,
      cvssVector: "CVSS:3.1/AV:N/AC:L",
      epssScore: 0.42,
      epssPercentile: 0.91,
      inKev: true,
      inVcKev: false,
      hasExploit: true,
      exploitMaturity: "proof-of-concept",
      reachabilityFactors: [
        { label: "Call graph", value: "vulnerable symbol is invoked", source: "firmware analysis" },
        { label: "Binary presence", value: "usr/bin/gateway", source: "mount index" },
      ],
      location: { path: location },
      warningCount: 2,
      violationCount: 1,
      vexStatus: "EXPLOITABLE",
      vexResponse: null,
      vexJustification: null,
      vexReason: "Server review",
      localVexStatus: "NOT_AFFECTED",
      localVexResponse: null,
      localVexJustification: "CODE_NOT_REACHABLE",
      localVexReason: "Local call graph review",
      localState: "conflicted",
      localFile: ".fs/triage/gateway.yaml",
      remediation: "Upgrade gateway to 1.0.1.",
      commentCount: 1,
      pulledAt: freshCache.asOf,
    },
    links: [],
    cache: freshCache,
  };
}

function family(kind: "firmware" | "sbom" | "requirement" | "verification") {
  const target = kind === "firmware" ? "usr/bin/gateway" : kind === "sbom" ? "pkg:generic/gateway@1.0.0" : kind === "requirement" ? "REQ-secure-gateway" : "";
  const ready = kind !== "verification";
  return {
    sourceSlug: "gateway",
    links: [{
      kind,
      sourceSlug: "gateway",
      target,
      label: kind === "firmware" ? "Firmware location" : kind === "sbom" ? "SBOM component" : kind === "requirement" ? "Related requirement" : "Verification results",
      ready,
      ...(ready ? {} : { reason: "unavailable" as const }),
    }],
    readiness: { kind, state: ready ? "ready" as const : "unavailable" as const, ...(ready ? {} : { message: "WP-39 is not shipped" }) },
  };
}

class DetailResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() => this.callback([{ target, contentRect: new DOMRectReadOnly(0, 0, 1200, 600), borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }], contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }], devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }] }], this));
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.setConfig({ testTimeout: 15_000 });
  vi.stubGlobal("ResizeObserver", DetailResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  HTMLElement.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number, y?: number) {
    this.scrollTop = typeof options === "number" ? y ?? 0 : options?.top ?? 0;
    this.dispatchEvent(new Event("scroll"));
  };
});

afterEach(() => cleanup());

async function renderDetail(options: {
  key?: string;
  rows?: ReturnType<typeof detailRow>[];
  history?: () => unknown | Promise<unknown>;
  detail?: () => unknown | Promise<unknown>;
  projectId?: string | null;
} = {}) {
  const rows = options.rows ?? [detailRow("transient-new", "usr/bin/gateway")];
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find(candidate => candidate.path === "findings");
  if (!panel) throw new Error("Findings panel not registered");
  const slot = renderSlot(panel, { subPath: `f/${options.key ?? stableKey}` }, {
    context: { projectId: options.projectId === undefined ? "bb-project-1" : options.projectId },
    sidebarThreads: { status: "ready", projects: options.projectId === null ? [] : [{ id: "bb-project-1", name: "Project One", isPersonal: false }] },
    rpc: {
      connectionsStatus: connectedRemoteStatus,
      cachedProjectVersions: () => ({ versions: [{ platformProjectId: "platform-project-1", projectVersionId: "version-1", asOf: freshCache.asOf, state: "fresh" }], selectedPlatformProjectId: "platform-project-1", selectedProjectVersionId: "version-1" }),
      findingsSavedViewsGet: () => ({ views: [], sha256: null, recoveredFromCorrupt: false }),
      findingsUiList: () => ({ items: [listRow()], total: 1, next: null, cache: freshCache }),
      findingDetailGet: options.detail ?? (() => ({ state: "resolved", tier: 1, rows, cache: freshCache })),
      findingsActivityList: options.history ?? (() => ({ items: [{ projectId: "platform-project-1", projectVersionId: "version-1", kind: "findingActivity", key: "event-1", label: "VEX changed", fields: { actor: "Reviewer", at: freshCache.asOf, source: "Platform", old: { status: "IN_REVIEW" }, new: { status: "EXPLOITABLE" } } }], total: 1, next: null, cache: freshCache })),
      findingActivityRefresh: () => ({ hydrated: 1 }),
      findingsCommentsList: input => ({ items: [{ projectId: "platform-project-1", projectVersionId: "version-1", id: "comment-1", findingId: typeof input === "object" && input !== null && "findingId" in input ? String(input.findingId) : "unknown", actorLabel: "Analyst", text: "Cached comment", createdAt: freshCache.asOf, updatedAt: null, carriesAcrossVersions: false }], total: 1, next: null, cache: freshCache }),
      canvasFirmwareLinks: () => family("firmware"),
      canvasSbomLinks: () => family("sbom"),
      canvasRequirementLinks: () => family("requirement"),
      canvasVerificationLinks: () => family("verification"),
    },
  });
  return { slot, panel };
}

describe("finding detail", () => {
  it("deep link resolves stable identity after UUID change and discloses duplicate rows", async () => {
    const { slot } = await renderDetail({ rows: [detailRow("transient-new", "usr/bin/gateway"), detailRow("transient-peer", "opt/gateway/plugin.so")] });
    expect(await slot.findByText("CVE-2026-0039")).toBeTruthy();
    expect(slot.getByText("transient-new")).toBeTruthy();
    expect(slot.getByText("transient-peer")).toBeTruthy();
    expect(slot.getByText(/2 cached rows resolve to this stable identity/u)).toBeTruthy();
    expect(slot.container.textContent).not.toContain("transient-old");
  });

  it("renders factor evidence and never promotes missing evidence to unreachable", async () => {
    const { slot } = await renderDetail();
    expect(await slot.findByText("vulnerable symbol is invoked")).toBeTruthy();
    expect(slot.getByText(/Source: firmware analysis/u)).toBeTruthy();
    slot.lifecycle.unmount();

    const noFactors = detailRow("transient-new", "usr/bin/gateway");
    noFactors.fields.reachabilityVerdict = "unreachable";
    noFactors.fields.reachabilityFactors = [];
    const missing = await renderDetail({ rows: [noFactors] });
    expect(await missing.slot.findByText(/Unknown — no evidence factors/u)).toBeTruthy();
  });

  it("Escape closes detail and restores the table cursor", async () => {
    const { slot } = await renderDetail();
    await slot.findByText("CVE-2026-0039");
    await waitFor(() => expect(slot.container.querySelector("[data-finding-row]")).toBeTruthy());
    const row = slot.container.querySelector("[data-finding-row]");
    if (!(row instanceof HTMLElement)) throw new Error("finding row missing");
    row.focus();
    const close = slot.getByRole("button", { name: "Close finding detail" });
    close.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(slot.inspection.navigateCalls.at(-1)).toMatchObject({ method: "toPluginPanel", path: "findings" }));
    await waitFor(() => expect(document.activeElement).toBe(row));
  });

  it("navigates every ready link through SDK targets and degrades verification", async () => {
    const { slot } = await renderDetail();
    const section = await slot.findByRole("region", { name: "Connected surfaces" });
    await waitFor(() => expect(slot.inspection.rpcCalls.filter(call => call.method.startsWith("canvas")).map(call => call.method)).toEqual(expect.arrayContaining([
      "canvasFirmwareLinks", "canvasSbomLinks", "canvasRequirementLinks", "canvasVerificationLinks",
    ])));
    await waitFor(() => expect(within(section).queryAllByRole("button", { name: "Open" })).toHaveLength(4));
    const openButtons = within(section).getAllByRole("button", { name: "Open" });
    expect(openButtons).toHaveLength(4);
    for (const button of openButtons) fireEvent.click(button);
    const calls = slot.inspection.navigateCalls.filter(call => call.method === "toPluginPanel");
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "firmware", options: expect.objectContaining({ subPath: "tree/usr%2Fbin%2Fgateway" }) }),
      expect.objectContaining({ path: "bom" }),
      expect.objectContaining({ path: "product-security", options: expect.objectContaining({ subPath: "tara/nodes/gateway" }) }),
      expect.objectContaining({ path: "product-security", options: expect.objectContaining({ subPath: "requirements/trace/REQ-secure-gateway" }) }),
    ]));
    expect(within(section).getByText(/WP-39 ships/u)).toBeTruthy();
    expect((within(section).getByRole("button", { name: "Unavailable" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("rejects an invalid encoded key before detail SQL or remote calls", async () => {
    let detailCalls = 0;
    const { slot } = await renderDetail({ key: "not-a-key", detail: () => { detailCalls += 1; return Promise.reject(new Error("should not run")); } });
    expect(await slot.findByText("Finding not found")).toBeTruthy();
    expect(slot.getByText(/rejected before any cache or remote read/u)).toBeTruthy();
    expect(detailCalls).toBe(0);
  });

  it("history RPC failure preserves identity and decision sections with scoped retry", async () => {
    const { slot } = await renderDetail({ history: () => Promise.reject(new Error("Injected history fault")) });
    expect(await slot.findByText("Injected history fault")).toBeTruthy();
    expect(slot.getByText("Identity & intelligence")).toBeTruthy();
    expect(slot.getByText("Effective VEX decision")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry cached history" })).toBeTruthy();
  });

  it("ambiguous comment create preserves draft and cached comments", async () => {
    const { slot } = await renderDetail({ rows: [detailRow("transient-new", "usr/bin/gateway"), detailRow("transient-peer", "opt/gateway/plugin.so")] });
    fireEvent.click(await slot.findByRole("button", { name: "Use row transient-new" }));
    expect(await slot.findByText("Cached comment")).toBeTruthy();
    const draft = slot.getByLabelText("New finding comment") as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: "Keep this draft" } });
    fireEvent.click(slot.getByRole("button", { name: "Add comment" }));
    expect(await slot.findByText(/authorization-unavailable/u)).toBeTruthy();
    expect(draft.value).toBe("Keep this draft");
    expect(slot.getByText("Cached comment")).toBeTruthy();
    expect(slot.getByText(/refresh before retrying/u)).toBeTruthy();
  });

  it("FindingCard self-fetches validated identity in compact read-only mode", async () => {
    const { FindingCard } = await import("./FindingCard.js");
    const slot = renderSlot({ component: () => <FindingCard compact stableKey={stableKey} /> }, {}, {
      context: { projectId: "bb-project-1" },
      sidebarThreads: { status: "ready", projects: [{ id: "bb-project-1", name: "Project One", isPersonal: false }] },
      rpc: {
        cachedProjectVersions: () => ({ versions: [{ platformProjectId: "platform-project-1", projectVersionId: "version-1", asOf: freshCache.asOf, state: "fresh" }], selectedPlatformProjectId: "platform-project-1", selectedProjectVersionId: "version-1" }),
        findingDetailGet: () => ({ state: "resolved", tier: 1, rows: [detailRow("card-row", "usr/bin/gateway")], cache: freshCache }),
      },
    });
    expect(await slot.findByText("Gateway vulnerability")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual(expect.objectContaining({ method: "findingDetailGet", input: expect.objectContaining({ stableKey }) }));
    expect(slot.queryByLabelText("New finding comment")).toBeNull();
  });

  it("renders loading, empty, stale, and unconfigured detail states", async () => {
    const loading = await renderDetail({ detail: () => new Promise(() => {}) });
    expect(await loading.slot.findByLabelText("Loading finding detail")).toBeTruthy();
    loading.slot.lifecycle.unmount();

    const empty = await renderDetail({ detail: () => ({ state: "orphaned", tier: null, rows: [], cache: freshCache }) });
    expect(await empty.slot.findByText("Finding not found")).toBeTruthy();
    expect(empty.slot.getByRole("button", { name: "Retry" })).toBeTruthy();
    empty.slot.lifecycle.unmount();

    const staleCache = { ...freshCache, state: "stale" as const, message: "Pull failed" };
    const staleRow = { ...detailRow("stale-row", "usr/bin/gateway"), cache: staleCache };
    const stale = await renderDetail({ detail: () => ({ state: "resolved", tier: 1, rows: [staleRow], cache: staleCache }) });
    expect(await stale.slot.findByText(/Showing accepted stale detail/u)).toBeTruthy();
    expect(stale.slot.getByText("Identity & intelligence")).toBeTruthy();
    stale.slot.lifecycle.unmount();

    const unconfigured = await renderDetail({ projectId: null });
    expect((await unconfigured.slot.findAllByText("Choose a findings scope")).length).toBeGreaterThan(0);
  });
});
