// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const freshCache = {
  state: "fresh" as const,
  asOf: "2026-08-12T20:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

beforeAll(() => installTestPluginRuntime());
afterEach(() => cleanup());

async function detailRegistration() {
  const [card, detail] = await Promise.all([
    import("./component-card.js"),
    import("./component-detail.js"),
  ]);
  return {
    component: () => (
      <card.BomScopeProvider projectId="project-1" projectVersionId="version-1">
        <detail.ComponentDetail id="component-key" onClose={() => undefined} />
      </card.BomScopeProvider>
    ),
  };
}

function componentResult(stale = false) {
  return {
    projectId: "project-1",
    projectVersionId: "version-1",
    kind: "sbomComponent",
    key: "component-key",
    label: "Gateway",
    fields: {
      purl: "pkg:generic/gateway@1",
      version: "1",
      license: "MIT",
      files: ["usr/bin/gateway"],
      findings: [],
    },
    links: [
      { projectId: "project-1", projectVersionId: "version-1", kind: "component", key: "gateway-node", label: "Gateway node" },
      { projectId: "project-1", projectVersionId: "version-1", kind: "threat", key: "THREAT-1", label: "Remote access" },
      { projectId: "project-1", projectVersionId: "version-1", kind: "requirement", key: "REQ-1", label: "Secure boot" },
      { projectId: "project-1", projectVersionId: "version-1", kind: "hbomPart", key: "PART-1", label: "Gateway module" },
    ],
    cache: stale
      ? { ...freshCache, state: "stale" as const, message: "Refresh failed." }
      : freshCache,
  };
}

describe("ComponentDetail", () => {
  it("navigates every projected cross-link to its owning panel", async () => {
    const slot = renderSlot(await detailRegistration(), {}, {
      rpc: {
        bomComponentGet: () => componentResult(),
        firmwareMountsList: () => ({ items: [], total: 0, next: null, cache: freshCache }),
      },
    });
    for (const name of [
      "component · Gateway node",
      "threat · Remote access",
      "requirement · Secure boot",
      "Gateway module",
    ]) fireEvent.click(await slot.findByRole("button", { name }));
    expect(slot.inspection.navigateCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "toPluginPanel", path: "product-security", options: { subPath: "tara/component/gateway-node" } }),
      expect.objectContaining({ method: "toPluginPanel", path: "product-security", options: { subPath: "tara/threat/THREAT-1" } }),
      expect.objectContaining({ method: "toPluginPanel", path: "product-security", options: { subPath: "requirements/REQ-1" } }),
      expect.objectContaining({ method: "toPluginPanel", path: "bom", options: { subPath: "hardware/PART-1" } }),
    ]));
  });

  it("preserves an evidence path and offers materialization when no mount exists", async () => {
    const slot = renderSlot(await detailRegistration(), {}, {
      rpc: {
        bomComponentGet: () => componentResult(),
        firmwareMountsList: () => ({ items: [], total: 0, next: null, cache: freshCache }),
        firmwareMaterializeStart: () => ({
          projectId: "project-1",
          projectVersionId: "version-1",
          jobId: "job-1",
          state: "queued",
          acceptedAt: "2026-08-12T20:00:00.000Z",
        }),
      },
    });
    expect(await slot.findByText("usr/bin/gateway")).toBeTruthy();
    fireEvent.click(await slot.findByRole("button", { name: "Materialize firmware" }));
    await waitFor(() => expect(slot.inspection.rpcCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: "firmwareMaterializeStart",
        input: expect.objectContaining({ firmwarePaths: ["usr/bin/gateway"] }),
      }),
    ])));
  });

  it("renders empty CVE evidence and a stale cache banner", async () => {
    const slot = renderSlot(await detailRegistration(), {}, {
      rpc: {
        bomComponentGet: () => componentResult(true),
        firmwareMountsList: () => ({ items: [], total: 0, next: null, cache: freshCache }),
      },
    });
    expect(await slot.findByText("No joined CVEs in the accepted findings cache.")).toBeTruthy();
    expect(slot.getByText(/Stale cache/u)).toBeTruthy();
  });
});
