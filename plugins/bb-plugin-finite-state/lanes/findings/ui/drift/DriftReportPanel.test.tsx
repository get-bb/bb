// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import { FINDINGS_DRIFT_CHANGED_CHANNEL } from "../../drift/report.js";

class DriftResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => vi.stubGlobal("ResizeObserver", DriftResizeObserver));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-14T12:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

function driftReport(runId: string) {
  return {
    pvId: "version-1",
    runId,
    createdAt: "2026-08-14T12:00:00.000Z",
    unclassifiedCount: 3,
    totals: {
      reattached_noop: 1,
      reapply: 0,
      stale: 0,
      orphaned: 1,
      conflict: 0,
      needs_completion: 0,
    },
    items: [
      {
        stableKey: "project|component|CVE-2026-147",
        state: "orphaned" as const,
        reason: "Canonical resolver found no match",
      },
    ],
    nextCursor: null as string | null,
  };
}

type TestDriftReport = ReturnType<typeof driftReport>;

function reportItem(runId: string, stableKey: string): TestDriftReport {
  const report = driftReport(runId);
  return { ...report, items: [{ ...report.items[0]!, stableKey }] };
}

function pruneStableKeys(input: unknown): string[] {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Expected prune input");
  }
  const stableKeys = Reflect.get(input, "stableKeys");
  if (
    !Array.isArray(stableKeys) ||
    stableKeys.some((stableKey) => typeof stableKey !== "string")
  ) {
    throw new TypeError("Expected prune stable keys");
  }
  return stableKeys;
}

describe("findings drift panel", () => {
  it("renders freshness metadata, refetches on the pull-complete hint, and confirms prune", async () => {
    const app = await loadPluginApp(() => import("../../../../app.js"));
    const panel = app.navPanels.find(
      (candidate) => candidate.path === "findings",
    );
    if (!panel) throw new Error("Findings panel is not registered");
    let report = driftReport("drift-run-1");
    let reportResponse: TestDriftReport | Promise<TestDriftReport> = report;
    let reportReads = 0;
    const pruneInputs: unknown[] = [];
    let orphanDigest = "a".repeat(64);
    const previewInputs: unknown[] = [];
    const applyInputs: unknown[] = [];
    const documentSha256 = "b".repeat(64);
    const fetchMock = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> =>
        new Response(JSON.stringify({ documentSha256 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const slot = renderSlot(
      panel,
      { subPath: "" },
      {
        context: { projectId: "workspace-1" },
        sidebarThreads: {
          status: "ready",
          projects: [
            { id: "workspace-1", name: "Workspace", isPersonal: false },
          ],
        },
        rpc: {
          connectionsStatus: connectedRemoteStatus,
          cachedProjectVersions: () => ({
            versions: [
              {
                platformProjectId: "platform-1",
                projectVersionId: "version-1",
                asOf: "2026-08-14T12:00:00.000Z",
                state: "fresh" as const,
              },
            ],
            selectedPlatformProjectId: "platform-1",
            selectedProjectVersionId: "version-1",
          }),
          findingsSavedViewsGet: () => ({
            views: [],
            sha256: null,
            recoveredFromCorrupt: false,
          }),
          findingsUiList: () => ({
            items: [],
            total: 0,
            next: null,
            cache,
          }),
          findingsDriftReport: () => {
            reportReads += 1;
            return reportResponse;
          },
          findingsDriftOrphanState: () => ({
            baseStateSha256: orphanDigest,
            total: 1,
          }),
          triageVendorVexPreview: (input) => {
            previewInputs.push(input);
            return {
              projectId: "platform-1",
              projectVersionId: "version-1",
              importId: "vendor-import-1",
              format: "openvex" as const,
              documentSha256,
              items: [],
              total: 0,
              next: null,
              matched: 1,
              unmatched: 0,
              written: 0,
              errors: 0,
              cache,
            };
          },
          triageVendorVexApply: (input) => {
            applyInputs.push(input);
            return {
              projectId: "platform-1",
              projectVersionId: "version-1",
              importId: "vendor-import-1",
              format: "openvex" as const,
              documentSha256,
              items: [],
              total: 0,
              next: null,
              matched: 1,
              unmatched: 0,
              written: 0,
              errors: 0,
              cache,
            };
          },
          triageOrphansPrune: (input) => {
            pruneInputs.push(input);
            const stableKeys = pruneStableKeys(input);
            if (stableKeys.length === 500) {
              orphanDigest = "c".repeat(64);
            }
            return {
              projectId: "platform-1",
              projectVersionId: "version-1",
              runId: "orphan-prune-a",
              total: stableKeys.length,
              applied: stableKeys.length,
              failed: 0,
              results: stableKeys.map((stableKey) => ({
                stableKey,
                success: true,
                error: null,
              })),
            };
          },
        },
      },
    );

    expect(await slot.findByText("drift-run-1")).toBeTruthy();
    expect(slot.getByText(/3 unclassified/u)).toBeTruthy();
    expect(slot.getByText("project|component|CVE-2026-147")).toBeTruthy();
    expect(reportReads).toBe(1);
    expect(slot.getByLabelText("Vendor VEX file")).toBeTruthy();
    expect(
      slot.getByLabelText(/Overwrite existing local decisions/u),
    ).toBeTruthy();

    fireEvent.change(slot.getByLabelText("Vendor name"), {
      target: { value: "Supplier" },
    });
    const vendorFile = new File(
      [
        JSON.stringify({
          "@context": "https://openvex.dev/ns/v0.2.0",
          statements: [],
        }),
      ],
      "supplier.json",
      { type: "" },
    );
    fireEvent.change(slot.getByLabelText("Vendor VEX file"), {
      target: { files: [vendorFile] },
    });
    fireEvent.click(slot.getByRole("button", { name: "Preview import" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const uploadInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(uploadInit?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(new Headers(uploadInit?.headers).get("x-fs-workspace-project")).toBe(
      "workspace-1",
    );
    expect(new Headers(uploadInit?.headers).get("x-fs-platform-project")).toBe(
      "platform-1",
    );
    await waitFor(() => expect(previewInputs).toHaveLength(1));
    fireEvent.click(slot.getByLabelText(/Overwrite existing local decisions/u));
    fireEvent.click(slot.getByRole("button", { name: "Import VEX" }));
    await waitFor(() => expect(applyInputs).toHaveLength(1));
    expect(applyInputs[0]).toMatchObject({
      importId: "vendor-import-1",
      expectedDocumentSha256: documentSha256,
      overwrite: true,
    });

    report = { ...driftReport("drift-run-2"), nextCursor: "cursor-2" };
    reportResponse = report;
    await slot.behavior.emitRealtime(FINDINGS_DRIFT_CHANGED_CHANNEL, {
      pvId: "version-1",
    });
    expect(await slot.findByText("drift-run-2")).toBeTruthy();
    expect(reportReads).toBe(2);

    reportResponse = reportItem(
      "drift-run-3",
      "project|component|CVE-2026-300",
    );
    fireEvent.click(slot.getByRole("button", { name: "Load more drift" }));
    expect(await slot.findByText("drift-run-3")).toBeTruthy();
    expect(slot.queryByText("project|component|CVE-2026-147")).toBeNull();

    reportResponse = {
      ...reportItem("drift-run-3", "project|component|CVE-2026-300"),
      nextCursor: "cursor-3",
    };
    await slot.behavior.emitRealtime(FINDINGS_DRIFT_CHANGED_CHANNEL, {
      pvId: "version-1",
    });
    expect(await slot.findByText("drift-run-3")).toBeTruthy();

    let resolveLatePage: (value: TestDriftReport) => void = () => undefined;
    reportResponse = new Promise<TestDriftReport>((resolve) => {
      resolveLatePage = resolve;
    });
    fireEvent.click(slot.getByRole("button", { name: "Load more drift" }));
    reportResponse = reportItem(
      "drift-run-4",
      "project|component|CVE-2026-400",
    );
    await slot.behavior.emitRealtime(FINDINGS_DRIFT_CHANGED_CHANNEL, {
      pvId: "version-1",
    });
    expect(await slot.findByText("drift-run-4")).toBeTruthy();
    resolveLatePage(
      reportItem("drift-run-3", "project|component|CVE-2026-LATE"),
    );
    await waitFor(() =>
      expect(slot.queryByText("project|component|CVE-2026-LATE")).toBeNull(),
    );

    fireEvent.click(
      slot.getByRole("button", { name: "Preview prune loaded orphans (1)" }),
    );
    expect(
      await slot.findByText(/Remove up to 1 of 1 proven orphaned decisions/u),
    ).toBeTruthy();
    expect(pruneInputs).toHaveLength(0);

    fireEvent.click(slot.getByRole("button", { name: "Confirm prune" }));
    await waitFor(() => expect(pruneInputs).toHaveLength(1));
    expect(pruneInputs[0]).toMatchObject({
      stableKeys: ["project|component|CVE-2026-400"],
      expectedBaseStateSha256: "a".repeat(64),
    });
    expect(pruneInputs[0]).not.toEqual(
      expect.objectContaining({ confirmed: expect.anything() }),
    );
    expect(
      await slot.findByText(
        "Pruned 1 orphaned decisions in 1 explicitly confirmed CAS-guarded chunk(s)",
      ),
    ).toBeTruthy();

    reportResponse = {
      ...driftReport("drift-run-5"),
      totals: { ...driftReport("drift-run-5").totals, orphaned: 501 },
      items: Array.from({ length: 501 }, (_, index) => ({
        stableKey: `bulk-orphan-${index}`,
        state: "orphaned" as const,
        reason: "Canonical resolver found no match",
      })),
    };
    await slot.behavior.emitRealtime(FINDINGS_DRIFT_CHANGED_CHANNEL, {
      pvId: "version-1",
    });
    expect(await slot.findByText("drift-run-5")).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", { name: "Preview prune loaded orphans (501)" }),
    );
    expect(
      await slot.findByText(
        /Remove up to 500 of 501 proven orphaned decisions/u,
      ),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Confirm prune" }));
    await waitFor(() => expect(pruneInputs).toHaveLength(2));
    expect(pruneInputs[1]).toMatchObject({
      stableKeys: expect.arrayContaining(["bulk-orphan-0", "bulk-orphan-499"]),
      expectedBaseStateSha256: "a".repeat(64),
    });
    expect(
      await slot.findByText(/500 of 501 orphaned decisions/u),
    ).toBeTruthy();
    expect(
      slot.getByText(/Remove up to 1 of 501 proven orphaned decisions/u),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Confirm prune" }));
    await waitFor(() => expect(pruneInputs).toHaveLength(3));
    expect(pruneInputs[2]).toMatchObject({
      stableKeys: ["bulk-orphan-500"],
      expectedBaseStateSha256: "c".repeat(64),
    });
  });
});
