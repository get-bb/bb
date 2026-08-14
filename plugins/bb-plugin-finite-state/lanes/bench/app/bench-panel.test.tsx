// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@bb/plugin-sdk/testing/app";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-13T12:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

class BenchPanelResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 900, 600),
          } as ResizeObserverEntry,
        ],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  installTestPluginRuntime();
  vi.stubGlobal("ResizeObserver", BenchPanelResizeObserver);
});
afterEach(() => cleanup());

async function renderBench(
  versions: Array<{
    workspaceProjectId: string;
    platformProjectId: string;
    projectVersionId: string;
    asOf: string;
    state: "fresh" | "stale";
  }>,
  subPath = "",
  benchRunsList = vi.fn(() => ({ items: [], total: 0, next: null, cache })),
) {
  const { BenchPanel } = await import("./bench-panel.js");
  return renderSlot(
    { component: () => <BenchPanel subPath={subPath} /> },
    {},
    {
      context: { projectId: "project-1" },
      sidebarThreads: {
        status: "ready",
        projects: [{ id: "project-1", name: "Project One", isPersonal: false }],
      },
      rpc: {
        benchProjectVersions: () => ({
          versions,
          selectedPlatformProjectId: versions[0]?.platformProjectId ?? null,
          selectedProjectVersionId: versions[0]?.projectVersionId ?? null,
        }),
        benchRunsList,
        benchOtaVerdictGet: () => ({
          pvId: "pv-1",
          firmwareDigest: "a".repeat(64),
          currentMountedDigest: "a".repeat(64),
          verdict: "INCONCLUSIVE",
          stale: false,
          required: 0,
          proven: 0,
          failed: 0,
          gaps: 0,
          evidence: [],
          issues: [
            {
              code: "MODEL_UNAVAILABLE",
              message: "No requirement matrix is cached.",
            },
          ],
          computedAt: "2026-08-13T12:00:00.000Z",
        }),
      },
    },
  );
}

describe("BenchPanel", () => {
  it("explains why Run is disabled when no cached version exists", async () => {
    const slot = await renderBench([]);
    expect(
      (await slot.findAllByText(/No accepted cached version is available/u))
        .length,
    ).toBeGreaterThan(0);
    expect(
      slot.getByRole("button", { name: "Run" }).getAttribute("disabled"),
    ).not.toBeNull();
    expect(
      slot.getByText(/Select a product version to evaluate/u),
    ).toBeTruthy();
  });

  it("selects the accepted cached version and makes the honest verdict card reachable", async () => {
    const benchRunsList = vi.fn(() => ({
      items: [],
      total: 0,
      next: null,
      cache,
    }));
    const slot = await renderBench(
      [
        {
          workspaceProjectId: "project-1",
          platformProjectId: "platform-1",
          projectVersionId: "pv-1",
          asOf: "2026-08-13T12:00:00.000Z",
          state: "fresh",
        },
      ],
      "",
      benchRunsList,
    );
    expect(
      await slot.findByRole("option", { name: "platform-1 / pv-1" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "Run" }).getAttribute("disabled"),
    ).toBeNull();
    expect(
      await slot.findByLabelText("OTA verdict: Inconclusive"),
    ).toBeTruthy();
    expect(slot.getByText(/No requirement matrix is cached/u)).toBeTruthy();
    expect(benchRunsList).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "platform-1",
        projectVersionId: "pv-1",
      }),
    );
  });

  it("clears stale run detail when the selected version changes", async () => {
    const slot = await renderBench(
      [
        {
          workspaceProjectId: "project-1",
          platformProjectId: "platform-1",
          projectVersionId: "pv-1",
          asOf: "2026-08-13T12:00:00.000Z",
          state: "fresh",
        },
        {
          workspaceProjectId: "project-1",
          platformProjectId: "platform-1",
          projectVersionId: "pv-2",
          asOf: "2026-08-13T12:00:00.000Z",
          state: "fresh",
        },
      ],
      "run-from-pv-1",
    );
    fireEvent.change(await slot.findByLabelText("Bench project version"), {
      target: { value: "pv-2" },
    });
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "bench",
      options: { subPath: "", replace: true },
    });
  });
});
