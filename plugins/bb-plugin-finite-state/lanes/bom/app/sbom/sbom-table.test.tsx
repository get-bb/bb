// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import { connectedRemoteStatus } from "../../../../test/app-connections.js";
import type { JsonValue } from "../../../../shared/contract.js";

const cache = {
  state: "fresh" as const,
  asOf: "2026-08-12T20:00:00.000Z",
  message: null,
  acceptedGenerationId: "generation-1",
  baseRevision: 1,
};

function inputField(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null
    ? Reflect.get(input, key)
    : undefined;
}

function component(index: number) {
  return {
    projectId: "project-1",
    projectVersionId: "version-1",
    kind: "sbomComponent",
    key: `component-key-${index}`,
    label: `Component ${index}`,
    fields: {
      purl: `pkg:generic/component-${index}@1`,
      version: "1.0.0",
      license: index % 2 === 0 ? "MIT" : "GPL-3.0-only",
      source: "sca",
      fileCount: 1,
      files: [`usr/bin/component-${index}`],
      linked: index % 2 === 0,
      localChange: false,
      upstreamStale: false,
      vuln: {
        critical: index === 0 ? 1 : 0,
        high: 0,
        medium: 0,
        low: 0,
        kev: index === 0 ? 1 : 0,
        reachability: index === 0 ? "reachable" : "unknown",
      },
    } satisfies Record<string, JsonValue>,
  };
}

function componentDetail(index: number) {
  const item = component(index);
  return {
    ...item,
    fields: {
      ...item.fields,
      findings:
        index === 0
          ? [
              {
                stableKey: "finding-key-0",
                cve: "CVE-2026-1",
                title: "Issue",
                severity: "critical",
                epss: 0.9,
                kev: true,
                reachability: "reachable",
                vexStatus: "affected",
                localChange: false,
              },
            ]
          : [],
    } satisfies Record<string, JsonValue>,
    links: [],
    cache,
  };
}

class TableResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1200, 600),
            borderBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
            devicePixelContentBoxSize: [{ blockSize: 600, inlineSize: 1200 }],
          },
        ],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  configure({ asyncUtilTimeout: 10_000 });
  vi.stubGlobal("ResizeObserver", TableResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 600,
  });
  HTMLElement.prototype.scrollTo = function scrollTo(
    options?: ScrollToOptions | number,
    y?: number,
  ) {
    this.scrollTop =
      typeof options === "number" ? (y ?? 0) : (options?.top ?? 0);
    this.dispatchEvent(new Event("scroll"));
  };
});

afterEach(() => cleanup());

async function renderBom(
  handler: (input: unknown) => unknown | Promise<unknown>,
  subPath = "software",
  detailHandler: (input: unknown) => unknown | Promise<unknown> = () =>
    Promise.reject(new Error("unused")),
  pullHandler: (input: unknown) => unknown | Promise<unknown> = () =>
    Promise.reject(new Error("unused")),
) {
  const app = await loadPluginApp(() => import("../../../../app.js"));
  const panel = app.navPanels.find((candidate) => candidate.path === "bom");
  if (!panel) throw new Error("BOM panel not registered");
  const slot = renderSlot(
    panel,
    { subPath },
    {
      context: { projectId: "workspace-project-1" },
      sidebarThreads: {
        status: "ready",
        projects: [
          {
            id: "workspace-project-1",
            name: "Project One",
            isPersonal: false,
          },
        ],
      },
      rpc: {
        connectionsStatus: connectedRemoteStatus,
        bomCachedProjectVersions: () => ({
          versions: [
            {
              platformProjectId: "project-1",
              projectVersionId: "version-1",
              asOf: "2026-08-12T20:00:00.000Z",
              state: "fresh",
            },
          ],
          selectedPlatformProjectId: "project-1",
          selectedProjectVersionId: "version-1",
        }),
        bomSoftwareList: handler,
        bomComponentGet: detailHandler,
        syncPull: pullHandler,
        firmwareMountsList: () => ({ items: [], total: 0, next: null, cache }),
      },
    },
  );
  await slot.findByLabelText("Finite State project version");
  return slot;
}

describe("SBOM virtual table", () => {
  it("pulls an empty scoped cache through sync and renders the resulting rows", async () => {
    let pulled = false;
    const emptyCache = {
      ...cache,
      state: "empty" as const,
      asOf: null,
      acceptedGenerationId: null,
      baseRevision: 0,
    };
    const slot = await renderBom(
      () =>
        pulled
          ? { items: [component(0)], total: 1, next: null, cache }
          : { items: [], total: 0, next: null, cache: emptyCache },
      "software",
      undefined,
      () => {
        pulled = true;
        return {
          projectId: "project-1",
          projectVersionId: "version-1",
          generationId: "generation-2",
          acceptedAt: "2026-08-12T21:00:00.000Z",
          baseStateSha256: "a".repeat(64),
          kinds: {
            sbomComponent: { fetched: 0, baseRows: 0, quarantined: 0 },
          },
          workingFastForwarded: true,
          divergence: [],
        };
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: "Pull SBOM" }));
    expect(await slot.findByText("Component 0")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "syncPull",
          input: {
            workspaceProjectId: "workspace-project-1",
            projectId: "project-1",
            projectVersionId: "version-1",
            kinds: ["sbomComponent"],
          },
        }),
      ]),
    );
  });

  it("shows a failed stale-cache pull beside the retained rows", async () => {
    const staleCache = {
      ...cache,
      state: "stale" as const,
      message: "Platform refresh failed (SBOM_REFRESH_FAILED)",
    };
    const slot = await renderBom(
      () => ({
        items: [component(0)],
        total: 1,
        next: null,
        cache: staleCache,
      }),
      "software",
      undefined,
      () =>
        Promise.reject(new Error("Stored SBOM resume state is inconsistent")),
    );
    await slot.findByText("Component 0");
    fireEvent.click(slot.getByRole("button", { name: "Pull again" }));
    expect((await slot.findByRole("alert")).textContent).toContain(
      "Stored SBOM resume state is inconsistent",
    );
    expect(slot.getByText("Component 0")).toBeTruthy();
  });

  it("bounds mounted rows for 10,000 items and expands from the keyboard", async () => {
    const items = Array.from({ length: 10_000 }, (_, index) =>
      component(index),
    );
    const slot = await renderBom(
      () => ({ items, total: 10_000, next: null, cache }),
      "software",
      () => componentDetail(0),
    );
    await slot.findByText("Component 0");
    expect(
      slot.container.querySelectorAll("[data-sbom-row]").length,
    ).toBeLessThan(50);
    const first = slot.getByText("Component 0").closest("[data-sbom-row]");
    if (!(first instanceof HTMLElement)) throw new Error("first row missing");
    expect(first.parentElement?.getAttribute("role")).toBe("presentation");
    expect(first.closest('[role="rowgroup"]')).not.toBeNull();
    expect(first.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "Enter" });
    expect(await slot.findByText("CVE-2026-1")).toBeTruthy();
    expect(
      slot
        .getByRole("button", { name: "Collapse Component 0" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      slot
        .getByText("CVE-2026-1")
        .closest('[role="row"]')
        ?.parentElement?.getAttribute("role"),
    ).toBe("presentation");
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "bomComponentGet",
            input: expect.objectContaining({ componentId: "component-key-0" }),
          }),
        ]),
      ),
    );
  });

  it("restores a shipped view through server filters", async () => {
    const calls: unknown[] = [];
    await renderBom((input) => {
      calls.push(input);
      return { items: [], total: 0, next: null, cache };
    }, "software/view/Copyleft");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const filters = inputField(calls.at(-1), "filters");
    expect(inputField(filters, "license")).toBe("GPL");
  });

  it("fetches a cursor page near the tail and retains selection", async () => {
    let firstPageReads = 0;
    const slot = await renderBom((input) => {
      const continuation = inputField(input, "continuation");
      if (continuation === "page-2") {
        return {
          items: Array.from({ length: 10 }, (_, index) =>
            component(100 + index),
          ),
          total: 110,
          next: null,
          cache,
        };
      }
      firstPageReads += 1;
      return {
        items: Array.from({ length: 100 }, (_, index) => component(index)),
        total: 110,
        next: "page-2",
        cache,
      };
    });
    const selectedLabel = await slot.findByText("Component 0");
    const selected = selectedLabel.closest("[data-sbom-row]");
    if (!(selected instanceof HTMLElement))
      throw new Error("selected row missing");
    fireEvent.click(selected);
    fireEvent.click(slot.getByRole("button", { name: "Load next page" }));
    await slot.findByText("110 loaded of 110");
    expect(firstPageReads).toBe(1);
    expect(
      slot
        .getByText("Component 0")
        .closest("[data-sbom-row]")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("keeps rendered rows usable when the second page fails and retries it", async () => {
    let pageAttempts = 0;
    const slot = await renderBom((input) => {
      if (inputField(input, "continuation") === "page-2") {
        pageAttempts += 1;
        if (pageAttempts === 1) throw new Error("Injected second-page failure");
        return { items: [component(100)], total: 101, next: null, cache };
      }
      return {
        items: Array.from({ length: 100 }, (_, index) => component(index)),
        total: 101,
        next: "page-2",
        cache,
      };
    });
    await slot.findByText("Component 0");
    fireEvent.click(slot.getByRole("button", { name: "Load next page" }));
    await slot.findByText(/Injected second-page failure/u);
    expect(slot.getByText("Component 0")).toBeTruthy();
    fireEvent.click(
      within(slot.container).getByRole("button", { name: "Retry page" }),
    );
    await slot.findByText("101 loaded of 101");
  });
});
