// @vitest-environment jsdom

import { HOST_TAILWIND_VERSION } from "@bb/plugin-build/host-tailwind-version";
import type {
  PluginComposerThreadRowStatus,
  PluginContentScriptContext,
  PluginContentScriptRegistration,
} from "@get-bb/plugin-sdk";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  installForeignDomMutationGuard,
  uninstallForeignDomMutationGuardForTest,
} from "./foreign-dom-mutation-guard";
import { definePluginApp } from "./plugin-app-definition";
import {
  applyPluginCss,
  createPluginFrontendReconcileScheduler,
  createPluginFrontendReconcileState,
  disposePluginFrontends,
  fetchFrontendCandidates,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "./plugin-frontend";
import {
  prefetchPluginCss,
  resetPluginCssForTest,
  retainPluginCss,
} from "./plugin-css";
import {
  beginPluginSlotBatch,
  flushPluginSlotChanges,
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  usePluginSlots,
} from "./plugin-slots";
import {
  getPluginThreadRowStatus,
  resetPluginThreadRowStatusesForTest,
} from "./plugin-thread-row-status";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { PLUGIN_PANEL_ROUTE_PATH } from "./route-paths";
import { applyAppThemeCss } from "./themes";
import { PluginPanelView } from "@/views/PluginPanelView";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { appQueryClient } from "./app-query-client";
import { defaultExperiments } from "@bb/domain";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";

function candidate(
  pluginId: string,
  hash: string,
  overrides: Partial<PluginFrontendCandidate["bundle"]> = {},
): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=${hash}`,
      cssUrl: `/api/v1/plugins/${pluginId}/assets/app.css?h=${hash}`,
      jsBytes: 1_000,
      hash,
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      runtimeSlots: [],
      ...overrides,
    },
  };
}

function pluginModule(sectionTitle: string): Record<string, unknown> {
  return {
    default: definePluginApp((app) => {
      app.slots.homepageSection({
        id: "section",
        title: sectionTitle,
        component: () => null,
      });
    }),
  };
}

function versionedSectionModule(url: string): Record<string, unknown> {
  const pluginId = /plugins\/([^/]+)\//.exec(url)?.[1] ?? "unknown";
  const version = /[?&]h=([^&]+)/.exec(url)?.[1] ?? "unknown";
  return {
    default: definePluginApp((app) => {
      app.slots.homepageSection({
        id: "section",
        title: version,
        component: () => createElement("div", null, `${pluginId} ${version}`),
      });
    }),
  };
}

function contentScriptModule(
  ...registrations: PluginContentScriptRegistration[]
): Record<string, unknown> {
  return {
    default: definePluginApp((app) => {
      for (const registration of registrations) {
        app.contentScripts.register(registration);
      }
    }),
  };
}

type ThreadRowStatusSetter =
  PluginContentScriptContext["experimental_setThreadRowStatus"];

function runningStatus(label: string): PluginComposerThreadRowStatus {
  return { icon: "AiContentGenerator01", label, tone: "running" };
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetPluginThreadRowStatusesForTest();
  resetPluginSlotStoreForTest();
  resetPluginCssForTest();
  uninstallForeignDomMutationGuardForTest();
});

function renderIntoBody(element: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

function MountedHomepageSections() {
  const { homepageSections } = usePluginSlots();
  return createElement(
    "div",
    null,
    ...homepageSections.map((section) =>
      createElement(PluginSlotMount, {
        key: `${section.pluginId}/${section.id}/${section.generation}`,
        pluginId: section.pluginId,
        slotKind: "homepageSection",
        slotId: section.id,
        children: createElement(section.component, { projectId: null }),
      }),
    ),
  );
}

function autoLoadPluginStylesheets(): { loaded: string[]; stop: () => void } {
  const loaded: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          !(node instanceof HTMLLinkElement) ||
          (!node.hasAttribute("data-bb-plugin-css") &&
            !node.hasAttribute("data-bb-plugin-css-preload"))
        ) {
          continue;
        }
        queueMicrotask(() => {
          if (!node.isConnected) return;
          loaded.push(node.getAttribute("href") ?? "");
          node.dispatchEvent(new Event("load"));
        });
      }
    }
  });
  observer.observe(document.head, { childList: true });
  const stop = () => observer.disconnect();
  cleanups.push(stop);
  return { loaded, stop };
}

function cssLinks(pluginId: string): HTMLLinkElement[] {
  return [
    ...document.head.querySelectorAll<HTMLLinkElement>(
      `link[data-bb-plugin-css="${pluginId}"]`,
    ),
  ];
}

function cssPreloads(pluginId: string): HTMLLinkElement[] {
  return [
    ...document.head.querySelectorAll<HTMLLinkElement>(
      `link[data-bb-plugin-css-preload="${pluginId}"]`,
    ),
  ];
}

function cssHrefs(pluginId: string): Array<string | null> {
  return cssLinks(pluginId).map((link) => link.getAttribute("href"));
}

function pluginSheet(pluginId: string, version: string): string {
  return `/api/v1/plugins/${pluginId}/assets/app.css?h=${version}&host-tailwind=${HOST_TAILWIND_VERSION}`;
}

function fireLoad(link: Element | null | undefined): void {
  link?.dispatchEvent(new Event("load"));
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function accountPoolListResponse(
  overrides: Parameters<typeof makeInstalledPlugin>[0] = {},
): Response {
  return jsonResponse({
    plugins: [
      makeInstalledPlugin({
        id: "account-pool",
        app: { hasApp: true, bundle: candidate("account-pool", "v1").bundle },
        ...overrides,
      }),
    ],
  });
}

interface TestReconcileDeps extends PluginFrontendReconcileDeps {
  fetchCandidates: Mock<() => Promise<PluginFrontendCandidate[]>>;
  importModule: Mock<(url: string) => Promise<unknown>>;
  removeRegistrations: Mock<typeof removePluginSlotRegistrations>;
  setRegistrations: Mock<typeof setPluginSlotRegistrations>;
}

function makeDeps(initial: PluginFrontendCandidate[] = []): TestReconcileDeps {
  return {
    fetchCandidates: vi.fn(
      async (): Promise<PluginFrontendCandidate[]> => initial,
    ),
    importModule: vi.fn(
      async (_url: string): Promise<unknown> => pluginModule("hello"),
    ),
    importRetryDelaysMs: [],
    applyCss: vi.fn(),
    prefetchCss: vi.fn(),
    prefetchModule: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: vi.fn(),
    removeRegistrations: vi.fn(),
    beginSlotBatch: () => () => {},
    flushSlotBatch: vi.fn(),
    warn: vi.fn(),
    priorityPluginIds: () => [],
  };
}

interface ReconcileHarnessOptions {
  realCss?: boolean;
  realSlots?: boolean;
}

function reconcileHarness(
  initial: PluginFrontendCandidate[],
  options: ReconcileHarnessOptions = {},
) {
  const state = createPluginFrontendReconcileState();
  const deps = makeDeps(initial);
  if (options.realCss) {
    deps.applyCss = applyPluginCss;
    deps.retainCss = retainPluginCss;
  }
  if (options.realSlots) {
    deps.setRegistrations = vi.fn(setPluginSlotRegistrations);
    deps.removeRegistrations = vi.fn(removePluginSlotRegistrations);
  }
  const reconcile = (next?: PluginFrontendCandidate[]): Promise<void> => {
    if (next) deps.fetchCandidates.mockResolvedValue(next);
    return reconcilePluginFrontends(state, deps);
  };
  return { state, deps, reconcile };
}

async function loadHelloThenFetchInventory(
  fetchInventory: () => Promise<Response>,
) {
  const harness = reconcileHarness([candidate("hello", "v1")]);
  await harness.reconcile();
  harness.deps.removeRegistrations.mockClear();
  vi.mocked(harness.deps.applyCss).mockClear();
  const queryClient = newQueryClient();
  vi.stubGlobal("fetch", vi.fn(fetchInventory));
  harness.deps.fetchCandidates = vi.fn(() =>
    fetchFrontendCandidates(queryClient),
  );
  return harness;
}

function renderReactOwnedLink(testId: string) {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  installForeignDomMutationGuard();
  const container = renderIntoBody(
    createElement(
      "a",
      { href: "?path=src/app.ts", "data-testid": testId },
      "src/app.ts",
    ),
  );
  const link = container.querySelector(`[data-testid='${testId}']`);
  expect(link).toBeInstanceOf(HTMLAnchorElement);
  return { container, link, reactParent: link?.parentNode };
}

function wrapLinkInButtonGroup(testId: string): void {
  const control = document.querySelector(`[data-testid='${testId}']`);
  if (!(control instanceof HTMLElement) || control.parentNode === null) {
    return;
  }
  const group = document.createElement("span");
  const button = document.createElement("button");
  control.parentNode.insertBefore(group, control);
  group.append(control, button);
}

describe("reconcilePluginFrontends", () => {
  it.each(["running", "needs-configuration", "degraded"] as const)(
    "loads frontend candidates for a plugin with %s status",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => accountPoolListResponse({ status })),
      );

      await expect(fetchFrontendCandidates(newQueryClient())).resolves.toEqual([
        candidate("account-pool", "v1"),
      ]);
    },
  );

  it.each([
    {
      cancelledBy: "its last observer unmounting",
      start: (queryClient: QueryClient) => {
        const observer = new QueryObserver(
          queryClient,
          pluginListQueryOptions({ enabled: true }),
        );
        const unsubscribe = observer.subscribe(() => {});
        return () => unsubscribe();
      },
    },
    {
      cancelledBy: "cancelQueries",
      start: (queryClient: QueryClient) => () =>
        void queryClient.cancelQueries(),
    },
  ])(
    "fetches frontend candidates again when the shared plugin list fetch is cancelled by $cancelledBy",
    async ({ start }) => {
      const queryClient = newQueryClient();
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            if (fetchMock.mock.calls.length === 1) {
              init?.signal?.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError")),
              );
              return;
            }
            resolve(accountPoolListResponse());
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const cancel = start(queryClient);
      const candidates = fetchFrontendCandidates(queryClient);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      cancel();

      await expect(candidates).resolves.toEqual([
        candidate("account-pool", "v1"),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("re-imports a plugin exactly once when its bundle hash changes, replacing registrations wholesale", async () => {
    const other = candidate("other", "s1", { cssUrl: null });
    const { deps, reconcile } = reconcileHarness([
      candidate("hello", "aaa"),
      other,
    ]);

    await reconcile();
    expect(deps.importModule).toHaveBeenCalledTimes(2);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(2);

    deps.importModule.mockClear();
    deps.setRegistrations.mockClear();
    await reconcile();
    expect(deps.importModule).not.toHaveBeenCalled();
    expect(deps.setRegistrations).not.toHaveBeenCalled();

    await reconcile([candidate("hello", "bbb"), other]);
    expect(deps.importModule).toHaveBeenCalledTimes(1);
    expect(deps.importModule).toHaveBeenCalledWith(
      "/api/v1/plugins/hello/assets/app.js?h=bbb",
    );
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        homepageSections: [expect.objectContaining({ id: "section" })],
      }),
    );
    expect(deps.resetCrashedSlots).toHaveBeenCalledWith("hello");
    expect(deps.applyCss).toHaveBeenCalledWith(
      "hello",
      "/api/v1/plugins/hello/assets/app.css?h=bbb",
    );
  });

  it("waits for the stylesheet before publishing registrations", async () => {
    const { deps, reconcile } = reconcileHarness([candidate("hello", "aaa")]);
    const cssGate: { release: (() => void) | null } = { release: null };
    vi.mocked(deps.applyCss).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          cssGate.release = resolve;
        }),
    );

    const done = reconcile();
    for (let tick = 0; tick < 20; tick++) await Promise.resolve();
    expect(deps.applyCss).toHaveBeenCalledWith(
      "hello",
      "/api/v1/plugins/hello/assets/app.css?h=aaa",
    );
    expect(deps.setRegistrations).not.toHaveBeenCalled();

    cssGate.release?.();
    await done;
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.anything(),
    );
  });

  it("reloading twice leaves exactly one homepage section registered (design §9 exit criterion)", async () => {
    const { reconcile } = reconcileHarness([candidate("hello", "v1")], {
      realSlots: true,
    });

    await reconcile();
    await reconcile([candidate("hello", "v2")]);
    await reconcile([candidate("hello", "v3")]);

    const snapshot = getPluginSlotSnapshot();
    expect(snapshot.homepageSections).toHaveLength(1);
    expect(snapshot.homepageSections[0]).toMatchObject({
      pluginId: "hello",
      id: "section",
      generation: 3,
    });
  });

  it("loads CSS before a cold deep-link panel registration can render", async () => {
    const stylesheets = autoLoadPluginStylesheets();
    const loadedDuringRender = vi.fn();
    const { deps, reconcile } = reconcileHarness([candidate("hello", "cold")], {
      realCss: true,
      realSlots: true,
    });
    deps.importModule.mockResolvedValue({
      default: definePluginApp((app) => {
        app.slots.navPanel({
          id: "panel",
          icon: "PanelTop",
          path: "panel",
          title: "Cold panel",
          component: ({ subPath }) => {
            loadedDuringRender([...stylesheets.loaded]);
            return createElement("div", null, `cold panel body:${subPath}`);
          },
        });
      }),
    });
    const container = renderIntoBody(
      createElement(
        MemoryRouter,
        { initialEntries: ["/plugins/hello/panel/notes/today.md"] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: PLUGIN_PANEL_ROUTE_PATH,
            element: createElement(PluginPanelView, {
              pluginId: "hello",
              panelPath: "panel",
              subPath: "notes/today.md",
            }),
          }),
        ),
      ),
    );

    await act(async () => {
      await reconcile();
    });

    expect(loadedDuringRender).toHaveBeenCalledWith([
      pluginSheet("hello", "cold"),
    ]);
    expect(container.textContent).toContain("cold panel body:notes/today.md");
    expect(cssLinks("hello")).not.toHaveLength(0);
  });

  it("retains CSS for a content script's whole generation, including cleanup", async () => {
    autoLoadPluginStylesheets();
    const { deps, reconcile } = reconcileHarness(
      [candidate("shell-owner", "v1")],
      { realCss: true },
    );
    const events: string[] = [];
    const stylesheetIsActive = () => cssLinks("shell-owner").length > 0;
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "shell-dom",
        mount() {
          events.push(`mount:${stylesheetIsActive()}`);
          return () => {
            events.push(`dispose:${stylesheetIsActive()}`);
          };
        },
      }),
    );

    await reconcile();
    expect(events).toEqual(["mount:true"]);
    expect(stylesheetIsActive()).toBe(true);

    await reconcile([]);
    expect(events).toEqual(["mount:true", "dispose:true"]);
    expect(stylesheetIsActive()).toBe(false);
  });

  it("keeps the previous generation and its sheet on screen until the replacement stylesheet settles", async () => {
    const { deps, reconcile } = reconcileHarness([candidate("hello", "v1")], {
      realCss: true,
      realSlots: true,
    });
    deps.importModule.mockImplementation(async (url) =>
      versionedSectionModule(url),
    );
    const sheet = (version: string) => pluginSheet("hello", version);
    const container = renderIntoBody(createElement(MountedHomepageSections));

    const bootV1 = reconcile();
    await flushAsyncWork();
    expect(deps.setRegistrations).not.toHaveBeenCalled();
    fireLoad(cssPreloads("hello")[0]);
    await act(async () => {
      await bootV1;
    });
    expect(container.textContent).toContain("hello v1");
    fireLoad(cssLinks("hello")[0]);

    const reloadV2 = reconcile([candidate("hello", "v2")]);
    await flushAsyncWork();
    expect(cssHrefs("hello")).toEqual([sheet("v1"), sheet("v2")]);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("hello v1");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cssLinks("hello")[1]?.dispatchEvent(new Event("error"));
    await act(async () => {
      await reloadV2;
    });
    warn.mockRestore();
    expect(container.textContent).toContain("hello v2");
    expect(cssHrefs("hello")).toEqual([sheet("v1"), sheet("v2")]);

    const reloadV3 = reconcile([candidate("hello", "v3")]);
    await flushAsyncWork();
    expect(cssHrefs("hello")).toEqual([sheet("v1"), sheet("v3")]);
    expect(container.textContent).toContain("hello v2");
    fireLoad(cssLinks("hello")[1]);
    await act(async () => {
      await reloadV3;
    });
    expect(cssHrefs("hello")).toEqual([sheet("v3")]);
    expect(container.textContent).toContain("hello v3");
  });

  it("publishes the replacement anyway when its stylesheet never settles within the timeout", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    deps.cssReadyTimeoutMs = 20;
    vi.mocked(deps.applyCss).mockImplementation(
      () => new Promise<void>(() => {}),
    );

    await reconcile();
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.anything(),
    );
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("did not load within 20ms"),
    );
    expect(state.diagnostics.get("hello")).toMatchObject({ status: "active" });
  });

  it("swaps the sheet later when a timed-out replacement stylesheet finally loads", async () => {
    const stylesheets = autoLoadPluginStylesheets();
    const { deps, reconcile } = reconcileHarness([candidate("hello", "v1")], {
      realCss: true,
      realSlots: true,
    });
    deps.cssReadyTimeoutMs = 20;
    deps.importModule.mockImplementation(async (url) =>
      versionedSectionModule(url),
    );
    const container = renderIntoBody(createElement(MountedHomepageSections));
    await act(async () => {
      await reconcile();
    });
    expect(container.textContent).toContain("hello v1");
    stylesheets.stop();

    await act(async () => {
      await reconcile([candidate("hello", "v2")]);
    });
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("did not load within 20ms"),
    );
    expect(container.textContent).toContain("hello v2");
    expect(cssHrefs("hello")).toEqual([
      pluginSheet("hello", "v1"),
      pluginSheet("hello", "v2"),
    ]);

    fireLoad(
      document.head.querySelector(
        'link[data-bb-plugin-css="hello"][href*="h=v2"]',
      ),
    );
    expect(cssHrefs("hello")).toEqual([pluginSheet("hello", "v2")]);
  });

  it("publishes a replacement the moment its sheet loads while another plugin's sheet is still pending in the slot batch", async () => {
    const { deps, reconcile } = reconcileHarness(
      [candidate("alpha", "v1"), candidate("beta", "v1")],
      { realCss: true, realSlots: true },
    );
    deps.beginSlotBatch = () => beginPluginSlotBatch({ maxHoldMs: 150 });
    deps.flushSlotBatch = flushPluginSlotChanges;
    deps.importModule.mockImplementation(async (url) =>
      versionedSectionModule(url),
    );
    const container = renderIntoBody(createElement(MountedHomepageSections));

    const boot = reconcile();
    await flushAsyncWork();
    for (const preload of document.head.querySelectorAll(
      "link[data-bb-plugin-css-preload]",
    )) {
      fireLoad(preload);
    }
    await act(async () => {
      await boot;
    });
    expect(container.textContent).toContain("alpha v1");
    expect(container.textContent).toContain("beta v1");
    fireLoad(cssLinks("alpha")[0]);
    fireLoad(cssLinks("beta")[0]);

    const reload = reconcile([
      candidate("alpha", "v2"),
      candidate("beta", "v2"),
    ]);
    await flushAsyncWork();
    expect(cssHrefs("alpha")).toEqual([
      pluginSheet("alpha", "v1"),
      pluginSheet("alpha", "v2"),
    ]);
    expect(cssHrefs("beta")).toEqual([
      pluginSheet("beta", "v1"),
      pluginSheet("beta", "v2"),
    ]);

    await act(async () => {
      fireLoad(cssLinks("alpha")[1]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cssHrefs("alpha")).toEqual([pluginSheet("alpha", "v2")]);
    expect(container.textContent).toContain("alpha v2");
    expect(container.textContent).toContain("beta v1");

    await act(async () => {
      fireLoad(cssLinks("beta")[1]);
      await reload;
    });
    expect(container.textContent).toContain("beta v2");
    expect(cssHrefs("beta")).toEqual([pluginSheet("beta", "v2")]);
  });

  it("drops registrations, CSS, and record when a plugin disappears from the inventory", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    await reconcile();
    expect(state.records.get("hello")?.status).toBe("loaded");

    await reconcile([]);
    expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
    expect(state.records.has("hello")).toBe(false);
    expect(state.appliedHashes.has("hello")).toBe(false);
  });

  it.each([401, 403])(
    "removes active frontends when plugin inventory access fails with %s",
    async (status) => {
      const { state, deps, reconcile } = await loadHelloThenFetchInventory(
        async () =>
          jsonResponse(
            { code: "unauthorized", message: "Unauthorized" },
            status,
          ),
      );

      await reconcile();

      expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
      expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
      expect(state.records.has("hello")).toBe(false);
      expect(state.appliedHashes.has("hello")).toBe(false);
    },
  );

  it("preserves active frontends when the plugin inventory request fails", async () => {
    const { state, deps, reconcile } = await loadHelloThenFetchInventory(
      async () => {
        throw new TypeError("offline");
      },
    );

    await expect(reconcile()).rejects.toThrow("offline");
    expect(state.records.get("hello")?.status).toBe("loaded");
    expect(state.appliedHashes.get("hello")).toBe("v1");
    expect(deps.removeRegistrations).not.toHaveBeenCalled();
    expect(deps.applyCss).not.toHaveBeenCalled();
  });

  it("deactivates stale UI when a replacement import fails or needs an SDK update", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    await reconcile();

    deps.importModule.mockRejectedValueOnce(new Error("SyntaxError"));
    await reconcile([candidate("hello", "v2")]);
    expect(state.records.get("hello")).toMatchObject({ status: "failed" });
    expect(deps.removeRegistrations).toHaveBeenCalledWith("hello");
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
    expect(state.appliedHashes.has("hello")).toBe(false);
    expect(state.diagnostics.get("hello")).toMatchObject({
      status: "failed",
      active: null,
      lastFailure: { phase: "load" },
    });

    deps.removeRegistrations.mockClear();
    await reconcile([
      candidate("hello", "v3", { compatible: false, sdkMajor: 9 }),
    ]);
    expect(state.records.get("hello")).toMatchObject({
      status: "needs-update",
    });
    expect(deps.removeRegistrations).not.toHaveBeenCalled();
    expect(state.appliedHashes.has("hello")).toBe(false);
  });

  it("uses a fresh module URL when retrying a failed unchanged bundle", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    deps.importModule.mockRejectedValueOnce(new Error("blocked by client"));

    await reconcile();
    await reconcile();
    await reconcile();

    expect(deps.importModule).toHaveBeenCalledTimes(2);
    expect(deps.importModule).toHaveBeenNthCalledWith(
      1,
      "/api/v1/plugins/hello/assets/app.js?h=v1",
    );
    expect(deps.importModule).toHaveBeenNthCalledWith(
      2,
      "/api/v1/plugins/hello/assets/app.js?h=v1&bb_retry=1",
    );
    expect(state.records.get("hello")?.status).toBe("loaded");
  });

  it("retries a failed import with a fresh module URL within the same reconcile", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    deps.importRetryDelaysMs = [0, 0];
    const networkError = new TypeError(
      "Failed to fetch dynamically imported module",
    );
    deps.importModule
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError);

    await reconcile();

    expect(deps.importModule.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/plugins/hello/assets/app.js?h=v1",
      "/api/v1/plugins/hello/assets/app.js?h=v1&bb_retry=1",
      "/api/v1/plugins/hello/assets/app.js?h=v1&bb_retry=2",
    ]);
    expect(state.records.get("hello")?.status).toBe("loaded");
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.anything(),
    );
  });

  it("mounts once, skips repeated reconciliation, and disposes exactly once on reload and removal", async () => {
    const { deps, reconcile } = reconcileHarness([candidate("hello", "v1")]);
    const events: string[] = [];
    deps.importModule.mockImplementation(async (url: string) => {
      const version = url.includes("h=v2") ? "v2" : "v1";
      return contentScriptModule({
        id: "enhance",
        mount({ pluginId, generation, signal }) {
          events.push(`${version}:mount:${pluginId}:${generation}`);
          signal.addEventListener(
            "abort",
            () => events.push(`${version}:abort`),
            { once: true },
          );
          return () => {
            events.push(`${version}:dispose`);
          };
        },
      });
    });

    await reconcile();
    await reconcile();
    expect(events).toEqual(["v1:mount:hello:1"]);

    await reconcile([candidate("hello", "v2")]);
    const reloaded = [
      "v1:mount:hello:1",
      "v1:abort",
      "v1:dispose",
      "v2:mount:hello:2",
    ];
    expect(events).toEqual(reloaded);

    await reconcile([]);
    await reconcile();
    expect(events).toEqual([...reloaded, "v2:abort", "v2:dispose"]);
  });

  it("keeps content-script thread statuses across routes and clears them on deactivation", async () => {
    const { deps, reconcile } = reconcileHarness([
      candidate("prompt-shaper", "v1"),
    ]);
    const status = runningStatus("Improve Prompt is improving the draft");
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "thread-status",
        mount({ experimental_setThreadRowStatus }) {
          experimental_setThreadRowStatus?.("thr_source", status);
        },
      }),
    );

    await reconcile();
    expect(getPluginThreadRowStatus("thr_source")).toEqual({
      icon: "AiContentGenerator01",
      label: "Improve Prompt is improving the draft",
      tone: "running",
    });

    await reconcile([]);
    expect(getPluginThreadRowStatus("thr_source")).toBeNull();
  });

  it("rolls back a status from a partially mounted generation and rejects its retained setter", async () => {
    const { deps, reconcile } = reconcileHarness([
      candidate("prompt-shaper", "v1"),
    ]);
    let retainedSetter: ThreadRowStatusSetter;
    deps.importModule.mockResolvedValue(
      contentScriptModule(
        {
          id: "thread-status",
          mount({ experimental_setThreadRowStatus }) {
            retainedSetter = experimental_setThreadRowStatus;
            retainedSetter?.("thr_source", runningStatus("Partial generation"));
          },
        },
        {
          id: "broken",
          mount() {
            throw new Error("later mount failed");
          },
        },
      ),
    );

    await reconcile();
    expect(getPluginThreadRowStatus("thr_source")).toBeNull();

    retainedSetter?.("thr_source", runningStatus("Stale callback"));
    expect(getPluginThreadRowStatus("thr_source")).toBeNull();
  });

  it("does not let a retained old-generation setter overwrite its replacement", async () => {
    const { deps, reconcile } = reconcileHarness([
      candidate("prompt-shaper", "v1"),
    ]);
    let oldSetter: ThreadRowStatusSetter;
    deps.importModule.mockImplementation(async (url: string) =>
      contentScriptModule({
        id: "thread-status",
        mount({ experimental_setThreadRowStatus }) {
          if (url.includes("h=v1")) {
            oldSetter = experimental_setThreadRowStatus;
          }
          experimental_setThreadRowStatus?.(
            "thr_source",
            runningStatus(
              url.includes("h=v1")
                ? "Old generation"
                : "Replacement generation",
            ),
          );
        },
      }),
    );

    await reconcile();
    await reconcile([candidate("prompt-shaper", "v2")]);
    expect(getPluginThreadRowStatus("thr_source")?.label).toBe(
      "Replacement generation",
    );

    oldSetter?.("thr_source", runningStatus("Late old generation"));
    expect(getPluginThreadRowStatus("thr_source")?.label).toBe(
      "Replacement generation",
    );
  });

  it("warns and ignores non-string and blank content-script thread ids", async () => {
    const { deps, reconcile } = reconcileHarness([
      candidate("prompt-shaper", "v1"),
    ]);
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "thread-status",
        mount({ experimental_setThreadRowStatus }) {
          const setStatus = experimental_setThreadRowStatus as
            | ((threadId: unknown, status: unknown) => void)
            | undefined;
          setStatus?.(42, {
            icon: "AiContentGenerator01",
            label: "Invalid number id",
          });
          setStatus?.("   ", {
            icon: "AiContentGenerator01",
            label: "Invalid blank id",
          });
        },
      }),
    );

    await expect(reconcile()).resolves.toBeUndefined();
    expect(getPluginThreadRowStatus("42")).toBeNull();
    expect(deps.warn).toHaveBeenCalledTimes(2);
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining('"threadId" must be a non-empty string'),
    );
  });

  it("disposes the old generation and rolls back a failed multi-script candidate in reverse order", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    const events: string[] = [];
    let oldSignal: AbortSignal | undefined;
    const tracked = (id: string): PluginContentScriptRegistration => ({
      id,
      mount() {
        events.push(`${id}:mount`);
        return () => {
          events.push(`${id}:dispose`);
        };
      },
    });
    deps.importModule.mockResolvedValueOnce(
      contentScriptModule({
        id: "old",
        mount(context) {
          oldSignal = context.signal;
          return tracked("old").mount(context);
        },
      }),
    );
    await reconcile();

    deps.importModule.mockResolvedValueOnce(
      contentScriptModule(
        tracked("first"),
        tracked("second"),
        {
          id: "broken",
          mount() {
            events.push("broken:mount");
            throw new Error("candidate exploded");
          },
        },
        {
          id: "never",
          mount() {
            events.push("never:mount");
          },
        },
      ),
    );
    await reconcile([candidate("hello", "v2")]);

    expect(events).toEqual([
      "old:mount",
      "old:dispose",
      "first:mount",
      "second:mount",
      "broken:mount",
      "second:dispose",
      "first:dispose",
    ]);
    expect(oldSignal?.aborted).toBe(true);
    expect(deps.setRegistrations).toHaveBeenCalledTimes(1);
    expect(state.appliedHashes.has("hello")).toBe(false);
    expect(state.diagnostics.get("hello")).toMatchObject({
      status: "failed",
      active: null,
      lastFailure: {
        phase: "mount",
        scriptId: "broken",
        message: "candidate exploded",
      },
    });
  });

  it("activates a plugin that still passes experimental_sidebarAccessory and warns about it", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    function Panel() {
      return null;
    }
    deps.importModule.mockResolvedValueOnce({
      default: definePluginApp((app) => {
        app.slots.navPanel({
          id: "board",
          title: "Board",
          icon: "Columns",
          path: "board",
          component: Panel,
          experimental_sidebarAccessory: Panel,
        } as never);
      }),
    });

    await reconcile();

    expect(state.appliedHashes.has("hello")).toBe(true);
    expect(state.diagnostics.get("hello")?.lastFailure).toBeNull();
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        navPanels: [expect.objectContaining({ id: "board" })],
      }),
    );
    expect(deps.warn).toHaveBeenCalledWith(
      '[plugin:hello] slots.navPanel: "experimental_sidebarAccessory" is ignored: it was replaced by "experimental_useBadge", a hook returning a badge value, in SDK 0.6.53',
    );
  });

  it("contains a throwing replacement setup and deactivates the stale generation", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    const cleanup = vi.fn();
    deps.importModule.mockResolvedValueOnce(
      contentScriptModule({ id: "old", mount: () => cleanup }),
    );
    await reconcile();

    deps.importModule.mockResolvedValueOnce({
      default: definePluginApp(() => {
        throw new Error("setup failed");
      }),
    });
    await reconcile([candidate("hello", "v2")]);

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(state.appliedHashes.has("hello")).toBe(false);
    expect(state.diagnostics.get("hello")?.lastFailure).toMatchObject({
      phase: "setup",
      message: "setup failed",
    });
  });

  it("times out a stuck async mount without preventing another plugin from activating", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("stuck", "v1"),
      candidate("fine", "v1"),
    ]);
    deps.mountTimeoutMs = 1;
    deps.importModule.mockImplementation(async (url: string) =>
      url.includes("/stuck/")
        ? contentScriptModule({
            id: "never-settles",
            mount: () => new Promise<void>(() => {}),
          })
        : contentScriptModule({ id: "fine", mount: () => {} }),
    );

    await reconcile();

    expect(state.diagnostics.get("stuck")).toMatchObject({
      status: "failed",
      lastFailure: {
        phase: "mount",
        scriptId: "never-settles",
        message: "mount timed out after 1ms",
      },
    });
    expect(state.diagnostics.get("fine")).toMatchObject({ status: "active" });
    expect(deps.setRegistrations).toHaveBeenCalledWith(
      "fine",
      expect.any(Object),
    );
  });

  it("aborts async work before cleanup and contains async disposer failures", async () => {
    const { deps, reconcile } = reconcileHarness([candidate("hello", "v1")]);
    const events: string[] = [];
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "async-work",
        async mount({ signal }) {
          events.push("mount");
          signal.addEventListener("abort", () => events.push("abort"), {
            once: true,
          });
          await Promise.resolve();
          return async () => {
            events.push(`dispose:${signal.aborted}`);
            throw new Error("cleanup rejected");
          };
        },
      }),
    );
    await reconcile();
    await reconcile([]);

    expect(events).toEqual(["mount", "abort", "dispose:true"]);
    expect(deps.warn).toHaveBeenCalledWith(
      expect.stringContaining("cleanup rejected"),
    );
  });

  it("keeps independent instances per app window and tears each down once", async () => {
    const signals: AbortSignal[] = [];
    const cleanup = vi.fn();
    const module = contentScriptModule({
      id: "per-window",
      mount({ signal }) {
        signals.push(signal);
        return cleanup;
      },
    });
    const windowA = reconcileHarness([candidate("hello", "v1")]);
    const windowB = reconcileHarness([candidate("hello", "v1")]);
    windowA.deps.importModule.mockResolvedValue(module);
    windowB.deps.importModule.mockResolvedValue(module);

    await Promise.all([windowA.reconcile(), windowB.reconcile()]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);

    await disposePluginFrontends(windowA.state, windowA.deps);
    await disposePluginFrontends(windowA.state, windowA.deps);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(cleanup).toHaveBeenCalledTimes(1);

    await disposePluginFrontends(windowB.state, windowB.deps);
    expect(signals[1]?.aborted).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("aborts a pending mount on app teardown and never commits it afterward", async () => {
    const { state, deps, reconcile } = reconcileHarness([
      candidate("hello", "v1"),
    ]);
    const cleanup = vi.fn();
    let resolveMount: ((dispose: () => void) => void) | undefined;
    let retainedSetter: ThreadRowStatusSetter;
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "pending",
        mount: ({ experimental_setThreadRowStatus }) => {
          retainedSetter = experimental_setThreadRowStatus;
          retainedSetter?.("thr_pending", runningStatus("Pending activation"));
          return new Promise<() => void>((resolve) => {
            resolveMount = resolve;
          });
        },
      }),
    );

    const pending = reconcile();
    await vi.waitFor(() => expect(resolveMount).toBeTypeOf("function"));
    expect(getPluginThreadRowStatus("thr_pending")?.label).toBe(
      "Pending activation",
    );
    await disposePluginFrontends(state, deps);
    expect(getPluginThreadRowStatus("thr_pending")).toBeNull();
    retainedSetter?.("thr_pending", runningStatus("Late pending activation"));
    expect(getPluginThreadRowStatus("thr_pending")).toBeNull();
    resolveMount?.(cleanup);
    await pending;

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(deps.setRegistrations).not.toHaveBeenCalled();
    expect(state.activeGenerations.size).toBe(0);
    expect(state.diagnostics.size).toBe(0);
  });

  it("removes a stale CSS link when the new bundle ships no CSS", async () => {
    const { deps, reconcile } = reconcileHarness([candidate("hello", "v1")]);
    await reconcile();
    expect(deps.applyCss).toHaveBeenCalledWith(
      "hello",
      "/api/v1/plugins/hello/assets/app.css?h=v1",
    );

    await reconcile([candidate("hello", "v2", { cssUrl: null })]);
    expect(deps.applyCss).toHaveBeenLastCalledWith("hello", null);
  });

  it("does not let a content script steal a React-owned host node", async () => {
    const { container, link, reactParent } = renderReactOwnedLink("file-link");
    const { deps, reconcile } = reconcileHarness([
      candidate("file-reveal", "v1"),
    ]);
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "file-reveal-buttons",
        mount() {
          wrapLinkInButtonGroup("file-link");
        },
      }),
    );

    await reconcile();
    expect(link?.parentNode).toBe(reactParent);
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("does not let an async content-script mount steal a React-owned node", async () => {
    const { link, reactParent } = renderReactOwnedLink("async-file-link");
    const { deps, reconcile } = reconcileHarness([
      candidate("file-reveal", "v1"),
    ]);
    deps.importModule.mockResolvedValue(
      contentScriptModule({
        id: "file-reveal-buttons",
        async mount() {
          await Promise.resolve();
          wrapLinkInButtonGroup("async-file-link");
        },
      }),
    );

    await reconcile();
    expect(link?.parentNode).toBe(reactParent);
  });
});

describe("applyPluginCss", () => {
  afterEach(() => {
    resetPluginCssForTest();
    appQueryClient.removeQueries({ queryKey: systemConfigQueryKey() });
    vi.useRealTimers();
  });

  const sheet = (hash: string) =>
    `/assets/app.css?h=${hash}&host-tailwind=${HOST_TAILWIND_VERSION}`;

  it.each([
    [false, sheet("aaa")],
    [true, `${sheet("aaa")}&css-scope=owned-root-v1`],
  ])(
    "requests the narrow stylesheet only when narrowPluginCss is %s",
    (narrowPluginCss, href) => {
      appQueryClient.setQueryData(
        systemConfigQueryKey(),
        makeSystemConfig({
          experiments: { ...defaultExperiments, narrowPluginCss },
        }),
      );
      retainPluginCss("hello");
      applyPluginCss("hello", "/assets/app.css?h=aaa");
      expect(cssHrefs("hello")[0]).toBe(href);
    },
  );

  it("keeps the same element for an unchanged URL and removes it on null", () => {
    retainPluginCss("hello");
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    const first = cssLinks("hello")[0];
    expect(first?.getAttribute("href")).toBe(sheet("aaa"));
    prefetchPluginCss("/assets/prefetched.css");
    expect(
      document
        .querySelector("link[data-bb-plugin-css-prefetch]")
        ?.getAttribute("href"),
    ).toBe(`/assets/prefetched.css?host-tailwind=${HOST_TAILWIND_VERSION}`);
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    expect(cssLinks("hello")[0]).toBe(first);

    applyPluginCss("hello", null);
    expect(cssLinks("hello")).toHaveLength(0);
  });

  it("settles once the sheet loads, fails, or is cleared", async () => {
    const preloaded = applyPluginCss("idle", "/assets/app.css?h=p");
    fireLoad(cssPreloads("idle")[0]);
    await preloaded;

    retainPluginCss("hello");
    const first = applyPluginCss("hello", "/assets/app.css?h=aaa");
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(false);
    fireLoad(cssLinks("hello")[0]);
    await first;
    await applyPluginCss("hello", "/assets/app.css?h=aaa");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = applyPluginCss("hello", "/assets/app.css?h=bbb");
    cssLinks("hello")[1]?.dispatchEvent(new Event("error"));
    await failed;
    warn.mockRestore();
    expect(cssHrefs("hello")).toEqual([sheet("aaa")]);

    const cleared = applyPluginCss("hello", "/assets/app.css?h=ccc");
    await applyPluginCss("hello", null);
    await cleared;
    expect(cssLinks("hello")).toHaveLength(0);
  });

  it("keeps a newer sheet gated when a superseded link fires late", async () => {
    retainPluginCss("hello");
    const first = applyPluginCss("hello", "/assets/app.css?h=aaa");
    const superseded = cssLinks("hello")[0];
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });

    const second = applyPluginCss("hello", "/assets/app.css?h=bbb");
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(firstSettled).toBe(true);
    expect(superseded?.isConnected).toBe(false);

    fireLoad(superseded);
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(cssHrefs("hello")).toEqual([sheet("bbb")]);

    fireLoad(cssLinks("hello")[0]);
    await second;
  });

  it("hands a repeated apply to the link that is already pending", async () => {
    retainPluginCss("hello");
    const first = applyPluginCss("hello", "/assets/app.css?h=aaa");
    const again = applyPluginCss("hello", "/assets/app.css?h=aaa");
    expect(cssLinks("hello")).toHaveLength(1);
    fireLoad(cssLinks("hello")[0]);
    await Promise.all([first, again]);

    const idle = applyPluginCss("other", "/assets/app.css?h=p");
    const idleAgain = applyPluginCss("other", "/assets/app.css?h=p");
    expect(cssPreloads("other")).toHaveLength(1);
    fireLoad(cssPreloads("other")[0]);
    await Promise.all([idle, idleAgain]);
  });

  it("settles through the replacement preload when the last consumer releases mid-load", async () => {
    vi.useFakeTimers();
    const release = retainPluginCss("hello");
    const pending = applyPluginCss("hello", "/assets/app.css?h=aaa");
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    release();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
    expect(cssPreloads("hello")).toHaveLength(1);
    expect(cssPreloads("hello")[0]?.fetchPriority).toBe("low");
    expect(settled).toBe(false);

    fireLoad(cssPreloads("hello")[0]);
    await pending;
  });

  it("preloads inactive CSS and removes the sheet only after its final consumer releases", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    expect(cssPreloads("hello")).toHaveLength(1);
    expect(cssPreloads("hello")[0]?.fetchPriority).not.toBe("low");
    expect(cssPreloads("hello")[0]?.getAttribute("href")).toBe(sheet("aaa"));
    expect(cssLinks("hello")).toHaveLength(0);

    fireLoad(cssPreloads("hello")[0]);
    expect(cssPreloads("hello")).toHaveLength(0);
    const releaseFirst = retainPluginCss("hello");
    const releaseSecond = retainPluginCss("hello");
    expect(cssLinks("hello")).toHaveLength(1);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(1);
    releaseSecond();
    await vi.advanceTimersByTimeAsync(0);
    expect(cssLinks("hello")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
    expect(cssPreloads("hello")).toHaveLength(0);
  });

  it("keeps the same sheet when a consumer retains within the grace window", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssPreloads("hello")[0]);
    const releaseFirst = retainPluginCss("hello");
    const first = cssLinks("hello")[0];
    expect(first).toBeDefined();
    fireLoad(first);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cssLinks("hello")[0]).toBe(first);
    const releaseSecond = retainPluginCss("hello");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(cssLinks("hello")).toHaveLength(1);
    expect(cssLinks("hello")[0]).toBe(first);
    expect(cssPreloads("hello")).toHaveLength(0);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
  });

  it("reattaches the sheet when its load completes during the grace and a consumer retains", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssPreloads("hello")[0]);
    const releaseFirst = retainPluginCss("hello");
    const first = cssLinks("hello")[0];
    expect(first).toBeDefined();

    releaseFirst();
    await vi.advanceTimersByTimeAsync(200);
    fireLoad(first);
    expect(cssLinks("hello")[0]).toBe(first);
    await vi.advanceTimersByTimeAsync(300);
    const releaseSecond = retainPluginCss("hello");
    expect(cssLinks("hello")).toHaveLength(1);
    expect(cssLinks("hello")[0]).toBe(first);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cssLinks("hello")).toHaveLength(1);
    expect(cssPreloads("hello")).toHaveLength(0);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
  });

  it("adopts a changed URL that finishes loading during the grace and reuses it on retain", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssPreloads("hello")[0]);
    const releaseFirst = retainPluginCss("hello");
    fireLoad(cssLinks("hello")[0]);

    applyPluginCss("hello", "/assets/app.css?h=bbb");
    const fresh = cssLinks("hello")[1];
    expect(fresh?.getAttribute("href")).toBe(sheet("bbb"));
    releaseFirst();
    await vi.advanceTimersByTimeAsync(200);
    fireLoad(fresh);
    expect(cssHrefs("hello")).toEqual([sheet("bbb")]);
    await vi.advanceTimersByTimeAsync(300);
    const releaseSecond = retainPluginCss("hello");
    expect(cssHrefs("hello")).toEqual([sheet("bbb")]);
    expect(cssLinks("hello")[0]).toBe(fresh);
    expect(cssPreloads("hello")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    releaseSecond();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
  });

  it("applies a URL that is republished after a flip-flop discarded its in-flight sheet", async () => {
    vi.useFakeTimers();
    retainPluginCss("hello");
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssLinks("hello")[0]);

    applyPluginCss("hello", "/assets/app.css?h=bbb");
    const inflight = cssLinks("hello")[1];
    expect(inflight?.getAttribute("href")).toBe(sheet("bbb"));
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(inflight);
    expect(cssHrefs("hello")).toEqual([sheet("aaa")]);

    applyPluginCss("hello", "/assets/app.css?h=bbb");
    expect(cssHrefs("hello")).toEqual([sheet("aaa"), sheet("bbb")]);
    retainPluginCss("hello");
    expect(cssLinks("hello")).toHaveLength(2);
    fireLoad(
      cssLinks("hello").find((l) => l.getAttribute("href") === sheet("bbb")),
    );
    expect(cssHrefs("hello")).toEqual([sheet("bbb")]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the sheet at once and cancels the timer when the URL is cleared during the grace", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssPreloads("hello")[0]);
    const release = retainPluginCss("hello");
    expect(cssLinks("hello")).toHaveLength(1);

    release();
    expect(vi.getTimerCount()).toBe(1);
    applyPluginCss("hello", null);
    expect(cssLinks("hello")).toHaveLength(0);
    expect(cssPreloads("hello")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
    expect(cssPreloads("hello")).toHaveLength(0);
  });

  it("swaps to one preload of the new URL when it changes during the grace", async () => {
    vi.useFakeTimers();
    applyPluginCss("hello", "/assets/app.css?h=aaa");
    fireLoad(cssPreloads("hello")[0]);
    const release = retainPluginCss("hello");
    fireLoad(cssLinks("hello")[0]);
    expect(cssLinks("hello")).toHaveLength(1);

    release();
    applyPluginCss("hello", "/assets/app.css?h=bbb");
    expect(cssLinks("hello")).toHaveLength(0);
    const preloadHrefs = () =>
      cssPreloads("hello").map((l) => l.getAttribute("href"));
    expect(preloadHrefs()).toEqual([sheet("bbb")]);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("hello")).toHaveLength(0);
    expect(preloadHrefs()).toEqual([sheet("bbb")]);
  });

  it("never ties app-wide bb.themes palette CSS to plugin UI mounts", async () => {
    vi.useFakeTimers();
    const paletteCss = ":root { --canvas: rebeccapurple; }";
    applyAppThemeCss(paletteCss);
    const palette = document.getElementById("bb-app-theme");
    expect(palette?.textContent).toBe(paletteCss);

    applyPluginCss("palette-owner", "/assets/app.css?h=palette-owner");
    fireLoad(cssPreloads("palette-owner")[0]);
    expect(cssLinks("palette-owner")).toHaveLength(0);
    expect(document.getElementById("bb-app-theme")).toBe(palette);
    expect(palette?.textContent).toBe(paletteCss);

    const release = retainPluginCss("palette-owner");
    release();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(cssLinks("palette-owner")).toHaveLength(0);
    expect(document.getElementById("bb-app-theme")).toBe(palette);
    expect(palette?.textContent).toBe(paletteCss);

    applyAppThemeCss("");
    palette?.remove();
  });
});

describe("createPluginFrontendReconcileScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces a burst of schedules into one run", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => {});
    const scheduler = createPluginFrontendReconcileScheduler({
      run,
      debounceMs: 250,
    });

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("serializes runs: a schedule landing mid-run queues one follow-up, never overlaps", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    let release = (): void => {};
    const run = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      active -= 1;
    });
    const scheduler = createPluginFrontendReconcileScheduler({
      run,
      debounceMs: 250,
    });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
