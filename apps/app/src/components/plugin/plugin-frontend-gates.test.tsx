// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadTabsQueryKey } from "@/hooks/queries/query-keys";
import { resetFixedPanelTabsStateForTest } from "@/lib/fixed-panel-tabs";
import { createPluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { definePluginApp } from "@/lib/plugin-app-definition";
import {
  createPluginFrontendReconcileState,
  reconcilePluginFrontends,
  type PluginFrontendCandidate,
  type PluginFrontendReconcileDeps,
} from "@/lib/plugin-frontend";
import {
  markPluginFrontendBootStarted,
  resetPluginFrontendBootStateForTest,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import {
  usePluginNavPanelChrome,
  writeLastKnownPluginNavPanelChrome,
} from "@/lib/plugin-nav-panel-chrome";
import {
  beginPluginSlotBatch,
  flushPluginSlotChanges,
  getPluginSlotSnapshot,
  removePluginSlotRegistrations,
  resetPluginSlotStoreForTest,
  setLoadingPluginFrontends,
  setPluginSlotRegistrations,
  settleLoadingPluginFrontend,
  usePluginFrontendSettled,
} from "@/lib/plugin-slots";
import { PluginPanelView } from "@/views/PluginPanelView";
import { PluginPanelTabContent } from "./PluginPanelActions";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { usePluginTabs } from "./PluginTabs";
import { useThreadFixedTabs } from "./PluginThreadFixedTabs";

const LOADED = "loaded";
const SLOW = "slow";
const STARTING = "starting";
const THREAD_ID = "thr_gates";

function candidate(pluginId: string): PluginFrontendCandidate {
  return {
    pluginId,
    bundle: {
      jsUrl: `/api/v1/plugins/${pluginId}/assets/app.js?h=h`,
      cssUrl: null,
      jsBytes: 1,
      hash: "h",
      sdkMajor: 0,
      sdkVersion: "0.1.0",
      compatible: true,
      runtimeSlots: [],
      staticChunkUrls: [],
      lazyChunkUrls: [],
      lazyRuntimeSlots: [],
    },
  };
}

const loadedModule = {
  default: definePluginApp((app) => {
    app.slots.navPanel({
      id: "page",
      path: "page",
      title: "Loaded page",
      icon: "Info",
      component: () => <div>loaded page body</div>,
    });
    app.slots.experimental_tab({
      context: { kind: "nav-panel", panelId: "page" },
      availability: "fixed",
      id: "side",
      title: "Side",
      icon: "Info",
      component: () => <div>side</div>,
    });
    app.slots.experimental_tab({
      context: { kind: "thread" },
      availability: "fixed",
      id: "diff",
      title: "Diff",
      icon: "Info",
      component: () => <div>diff</div>,
    });
  }),
};

function liveDeps(): PluginFrontendReconcileDeps {
  return {
    fetchCandidates: async () => ({
      candidates: [candidate(LOADED), candidate(SLOW)],
      startingPluginIds: [STARTING],
    }),
    importModule: (url) =>
      url.includes(`/${SLOW}/`)
        ? new Promise<never>(() => {})
        : Promise.resolve(loadedModule),
    importRetryDelaysMs: [],
    applyCss: vi.fn(),
    prefetchCss: vi.fn(),
    prefetchModule: vi.fn(),
    retainCss: vi.fn(() => vi.fn()),
    resetCrashedSlots: vi.fn(),
    setRegistrations: setPluginSlotRegistrations,
    removeRegistrations: removePluginSlotRegistrations,
    setLoadingPlugins: setLoadingPluginFrontends,
    settlePluginLoad: settleLoadingPluginFrontend,
    beginSlotBatch: () => beginPluginSlotBatch({ maxHoldMs: 150 }),
    flushSlotBatch: flushPluginSlotChanges,
    warn: vi.fn(),
    priorityPluginIds: () => [],
    restoredLazyParts: () => [],
    whenScreenPainted: () => Promise.resolve(),
  };
}

async function loadOnlyTheFastPlugin(): Promise<void> {
  markPluginFrontendBootStarted();
  void reconcilePluginFrontends(
    createPluginFrontendReconcileState(),
    liveDeps(),
  );
  await act(async () => {
    await vi.waitUntil(
      () =>
        getPluginSlotSnapshot().navPanels.some(
          (panel) => panel.pluginId === LOADED,
        ),
      { timeout: 1000 },
    );
    await vi.advanceTimersByTimeAsync(200);
  });
}

function Probe({ label, ready }: { label: string; ready: boolean }) {
  return <output aria-label={label}>{ready ? "ready" : "waiting"}</output>;
}

function NavPanelTabs({ pluginId }: { pluginId: string }) {
  const tabs = usePluginTabs(
    { kind: "nav-panel", pluginId, panelId: "page", subPath: "" },
    [pluginId],
  );
  return <Probe label="nav-panel tabs" ready={tabs.isReady} />;
}

function ThreadTabs() {
  const tabs = useThreadFixedTabs({ threadId: THREAD_ID, environmentId: null });
  return (
    <>
      {tabs.observers}
      <Probe label="thread tabs" ready={tabs.isReady} />
    </>
  );
}

function RememberedNavItems() {
  const entries = usePluginNavPanelChrome();
  return (
    <ul>
      {entries.map((entry) => (
        <li key={`${entry.chrome.pluginId}/${entry.chrome.id}`}>
          {entry.chrome.title}
          {entry.panel === null ? " (loading)" : ""}
        </li>
      ))}
    </ul>
  );
}

function renderSurface(surface: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(threadTabsQueryKey(THREAD_ID), {
    revision: 1,
    tabs: [
      {
        id: `plugin-fixed:${LOADED}:diff`,
        kind: "plugin-fixed",
        pluginId: LOADED,
        tabId: "diff",
      },
    ],
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{surface}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  resetFixedPanelTabsStateForTest();
  resetAllCrashedPluginSlotsForTest();
  window.localStorage.clear();
});

describe("surfaces that need one plugin do not wait for other bundles", () => {
  const surfaces: {
    name: string;
    surface: ReactNode;
    expectReady: () => void;
  }[] = [
    {
      name: "a plugin page's right-panel tabs",
      surface: <NavPanelTabs pluginId={LOADED} />,
      expectReady: () =>
        expect(screen.getByLabelText("nav-panel tabs").textContent).toBe(
          "ready",
        ),
    },
    {
      name: "a thread's remembered fixed tabs",
      surface: <ThreadTabs />,
      expectReady: () =>
        expect(screen.getByLabelText("thread tabs").textContent).toBe("ready"),
    },
    {
      name: "a page the loaded plugin no longer registers",
      surface: (
        <PluginPanelView pluginId={LOADED} panelPath="gone" subPath="" />
      ),
      expectReady: () =>
        expect(
          screen.getByText(/This plugin panel is not available/),
        ).toBeTruthy(),
    },
    {
      name: "an action tab the loaded plugin no longer registers",
      surface: (
        <PluginPanelTabContent
          tab={createPluginPanelFixedPanelTab({
            pluginId: LOADED,
            actionId: "gone",
            paramsJson: null,
            title: "Gone",
          })}
          context={{ kind: "thread", threadId: THREAD_ID, environment: null }}
        />
      ),
      expectReady: () =>
        expect(
          screen.getByText(/This plugin tab is not available/),
        ).toBeTruthy(),
    },
    {
      name: "a remembered nav item the loaded plugin no longer registers",
      surface: <RememberedNavItems />,
      expectReady: () => {
        expect(screen.queryByText("Gone page (loading)")).toBeNull();
        expect(screen.getByText("Slow page (loading)")).toBeTruthy();
      },
    },
  ];

  for (const { name, surface, expectReady } of surfaces) {
    it(name, async () => {
      writeLastKnownPluginNavPanelChrome([
        {
          pluginId: LOADED,
          id: "gone",
          path: "gone",
          title: "Gone page",
          icon: "Info",
          hideFromNavigation: false,
        },
        {
          pluginId: SLOW,
          id: "slow",
          path: "slow",
          title: "Slow page",
          icon: "Info",
          hideFromNavigation: false,
        },
      ]);
      renderSurface(surface);
      await loadOnlyTheFastPlugin();
      expectReady();
    });
  }

  it("keeps waiting for plugins still loading or starting on the server", async () => {
    function AllSettled() {
      return <Probe label="all plugins" ready={usePluginFrontendsSettled()} />;
    }
    renderSurface(
      <>
        <AllSettled />
        <NavPanelTabs pluginId={SLOW} />
        <PluginPanelView pluginId={SLOW} panelPath="slow" subPath="" />
        <PluginPanelView pluginId={STARTING} panelPath="page" subPath="" />
      </>,
    );
    await loadOnlyTheFastPlugin();
    expect(screen.getByLabelText("all plugins").textContent).toBe("waiting");
    expect(screen.getByLabelText("nav-panel tabs").textContent).toBe("waiting");
    expect(screen.queryByText(/not available/)).toBeNull();
  });

  it("never reports a plugin settled before its registrations are visible", async () => {
    const seen: { settled: boolean; registered: boolean }[] = [];
    function SettledProbe() {
      const settled = usePluginFrontendSettled(LOADED);
      seen.push({
        settled,
        registered: getPluginSlotSnapshot().navPanels.some(
          (panel) => panel.pluginId === LOADED,
        ),
      });
      return null;
    }
    renderSurface(<SettledProbe />);
    await loadOnlyTheFastPlugin();
    expect(seen.at(-1)).toEqual({ settled: true, registered: true });
    expect(seen.filter((entry) => entry.settled && !entry.registered)).toEqual(
      [],
    );
  });
});
