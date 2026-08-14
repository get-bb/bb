// @vitest-environment jsdom

import { cleanup, configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  loadPluginApp,
  renderSlot as renderTestSlot,
} from "@bb/plugin-sdk/testing/app";

const renderSlot: typeof renderTestSlot = (registration, props, options) =>
  renderTestSlot(registration, props, {
    context: { projectId: "workspace-project", threadId: null },
    ...options,
  });

const PROJECT = "platform-project";
const VERSION = "version-7";
const PLAN_ID = "01KZX21R4TJ8M92QYZ6A1H7Q8V";
const PLAN_SHA = "a".repeat(64);
const BASE_SHA = "b".repeat(64);
const CONTENT_SHA = "c".repeat(64);
const SCOPE_PATH = "scope/platform-project/version-7";

class PanelResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [
          {
            target,
            contentRect: new DOMRectReadOnly(0, 0, 1200, 640),
            borderBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
            contentBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
            devicePixelContentBoxSize: [{ blockSize: 640, inlineSize: 1200 }],
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
  installTestPluginRuntime();
  vi.stubGlobal("ResizeObserver", PanelResizeObserver);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 640,
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

function cache(state: "fresh" | "stale" | "empty" = "fresh") {
  return {
    state,
    asOf: "2026-08-13T00:00:00.000Z",
    message: state === "stale" ? "Accepted cache is stale" : null,
    acceptedGenerationId: "generation-1",
    baseRevision: 1,
  };
}

function connections(
  platform: "needs-configuration" | "connected" = "connected",
) {
  return {
    platform: {
      state: platform,
      message:
        platform === "needs-configuration"
          ? "Connect Platform before reviewing changes"
          : null,
      checkedAt: null,
    },
    assuranceStudio: { state: "connected", message: null, checkedAt: null },
    forgeCompute: { state: "disabled", message: null, checkedAt: null },
  };
}

function status() {
  return {
    projectId: PROJECT,
    projectVersionId: VERSION,
    acceptedGenerationIds: { vexDecision: "generation-1" },
    stagingGenerationIds: {},
    baseRevisions: { vexDecision: 1 },
    baseStateSha256: BASE_SHA,
    local: [],
    upstream: [],
    conflicts: [],
    orphans: [],
    cache: cache(),
  };
}

function item(
  index: number,
  operation:
    | "create"
    | "update"
    | "delete"
    | "conflict"
    | "orphan"
    | "noop" = "update",
) {
  return {
    projectId: PROJECT,
    projectVersionId: VERSION,
    kind: "vexDecision",
    key: `vex-${index}`,
    label: `VEX decision ${index}`,
    operation,
    expectedBaseContentHash: CONTENT_SHA,
    fields: [
      {
        field: "status",
        base: { present: true, value: "IN_TRIAGE" },
        ours: { present: true, value: "NOT_AFFECTED" },
        theirs: { present: true, value: "EXPLOITABLE" },
      },
    ],
    conflicts:
      operation === "conflict"
        ? [
            {
              field: "status",
              base: { present: true, value: "IN_TRIAGE" },
              ours: { present: true, value: "NOT_AFFECTED" },
              theirs: { present: true, value: "EXPLOITABLE" },
              attribution: null,
              suggestion: "take-ours" as const,
              resolution: null,
            },
          ]
        : [],
    referrers: [],
    error: null,
  };
}

function plan(
  items = [item(1)],
  options: {
    degraded?: boolean;
    cacheState?: "fresh" | "stale" | "empty";
    requiresHumanReview?: boolean;
  } = {},
) {
  const counts = {
    creates: items.filter((entry) => entry.operation === "create").length,
    updates: items.filter((entry) => entry.operation === "update").length,
    deletes: items.filter((entry) => entry.operation === "delete").length,
    conflicts: items.filter((entry) => entry.operation === "conflict").length,
    orphans: items.filter((entry) => entry.operation === "orphan").length,
    noops: items.filter((entry) => entry.operation === "noop").length,
  };
  const changed = items.filter((entry) => entry.operation !== "noop").length;
  return {
    projectId: PROJECT,
    projectVersionId: VERSION,
    planId: PLAN_ID,
    planSha256: PLAN_SHA,
    baseGenerationIds: { vexDecision: "generation-1" },
    baseRevisions: { vexDecision: 1 },
    baseStateSha256: BASE_SHA,
    createdAt: "2026-08-13T00:00:00.000Z",
    staleness: {
      asOf: "2026-08-13T00:00:00.000Z",
      degraded: options.degraded ?? false,
    },
    items,
    summary: counts,
    blastRadius: {
      requiresHumanReview: options.requiresHumanReview ?? false,
      changed,
      deletes: counts.deletes,
      remoteCalls: items.filter(
        (entry) =>
          entry.operation === "create" ||
          entry.operation === "update" ||
          entry.operation === "delete",
      ).length,
      surfaces: changed > 0 ? ["vexDecision"] : [],
    },
    validationErrors: [],
    total: items.length,
    next: null,
    cache: cache(options.cacheState),
  };
}

function inputField(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null
    ? Reflect.get(input, key)
    : undefined;
}

async function syncPanel() {
  const app = await loadPluginApp(() => import("../../../app.js"));
  const panels = app.navPanels.filter((candidate) => candidate.path === "sync");
  if (panels.length !== 1 || !panels[0]) {
    throw new Error("Expected exactly one Sync nav panel");
  }
  return panels[0];
}

async function panelWithCapability() {
  const [panelModule, contract] = await Promise.all([
    import("./SyncReviewPanel.js"),
    import("../../../shared/contract.js"),
  ]);
  const capability = contract.humanApprovalCapabilitySchema.parse(
    "trusted-human-capability-for-tests-only",
  );
  return {
    component: (props: { subPath: string }) => (
      <panelModule.SyncReviewPanel
        humanApprovalCapability={capability}
        subPath={props.subPath}
      />
    ),
  };
}

function handlers(
  planHandler: (input: unknown) => unknown | Promise<unknown> = () => plan(),
  connectionHandler: () => unknown = () => connections(),
) {
  return {
    connectionsStatus: connectionHandler,
    syncAsProjectCandidates: () => ({
      platformProjectId: PROJECT,
      candidateState: "unambiguous" as const,
      selectedAssuranceStudioProjectId: "as-project-default",
      items: [
        {
          linkId: "link-default",
          assuranceStudioProjectId: "as-project-default",
          assuranceStudioProjectName: "Default AS Project",
          platformProjectId: PROJECT,
          platformProjectName: "Platform Project",
          platformProjectVersionId: VERSION,
          platformProjectVersionName: "2.4",
          isPrimary: true,
          syncStatus: "synced",
          lastSyncedAt: "2026-08-14T00:00:00.000Z",
          versionStrategy: "latest",
        },
      ],
    }),
    syncStatus: status,
    syncPlan: planHandler,
  };
}

describe("Sync review panel", () => {
  it("registers one canonical nav panel and rejects an invalid route before RPC", async () => {
    const { parseSyncReviewSubPath } = await import("./SyncReviewPanel.js");
    expect(parseSyncReviewSubPath("scope/qa-project/%40project")).toEqual({
      valid: true,
      route: {
        scope: { projectId: "qa-project", projectVersionId: null },
        surface: "all",
        planId: null,
        runId: null,
      },
    });

    const panel = await syncPanel();
    expect(panel).toMatchObject({
      id: "sync",
      title: "Sync Review",
      path: "sync",
    });

    const slot = renderSlot(panel, { subPath: "scope//bad" }, { rpc: {} });
    expect(slot.getByText("This Sync route is invalid")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual([]);
  });

  it.each([
    "scope/platform-project/%40project",
    "scope/platform-project/%40project/surface/triage",
    "scope/platform-project/%40project/surface/vexDecision",
  ])(
    "renders truthful project-version guidance without status or plan RPCs for %s",
    async (subPath) => {
      const slot = renderSlot(await syncPanel(), { subPath }, { rpc: {} });

      expect(slot.getByText("Choose a project version")).toBeTruthy();
      expect(
        slot.getByText(
          "VEX decisions require a Platform project version. Enter a version ID above and apply the scope to review this surface.",
        ),
      ).toBeTruthy();
      expect(
        slot.getByText(
          "No status or plan request was sent for this project-level route.",
        ),
      ).toBeTruthy();
      expect(
        slot.queryByRole("button", { name: "Retry with fresh plan" }),
      ).toBeNull();
      expect(slot.inspection.rpcCalls).toEqual(
        subPath === "scope/platform-project/%40project"
          ? [
              {
                method: "syncAsProjectCandidates",
                input: {
                  workspaceProjectId: "workspace-project",
                  projectId: "platform-project",
                  projectVersionId: null,
                },
              },
            ]
          : [],
      );
    },
  );

  it("requires an explicit UI choice for an ambiguous AS project set", async () => {
    let selectedId: string | null = null;
    const candidates = ["as-one", "as-two", "as-three", "as-four"].map(
      (id) => ({
        linkId: `link-${id}`,
        assuranceStudioProjectId: id,
        assuranceStudioProjectName: `Project ${id}`,
        platformProjectId: PROJECT,
        platformProjectName: "Platform Project",
        platformProjectVersionId: VERSION,
        platformProjectVersionName: "2.4",
        isPrimary: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-08-14T00:00:00.000Z",
        versionStrategy: "latest",
      }),
    );
    const slot = renderSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/product-security` },
      {
        rpc: {
          ...handlers(() => plan([])),
          syncAsProjectCandidates: () => ({
            platformProjectId: PROJECT,
            candidateState: "ambiguous" as const,
            selectedAssuranceStudioProjectId: selectedId,
            items: candidates,
          }),
          syncAsProjectSelect: (input) => {
            const selected = candidates.find(
              (candidate) =>
                candidate.assuranceStudioProjectId ===
                inputField(input, "assuranceStudioProjectId"),
            );
            if (!selected) throw new Error("candidate missing");
            selectedId = selected.assuranceStudioProjectId;
            return selected;
          },
        },
      },
    );

    await slot.findByText("4 linked projects require an explicit choice.");
    expect(slot.getByText("AS_PROJECT_SELECTION_REQUIRED")).toBeTruthy();
    expect(slot.getByText("No status or plan request was sent.")).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.some(
        (call) => call.method === "syncStatus" || call.method === "syncPlan",
      ),
    ).toBe(false);
    const selector = slot.getByLabelText("Assurance Studio project");
    expect((selector as HTMLSelectElement).value).toBe("");
    fireEvent.change(selector, { target: { value: "as-three" } });
    fireEvent.click(slot.getByRole("button", { name: "Save selection" }));
    await waitFor(() =>
      expect(slot.inspection.rpcCalls).toContainEqual({
        method: "syncAsProjectSelect",
        input: {
          workspaceProjectId: "workspace-project",
          projectId: PROJECT,
          projectVersionId: null,
          assuranceStudioProjectId: "as-three",
        },
      }),
    );
    expect(await slot.findByText("No local changes")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "syncStatus",
      input: {
        workspaceProjectId: "workspace-project",
        projectId: PROJECT,
        projectVersionId: VERSION,
        kinds: ["component", "zone", "dataflow", "asset", "threat"],
      },
    });
  });

  it("runs a default pull while AS is unselected and presents every per-kind outcome", async () => {
    const slot = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: {
          ...handlers(() => plan([])),
          syncAsProjectCandidates: () => ({
            platformProjectId: PROJECT,
            candidateState: "unambiguous" as const,
            selectedAssuranceStudioProjectId: null,
            items: [],
          }),
          syncPull: () => ({
            projectId: PROJECT,
            projectVersionId: VERSION,
            baseStateSha256: BASE_SHA,
            workingFastForwarded: true,
            divergence: [],
            kinds: {
              requirement: {
                status: "failed" as const,
                generationId: null,
                acceptedAt: null,
                fetched: 0,
                baseRows: 0,
                quarantined: 0,
                reasons: [{ code: "AS_PROJECT_SELECTION_REQUIRED", count: 1 }],
              },
              vexDecision: {
                status: "published" as const,
                generationId: "generation-vex",
                acceptedAt: "2026-08-14T20:15:00.000Z",
                fetched: 3,
                baseRows: 3,
                quarantined: 0,
                reasons: [],
              },
            },
          }),
        },
      },
    );

    await slot.findByText("AS_PROJECT_SELECTION_REQUIRED");
    fireEvent.click(slot.getByRole("button", { name: "Pull remote kinds" }));
    await slot.findByText("1 published · 1 failed");
    expect(slot.getByText("vexDecision")).toBeTruthy();
    expect(slot.getByText("requirement")).toBeTruthy();
    expect(slot.getByText("AS_PROJECT_SELECTION_REQUIRED=1")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual({
      method: "syncPull",
      input: {
        workspaceProjectId: "workspace-project",
        projectId: PROJECT,
        projectVersionId: VERSION,
      },
    });
    expect(
      slot.inspection.rpcCalls.some(
        (call) => call.method === "syncStatus" || call.method === "syncPlan",
      ),
    ).toBe(false);
  });

  it("renders WORKSPACE_PROJECT_REQUIRED instead of a silent product-security panel", async () => {
    const slot = renderTestSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/product-security` },
      {
        context: { projectId: null, threadId: null },
        rpc: {},
        sidebarThreads: {
          status: "ready",
          projects: [
            {
              id: "workspace-project",
              name: "Workspace Project",
              isPersonal: false,
            },
          ],
          threads: [],
        },
      },
    );

    expect(slot.getByText("WORKSPACE_PROJECT_REQUIRED")).toBeTruthy();
    expect(
      slot.getByRole("heading", { name: "Select a bb project" }),
    ).toBeTruthy();
    expect(slot.getByText("No status or plan request was sent.")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toEqual([]);
  });

  it.each([
    ["requirement", "requirement"],
    ["threat", "threat"],
    ["hbomPart", "hbomPart"],
  ])(
    "renders adapter-pending guidance without status or plan RPCs for %s",
    async (surface, label) => {
      const slot = renderSlot(
        await syncPanel(),
        { subPath: `${SCOPE_PATH}/surface/${surface}` },
        { rpc: {} },
      );

      expect(
        slot.getByText(`${label} Sync review is not available yet`),
      ).toBeTruthy();
      expect(
        slot.getByText(
          "The plan adapters for this surface have not shipped in this build. Changing remote settings or retrying cannot enable it.",
        ),
      ).toBeTruthy();
      expect(
        slot.queryByRole("button", { name: "Retry with fresh plan" }),
      ).toBeNull();
      expect(slot.inspection.rpcCalls).toEqual(
        surface === "hbomPart"
          ? []
          : [
              {
                method: "syncAsProjectCandidates",
                input: {
                  workspaceProjectId: "workspace-project",
                  projectId: "platform-project",
                  projectVersionId: null,
                },
              },
            ],
      );

      fireEvent.click(
        slot.getByRole("button", { name: "Review available VEX decisions" }),
      );
      expect(slot.inspection.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "sync",
        options: {
          subPath: `${SCOPE_PATH}/surface/vexDecision`,
        },
      });
    },
  );

  it("keeps only registered Sync surfaces loadable", async () => {
    const { isSyncReviewSurfaceAvailable } =
      await import("./SyncReviewPanel.js");

    expect(isSyncReviewSurfaceAvailable("all")).toBe(true);
    expect(isSyncReviewSurfaceAvailable("triage")).toBe(true);
    expect(isSyncReviewSurfaceAvailable("vexDecision")).toBe(true);
    expect(isSyncReviewSurfaceAvailable("product-security")).toBe(true);
    expect(isSyncReviewSurfaceAvailable("component")).toBe(false);
    expect(isSyncReviewSurfaceAvailable("finding")).toBe(false);
  });

  it("loads all pages, preserves group order, and windows a 5k-item group", async () => {
    const allItems = Array.from({ length: 5_000 }, (_, index) => item(index));
    const syncPlan = vi.fn((input: unknown) => {
      const continuation = inputField(input, "continuation");
      if (
        typeof continuation === "string" &&
        inputField(input, "kinds") !== undefined
      ) {
        throw new Error(
          "PLAN_CONTINUATION_INVALID: kinds are bound by the persisted plan token",
        );
      }
      const start =
        typeof continuation === "string"
          ? Number(continuation.replace("page-", ""))
          : 0;
      const pageItems = allItems.slice(start, start + 200);
      const end = start + pageItems.length;
      return {
        ...plan(pageItems),
        summary: plan(allItems).summary,
        blastRadius: plan(allItems).blastRadius,
        total: allItems.length,
        next: end < allItems.length ? `page-${end}` : null,
      };
    });
    const slot = renderSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/vexDecision` },
      { rpc: handlers(syncPlan) },
    );

    await slot.findByText(
      (_content, element) =>
        element?.tagName === "P" &&
        element.textContent === "vexDecision · 5,000 proposed changes",
    );
    const groups = Array.from(
      slot.container.querySelectorAll<HTMLElement>("[data-plan-group]"),
      (element) => element.dataset.planGroup,
    );
    expect(groups).toEqual([
      "create",
      "update",
      "delete",
      "conflict",
      "orphan",
      "noop",
    ]);
    expect(slot.getByText("Windowed list")).toBeTruthy();
    expect(
      slot.container.querySelectorAll("[data-plan-row]").length,
    ).toBeLessThan(80);
    await waitFor(() => expect(syncPlan).toHaveBeenCalledTimes(25));
    expect(syncPlan.mock.calls[0]?.[0]).toMatchObject({
      kinds: ["vexDecision"],
      continuation: null,
    });
    for (const [input] of syncPlan.mock.calls.slice(1)) {
      expect(inputField(input, "kinds")).toBeUndefined();
      expect(inputField(input, "continuation")).toEqual(expect.any(String));
    }
    expect(
      slot
        .getByRole("button", { name: "Push reviewed plan" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      slot.getByText(
        "Human push approval is unavailable in the web panel in v1",
      ),
    ).toBeTruthy();
  });

  it("component-tests loading, empty, error, unconfigured, and stale/offline states", async () => {
    const pending = new Promise(() => undefined);
    const loading = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: handlers(() => pending),
      },
    );
    expect(loading.getByLabelText("Loading Sync review plan")).toBeTruthy();
    loading.lifecycle.unmount();

    const empty = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: handlers(() => plan([])),
      },
    );
    expect(await empty.findByText("No local changes")).toBeTruthy();
    const emptySnapshot = {
      heading: empty.getByText("No local changes").textContent,
      action: empty.getByRole("button", { name: "Refresh plan" }).textContent,
    };
    expect(emptySnapshot).toMatchInlineSnapshot(`
      {
        "action": "Refresh plan",
        "heading": "No local changes",
      }
    `);
    empty.lifecycle.unmount();

    const retryablePlan = vi
      .fn()
      .mockRejectedValueOnce(new Error("plan failed"))
      .mockResolvedValue(plan());
    const failed = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: handlers(retryablePlan),
      },
    );
    expect(
      await failed.findByText("Sync plan could not be loaded"),
    ).toBeTruthy();
    expect({
      code: failed.getByText("SYNC_PLAN_FAILED").textContent,
      detail: failed.getByText("plan failed").textContent,
      heading: failed.getByText("Sync plan could not be loaded").textContent,
      retry: failed.getByRole("button", { name: "Retry with fresh plan" })
        .textContent,
    }).toMatchInlineSnapshot(`
      {
        "code": "SYNC_PLAN_FAILED",
        "detail": "plan failed",
        "heading": "Sync plan could not be loaded",
        "retry": "Retry with fresh plan",
      }
    `);
    fireEvent.click(
      failed.getByRole("button", { name: "Retry with fresh plan" }),
    );
    expect(await failed.findByText("VEX decision 1")).toBeTruthy();
    expect(retryablePlan.mock.calls.length).toBeGreaterThanOrEqual(2);
    failed.lifecycle.unmount();

    const unconfigured = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: handlers(
          () => plan(),
          () => connections("needs-configuration"),
        ),
      },
    );
    expect(
      await unconfigured.findByText("Connect Finite State Platform"),
    ).toBeTruthy();
    expect({
      guidance: unconfigured.getByText(
        "Connect Platform before reviewing changes",
      ).textContent,
      href: unconfigured
        .getByRole("link", { name: "Open connection settings" })
        .getAttribute("href"),
    }).toMatchInlineSnapshot(`
      {
        "guidance": "Connect Platform before reviewing changes",
        "href": "/settings/plugins/finite-state",
      }
    `);
    unconfigured.lifecycle.unmount();

    const stale = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        realtimeConnectionState: "reconnecting",
        rpc: handlers(() =>
          plan([item(1)], { degraded: true, cacheState: "stale" }),
        ),
      },
    );
    expect(await stale.findByText("View-only degraded plan")).toBeTruthy();
    expect(stale.getByText("Offline view")).toBeTruthy();
    expect(
      stale.getByText(
        "Human push approval is unavailable in the web panel in v1",
      ),
    ).toBeTruthy();
  });

  it("surfaces a typed non-retryable plan failure without offering a retry loop", async () => {
    const continuationError = Object.assign(
      new Error(
        "PLAN_CONTINUATION_INVALID: kinds are bound by the persisted plan token",
      ),
      { code: "handler_error" },
    );
    const syncPlan = vi.fn(() => Promise.reject(continuationError));
    const slot = renderSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/vexDecision` },
      { rpc: handlers(syncPlan) },
    );

    expect(await slot.findByText("PLAN_CONTINUATION_INVALID")).toBeTruthy();
    expect(
      slot.getByText(
        "PLAN_CONTINUATION_INVALID: kinds are bound by the persisted plan token",
      ),
    ).toBeTruthy();
    expect(
      slot.getByText(
        "This failure is not retryable from the panel. The request or installed RPC contract must be corrected before review can continue.",
      ),
    ).toBeTruthy();
    expect(
      slot.queryByRole("button", { name: "Retry with fresh plan" }),
    ).toBeNull();
    expect(syncPlan).toHaveBeenCalledTimes(1);
  });

  it("classifies bare and detailed internal plan sentinels as non-retryable", async () => {
    let page = 0;
    const endlessPlan = vi.fn(() => {
      page += 1;
      return {
        ...plan([item(page)]),
        total: 100_000,
        next: `page-${page * 200}`,
      };
    });
    const pageLimit = renderSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/vexDecision` },
      { rpc: handlers(endlessPlan) },
    );

    expect(await pageLimit.findByText("SYNC_PLAN_PAGE_LIMIT")).toBeTruthy();
    expect(
      pageLimit.getByText(
        "SYNC_PLAN_PAGE_LIMIT: plan exceeds 100 pages (20,000 items); narrow the surface filter",
      ),
    ).toBeTruthy();
    expect(
      pageLimit.queryByRole("button", { name: "Retry with fresh plan" }),
    ).toBeNull();
    expect(endlessPlan).toHaveBeenCalledTimes(100);
    pageLimit.lifecycle.unmount();

    let planPage = 0;
    const changingPlan = vi.fn(() => {
      planPage += 1;
      return planPage === 1
        ? { ...plan([item(1)]), next: "page-200" }
        : { ...plan([item(2)]), planSha256: "d".repeat(64) };
    });
    const changedDuringRead = renderSlot(
      await syncPanel(),
      { subPath: `${SCOPE_PATH}/surface/vexDecision` },
      { rpc: handlers(changingPlan) },
    );

    expect(
      await changedDuringRead.findAllByText("SYNC_PLAN_CHANGED_DURING_READ"),
    ).toHaveLength(2);
    expect(
      changedDuringRead.queryByRole("button", {
        name: "Retry with fresh plan",
      }),
    ).toBeNull();
    expect(changingPlan).toHaveBeenCalledTimes(2);
  });

  it("offers a truthful escape from a superseded plan deep link", async () => {
    const slot = renderSlot(
      await syncPanel(),
      {
        subPath: `${SCOPE_PATH}/surface/vexDecision/plan/superseded-plan`,
      },
      { rpc: handlers() },
    );

    expect(await slot.findByText("PLAN_ROUTE_MISMATCH")).toBeTruthy();
    expect(
      slot.getByText(
        "This link names a superseded plan. Open the current plan for this scope to continue.",
      ),
    ).toBeTruthy();
    expect(
      slot.queryByRole("button", { name: "Retry with fresh plan" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Open current plan" }));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "sync",
      options: {
        subPath: `${SCOPE_PATH}/surface/vexDecision`,
        replace: true,
      },
    });
  });

  it("distinguishes connection and status failures from plan failures", async () => {
    const connectionFailure = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: {
          ...handlers(),
          connectionsStatus: () =>
            Promise.reject(new Error("connection lookup failed")),
        },
      },
    );
    expect(
      await connectionFailure.findByText(
        "Connection state could not be loaded",
      ),
    ).toBeTruthy();
    expect(connectionFailure.getByText("SYNC_CONNECTIONS_FAILED")).toBeTruthy();
    connectionFailure.lifecycle.unmount();

    const statusFailure = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: {
          ...handlers(),
          syncStatus: () => Promise.reject(new Error("status lookup failed")),
        },
      },
    );
    expect(
      await statusFailure.findByText("Sync status could not be loaded"),
    ).toBeTruthy();
    expect(statusFailure.getByText("SYNC_STATUS_FAILED")).toBeTruthy();
  });

  it("treats realtime payloads as hints and performs one debounced authoritative refetch", async () => {
    const syncPlan = vi.fn(() => plan());
    const slot = renderSlot(
      await syncPanel(),
      { subPath: SCOPE_PATH },
      {
        rpc: handlers(syncPlan),
      },
    );
    await slot.findByText("VEX decision 1");
    const callsBeforeRealtimeHint = syncPlan.mock.calls.length;

    await slot.behavior.emitRealtime("fs-sync-push", {
      plan: { items: [{ label: "PAYLOAD MUST NOT RENDER" }] },
      completed: 999,
    });
    await slot.behavior.emitRealtime("fs-sync-push", {
      phase: "completed",
    });

    await waitFor(() =>
      expect(syncPlan).toHaveBeenCalledTimes(callsBeforeRealtimeHint + 1),
    );
    expect(slot.queryByText("PAYLOAD MUST NOT RENDER")).toBeNull();
  });

  it("shows suggestion as non-applied and sends the exact field-scoped plan fence", async () => {
    const syncPlan = vi.fn(() => plan([item(1, "conflict")]));
    const syncConflictResolve = vi.fn(() =>
      Promise.reject(new Error("PLAN_FENCE_MISMATCH")),
    );
    const slot = renderSlot(
      await panelWithCapability(),
      { subPath: SCOPE_PATH },
      {
        rpc: {
          ...handlers(syncPlan),
          syncConflictResolve,
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Expand VEX decision 1" }),
    );
    expect(await slot.findByText("Suggestion only: Take ours")).toBeTruthy();
    expect(slot.queryByText("Resolved: ours")).toBeNull();

    const editButton = slot.getByRole("button", { name: "Edit value" });
    editButton.focus();
    fireEvent.click(editButton);
    fireEvent.click(await slot.findByRole("button", { name: "Cancel edit" }));
    await waitFor(() => expect(document.activeElement).toBe(editButton));

    fireEvent.click(slot.getByRole("button", { name: "Take ours" }));

    expect(
      await slot.findByText(/The plan fence changed or this decision/u),
    ).toBeTruthy();
    await waitFor(() =>
      expect(syncConflictResolve).toHaveBeenCalledWith({
        projectId: PROJECT,
        projectVersionId: VERSION,
        planId: PLAN_ID,
        expectedPlanSha256: PLAN_SHA,
        expectedBaseStateSha256: BASE_SHA,
        pageSize: 200,
        continuation: null,
        humanApprovalCapability: "trusted-human-capability-for-tests-only",
        kind: "vexDecision",
        key: "vex-1",
        field: "status",
        expectedBaseContentHash: CONTENT_SHA,
        resolution: { choice: "take-ours" },
      }),
    );
    await waitFor(() =>
      expect(syncPlan.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
  });

  it("renders per-item partial results and retries only retryable failed keys", async () => {
    const report = {
      projectId: PROJECT,
      projectVersionId: VERSION,
      runId: "run-1",
      planId: PLAN_ID,
      planSha256: PLAN_SHA,
      baseGenerationIds: { vexDecision: "generation-1" },
      baseRevisions: { vexDecision: 1 },
      baseStateSha256: BASE_SHA,
      status: "partial" as const,
      summary: { total: 3, applied: 1, failed: 2, skipped: 0 },
      items: [
        {
          projectId: PROJECT,
          projectVersionId: VERSION,
          kind: "vexDecision",
          key: "vex-applied",
          expectedBaseContentHash: CONTENT_SHA,
          status: "applied" as const,
          newBaseContentHash: "d".repeat(64),
          error: null,
        },
        {
          projectId: PROJECT,
          projectVersionId: VERSION,
          kind: "vexDecision",
          key: "vex-retry",
          expectedBaseContentHash: CONTENT_SHA,
          status: "failed" as const,
          newBaseContentHash: null,
          error: {
            code: "REMOTE_TIMEOUT",
            message: "Remote timed out",
            retryable: true,
          },
        },
        {
          projectId: PROJECT,
          projectVersionId: VERSION,
          kind: "vexDecision",
          key: "vex-held",
          expectedBaseContentHash: CONTENT_SHA,
          status: "failed" as const,
          newBaseContentHash: null,
          error: {
            code: "VALIDATION_FAILED",
            message: "Remote rejected the value",
            retryable: false,
          },
        },
      ],
      total: 3,
      next: null,
      requiresPull: false,
      cache: cache(),
    };
    const syncPush = vi.fn(() => report);
    const syncPushRetry = vi.fn(() => ({
      ...report,
      status: "completed" as const,
      summary: { total: 1, applied: 1, failed: 0, skipped: 0 },
      items: [{ ...report.items[1]!, status: "applied" as const, error: null }],
    }));
    const slot = renderSlot(
      await panelWithCapability(),
      { subPath: SCOPE_PATH },
      {
        rpc: {
          ...handlers(),
          syncPush,
          syncPushRetry,
        },
      },
    );

    fireEvent.click(
      await slot.findByRole("button", { name: "Push reviewed plan" }),
    );
    expect(
      await slot.findByText("Push completed with partial results"),
    ).toBeTruthy();
    expect(
      slot.getByText("REMOTE_TIMEOUT: Remote timed out · Retryable"),
    ).toBeTruthy();
    expect(
      slot.getByText(
        "VALIDATION_FAILED: Remote rejected the value · Not retryable",
      ),
    ).toBeTruthy();
    fireEvent.click(
      slot.getByRole("button", { name: "Retry 1 eligible failure" }),
    );

    await waitFor(() => expect(syncPushRetry).toHaveBeenCalledTimes(1));
    expect(syncPushRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        keys: ["vex-retry"],
        planId: PLAN_ID,
        expectedPlanSha256: PLAN_SHA,
        expectedBaseStateSha256: BASE_SHA,
      }),
    );
  });
});
