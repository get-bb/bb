// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import type { ExperimentalBadge } from "@get-bb/plugin-sdk";
import { experimental_useSidebarNavigation } from "@get-bb/plugin-sdk/app";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  SidebarProvider,
  SidebarTrigger,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar";
import { AppLayoutSidebar } from "@/components/layout/AppLayoutSidebar";
import { resolveRouteSidebar } from "@/components/layout/routeSidebar";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "@/components/plugin/pluginNavSidebarAtoms";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import {
  bundledNavigationSlot,
  registerNavigationPlugin,
} from "@/test/fixtures/navigation-plugin";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import {
  SidebarNavigationProviderMount,
  SidebarNavigationRegion,
  useSidebarNavigationCustomize,
} from "./SidebarNavigationHost";
import type { ResolvedSidebarNavigation } from "./sidebarNavigationProvider";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { NavRailSettingsButton } from "./NavRailSettingsButton";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  onNavigate: vi.fn(),
  onNewChat: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/views/useMobileRecentsThreadReveal", () => ({
  useMobileRecentsThreadReveal: () => {},
}));

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { SidebarNavigationProviderMount } = await vi.importActual<
    typeof import("./SidebarNavigationHost")
  >("./SidebarNavigationHost");
  const { NavRailSettingsButton } = await vi.importActual<
    typeof import("./NavRailSettingsButton")
  >("./NavRailSettingsButton");
  return {
    AppSidebar: ({
      navigation,
      settingsRoutePath,
      isSettingsActive,
    }: {
      navigation: ResolvedSidebarNavigation;
      settingsRoutePath: string;
      isSettingsActive: boolean;
    }) => (
      <>
        <SidebarNavigationProviderMount resolved={navigation} />
        <NavRailSettingsButton
          isSettingsActive={isSettingsActive}
          settingsRoutePath={settingsRoutePath}
        />
      </>
    ),
  };
});

vi.mock("@/components/settings/SettingsSidebar", () => ({
  SettingsSidebar: () => null,
}));
vi.mock("@/components/tools/ResourceSidebar", () => ({
  ResourceSidebar: () => null,
}));

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: () => ({
    appUpdateAvailable: true,
    desktopUpdateReady: false,
    machines: [],
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: [] }),
}));
vi.mock("@/hooks/useMachineAttention", () => ({
  useMachineAttention: () => ({ label: null }),
}));
vi.mock("@/components/provider-cli/provider-cli-install", () => ({
  useProviderCliInstallRunner: () => ({ runningJobKey: null }),
}));

const THREAD_PATH = getThreadRoutePath({
  projectId: "proj_one",
  threadId: "thr_one",
});
const ALL_KEYS = [
  "__bb__/new-thread",
  "__bb__/search-threads",
  "__bb__/extensions",
  "__bb__/skills",
  "garden/docs",
  "garden/alerts",
];
const DOCS_PATH = getPluginPanelRoutePath({ pluginId: "garden", path: "docs" });
const AUTOMATIONS_PLUGIN_PANEL_PATH = "automations";

function RailNewThreadButton() {
  const Header = bundledNavigationSlot("rail").headerComponent;
  if (Header === undefined) throw new Error("Expected the Rail header");
  return <Header width={200} controlSize={28} isCompactViewport={false} />;
}

function RailHarness({
  useLayout = false,
  slot = bundledNavigationSlot("rail"),
}: {
  useLayout?: boolean;
  slot?: ExperimentalSidebarNavigationSlot;
}) {
  const closeMobileSidebar = useCloseMobileSidebar();
  const location = useLocation();
  const isSettings = location.pathname.startsWith(SETTINGS_ROUTE_PATH);
  const customize = useSidebarNavigationCustomize();
  return (
    <SidebarNavigationModelProvider
      onNavigate={mocks.onNavigate}
      onNewChat={mocks.onNewChat}
      onOpenCustomize={customize.open}
      splitEnabled={false}
    >
      {useLayout ? (
        <>
          <AppLayoutSidebar
            routeSidebar={resolveRouteSidebar(location.pathname, null)}
            isSettingsActive={isSettings}
            onResizeMouseDown={() => {}}
            isResizing={false}
            settingsRoutePath={SETTINGS_ROUTE_PATH}
            backToAppRoutePath={isSettings ? "/" : null}
          />
          <SidebarTrigger />
          <SidebarUpdatesBadge onNavigate={closeMobileSidebar} />
        </>
      ) : (
        <>
          <SidebarNavigationRegion placement="rail" customize={customize}>
            <SidebarNavigationProviderMount
              resolved={{ kind: "plugin", slot, fallback: null }}
            />
          </SidebarNavigationRegion>
          <NavRailSettingsButton
            isSettingsActive={isSettings}
            settingsRoutePath={SETTINGS_ROUTE_PATH}
          />
        </>
      )}
      <RailNewThreadButton />
      <output data-testid="pathname">{location.pathname}</output>
    </SidebarNavigationModelProvider>
  );
}

function renderRail(
  initialPath: string,
  options: {
    visibleKeys?: string[];
    isCompactViewport?: boolean;
    isFramed?: boolean;
    useLayout?: boolean;
    slot?: ExperimentalSidebarNavigationSlot;
  } = {},
) {
  const store = createStore();
  if (options.visibleKeys) {
    store.set(pluginNavPanelOrderAtom, ALL_KEYS);
    store.set(pluginNavVisiblePanelKeysAtom, options.visibleKeys);
  }
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CompactViewportOverrideProvider
          isCompactViewport={options.isCompactViewport ?? false}
        >
          <TooltipProvider>
            <SidebarProvider framed={options.isFramed ?? false}>
              <RailHarness useLayout={options.useLayout} slot={options.slot} />
            </SidebarProvider>
          </TooltipProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function rail(): HTMLElement {
  return screen.getByTestId("app-nav-rail");
}

function railButton(name: string): HTMLElement {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="app-nav-rail"] button, button[aria-label="Settings"]',
    ),
  ).find((candidate) => candidate.getAttribute("aria-label") === name);
  if (!button) throw new Error(`Expected a rail button named ${name}`);
  return button;
}

function railLabels(): (string | null)[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="app-nav-rail"] button, button[aria-label="Settings"]',
    ),
    (button) => button.getAttribute("aria-label"),
  );
}

function currentRailLabels(): (string | null)[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '[data-testid="app-nav-rail"] button[aria-current="page"], button[aria-label="Settings"][aria-current="page"]',
    ),
    (button) => button.getAttribute("aria-label"),
  );
}

function railBadgeText(name: string): string | null | undefined {
  return railButton(name).querySelector('[data-nav-rail-badge="count"]')
    ?.textContent;
}

function registerDocsBadge(initial: ExperimentalBadge | null) {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function useBadge() {
    return useSyncExternalStore(subscribe, () => value);
  }
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
          experimental_useBadge: useBadge,
        },
      ],
    }),
  );
  return {
    set(next: ExperimentalBadge | null) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

function pathname(): string | null {
  return screen.getByTestId("pathname").textContent;
}

beforeAll(async () => {
  await SidebarVisibilityCustomize.preload();
});

beforeEach(async () => {
  vi.clearAllMocks();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  window.localStorage.clear();
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
        },
      ],
    }),
  );
  await registerNavigationPlugin();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetAllCrashedPluginSlotsForTest();
  vi.useRealTimers();
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("Rail", () => {
  it.each([{ metaKey: true }, { ctrlKey: true }])(
    "opens Settings in a browser tab with %j even when already active",
    (modifier) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderRail(SETTINGS_ROUTE_PATH);

      fireEvent.click(railButton("Settings"), modifier);

      expect(open).toHaveBeenCalledExactlyOnceWith(
        SETTINGS_ROUTE_PATH,
        "_blank",
        "noopener,noreferrer",
      );
      expect(pathname()).toBe(SETTINGS_ROUTE_PATH);
    },
  );

  it("lists Home, the visible destinations, More, and Settings, with New thread left to the header", () => {
    renderRail(THREAD_PATH);

    expect(railLabels()).toEqual([
      "Home",
      "Plugins",
      "Skills",
      "Docs",
      "More",
      "Settings",
    ]);
    expect(currentRailLabels()).toEqual(["Home"]);
  });

  it("moves the highlight from Home to a plugin panel and to Settings as the route changes", () => {
    renderRail(THREAD_PATH);

    fireEvent.click(railButton("Docs"));
    expect(pathname()).toBe(DOCS_PATH);
    expect(currentRailLabels()).toEqual(["Docs"]);

    fireEvent.click(railButton("Settings"));
    expect(pathname()).toBe(SETTINGS_ROUTE_PATH);
    expect(currentRailLabels()).toEqual(["Settings"]);

    fireEvent.click(railButton("Plugins"));
    expect(currentRailLabels()).toEqual(["Plugins"]);
  });

  it("keeps a plugin panel highlighted on its nested routes", () => {
    renderRail(`${DOCS_PATH}/guides/getting-started.md`);

    expect(currentRailLabels()).toEqual(["Docs"]);
  });

  it("lists the Automations panel as a destination", () => {
    setPluginSlotRegistrations(
      AUTOMATIONS_PLUGIN_ID,
      registrationSet({
        navPanels: [
          {
            id: AUTOMATIONS_PLUGIN_PANEL_PATH,
            title: "Automations",
            icon: "Calendar",
            path: AUTOMATIONS_PLUGIN_PANEL_PATH,
            component: () => null,
          },
        ],
      }),
    );

    renderRail(THREAD_PATH);

    expect(railButton("Automations")).toBeDefined();
  });

  it("draws a remembered plugin panel before boot and keeps the same button when the plugin registers", async () => {
    resetPluginSlotStoreForTest();
    resetPluginFrontendBootStateForTest();
    await registerNavigationPlugin();
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "demo",
        id: "board",
        path: "board",
        title: "Demo board",
        icon: "columns",
      },
    ]);
    renderRail(THREAD_PATH);
    const remembered = railButton("Demo board");

    act(() => {
      setPluginSlotRegistrations(
        "demo",
        registrationSet({
          navPanels: [
            {
              id: "board",
              title: "Demo board",
              icon: "columns",
              path: "board",
              component: () => null,
            },
          ],
        }),
      );
      markPluginFrontendsSettled();
    });

    expect(railButton("Demo board")).toBe(remembered);
  });

  it("drops a remembered plugin panel that never registers once frontends have settled", async () => {
    resetPluginSlotStoreForTest();
    resetPluginFrontendBootStateForTest();
    await registerNavigationPlugin();
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "ghost",
        id: "board",
        path: "board",
        title: "Ghost board",
        icon: "columns",
      },
    ]);
    renderRail(THREAD_PATH);
    expect(railButton("Ghost board")).toBeDefined();

    act(() => markPluginFrontendsSettled());

    expect(railLabels()).not.toContain("Ghost board");
  });

  it("returns Home to the last thread, skipping plugin panels and Settings visited since", () => {
    renderRail(THREAD_PATH);

    fireEvent.click(railButton("Docs"));
    fireEvent.click(railButton("Settings"));
    fireEvent.click(railButton("Home"));

    expect(pathname()).toBe(THREAD_PATH);
    expect(currentRailLabels()).toEqual(["Home"]);
  });

  it("sends Home to a new thread after a cold load onto a plugin panel that registers late", () => {
    resetPluginFrontendBootStateForTest();
    const automationsPath = getPluginPanelRoutePath({
      pluginId: AUTOMATIONS_PLUGIN_ID,
      path: AUTOMATIONS_PLUGIN_PANEL_PATH,
    });
    renderRail(automationsPath);
    expect(currentRailLabels()).toEqual([]);

    act(() => {
      setPluginSlotRegistrations(
        AUTOMATIONS_PLUGIN_ID,
        registrationSet({
          navPanels: [
            {
              id: AUTOMATIONS_PLUGIN_PANEL_PATH,
              title: "Automations",
              icon: "Calendar",
              path: AUTOMATIONS_PLUGIN_PANEL_PATH,
              component: () => null,
            },
          ],
        }),
      );
      markPluginFrontendsSettled();
    });
    expect(currentRailLabels()).toEqual(["Automations"]);

    fireEvent.click(railButton("Skills"));
    fireEvent.click(railButton("Home"));

    expect(pathname()).toBe(getRootComposeRoutePath());
    expect(currentRailLabels()).toEqual(["Home"]);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])(
    "opens the new thread screen in a browser tab from Home with %j",
    (modifier) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      renderRail(THREAD_PATH);

      fireEvent.click(railButton("Settings"));
      fireEvent.click(railButton("Home"), modifier);

      expect(open).toHaveBeenCalledExactlyOnceWith(
        getRootComposeRoutePath(),
        "_blank",
        "noopener,noreferrer",
      );
      expect(pathname()).toBe(SETTINGS_ROUTE_PATH);
    },
  );

  it("navigates Home in place when a rail plugin calls goHome without options", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    function LegacyHomeRail() {
      const { actions } = experimental_useSidebarNavigation();
      return (
        <button type="button" onClick={() => actions.goHome()}>
          Legacy Home
        </button>
      );
    }
    renderRail(SETTINGS_ROUTE_PATH, {
      slot: { ...bundledNavigationSlot("rail"), component: LegacyHomeRail },
    });

    fireEvent.click(screen.getByRole("button", { name: "Legacy Home" }));

    expect(open).not.toHaveBeenCalled();
    expect(pathname()).toBe(getRootComposeRoutePath());
  });

  it("returns Home to the last thread after settings navigation closes the compact sidebar", () => {
    vi.useFakeTimers();
    renderRail(THREAD_PATH, { isCompactViewport: true, useLayout: true });
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    act(() => vi.advanceTimersByTime(250));

    fireEvent.click(screen.getByRole("link", { name: "bb update available" }));
    expect(pathname()).toBe(`${SETTINGS_ROUTE_PATH}/updates`);
    act(() => vi.advanceTimersByTime(250));

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    act(() => vi.advanceTimersByTime(250));
    fireEvent.click(railButton("Home"));

    expect(pathname()).toBe(THREAD_PATH);
    expect(currentRailLabels()).toEqual(["Home"]);
  });

  it("sends Home to a new thread when the session started outside the thread list", () => {
    renderRail(SETTINGS_ROUTE_PATH);

    expect(currentRailLabels()).toEqual(["Settings"]);
    fireEvent.click(railButton("Home"));

    expect(pathname()).toBe("/");
  });

  it("dismisses the drawer for a plugin panel but not for destinations that swap the list beside the rail", () => {
    renderRail(THREAD_PATH);

    fireEvent.click(railButton("Plugins"));
    fireEvent.click(railButton("Skills"));
    fireEvent.click(railButton("Settings"));
    fireEvent.click(railButton("Home"));
    expect(pathname()).toBe(THREAD_PATH);
    expect(mocks.onNavigate).not.toHaveBeenCalled();

    fireEvent.click(railButton("Docs"));
    expect(pathname()).toBe(DOCS_PATH);
    expect(mocks.onNavigate).toHaveBeenCalledTimes(1);
  });

  it("draws a plugin panel's rail badge and names it in the destination's label", () => {
    const badge = registerDocsBadge({ count: 3, label: "3 open pages" });

    renderRail(THREAD_PATH);

    expect(railButton("Docs, 3 open pages")).toBeDefined();
    expect(railBadgeText("Docs, 3 open pages")).toBe("3");

    act(() => badge.set({ count: 9, label: "9 open pages" }));
    expect(railBadgeText("Docs, 9 open pages")).toBe("9");

    act(() => badge.set({ count: 10, label: "10 open pages" }));
    expect(railBadgeText("Docs, 10 open pages")).toBe("9+");

    act(() => badge.set({ label: "Sync failed" }));
    expect(
      railButton("Docs, Sync failed").querySelector(
        '[data-nav-rail-badge="dot"]',
      ),
    ).not.toBeNull();

    act(() => badge.set(null));
    expect(
      railButton("Docs").querySelector("[data-nav-rail-badge]"),
    ).toBeNull();
  });

  it("marks More and the More menu item for a badged destination hidden under More", async () => {
    registerDocsBadge({ count: 2, label: "2 open pages" });

    renderRail(THREAD_PATH, {
      visibleKeys: ["__bb__/new-thread", "__bb__/extensions"],
    });

    const more = railButton("More, Docs: 2 open pages");
    expect(more.querySelector('[data-nav-rail-badge="dot"]')).not.toBeNull();
    fireEvent.keyDown(more, { key: "Enter" });
    const item = await screen.findByRole("menuitem", {
      name: "Docs, 2 open pages",
    });
    expect(
      item.querySelector('[data-nav-rail-badge="count"]')?.textContent,
    ).toBe("2");
  });

  it.each([
    { name: "a zero count", badge: { count: 0, label: "none" } },
    {
      name: "both count and text",
      badge: { count: 2, text: "NEW", label: "two new" },
    },
    {
      name: "text over eight characters",
      badge: { text: "123456789", label: "too long" },
    },
    {
      name: "an unknown tone",
      badge: { count: 2, tone: "loud", label: "two" },
    },
  ])(
    "shows no badge for $name and keeps the destination usable",
    ({ badge }) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      registerDocsBadge(badge as ExperimentalBadge);

      renderRail(THREAD_PATH);

      expect(rail().querySelector("[data-nav-rail-badge]")).toBeNull();
      fireEvent.click(railButton("Docs"));
      expect(pathname()).toBe(DOCS_PATH);
    },
  );

  it("draws a text badge as a dot in its tone on the rail and keeps the label in the name", () => {
    registerDocsBadge({
      text: "2 down",
      tone: "critical",
      label: "2 sites down",
    });

    renderRail(THREAD_PATH);

    const mark = railButton("Docs, 2 sites down").querySelector(
      "[data-nav-rail-badge]",
    );
    expect(mark?.getAttribute("data-nav-rail-badge")).toBe("dot");
    expect(mark?.getAttribute("data-nav-badge-tone")).toBe("critical");
    expect(mark?.textContent).toBe("");
  });

  it("colors the More dot with the strongest tone hidden under it", () => {
    setPluginSlotRegistrations(
      "garden",
      registrationSet({
        navPanels: [
          {
            id: "docs",
            title: "Docs",
            icon: "BookOpen",
            path: "docs",
            component: () => null,
            experimental_useBadge: () => ({ count: 2, label: "2 drafts" }),
          },
          {
            id: "alerts",
            title: "Alerts",
            icon: "Bell",
            path: "alerts",
            component: () => null,
            experimental_useBadge: () => ({
              tone: "warning",
              label: "1 due today",
            }),
          },
        ],
      }),
    );

    renderRail(THREAD_PATH, { visibleKeys: ["__bb__/extensions"] });

    const more = railButton("More, Docs: 2 drafts, Alerts: 1 due today");
    expect(
      more
        .querySelector("[data-nav-rail-badge]")
        ?.getAttribute("data-nav-badge-tone"),
    ).toBe("warning");
  });

  it("keeps hidden destinations out of the rail", () => {
    renderRail(THREAD_PATH, {
      visibleKeys: ["__bb__/new-thread", "__bb__/extensions"],
    });

    expect(railLabels()).toEqual(["Home", "Plugins", "More", "Settings"]);
  });

  it("keeps hidden destinations reachable from More", async () => {
    renderRail(THREAD_PATH);

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Search threads" }),
    );

    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", null);
  });

  it("opens the customize sheet from More on a compact viewport", async () => {
    renderRail(THREAD_PATH, { isCompactViewport: true });

    fireEvent.click(railButton("More"));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );

    const editor = await screen.findByTestId("nav-rail-customize");
    const list = within(editor).getByRole("list", {
      name: "Sidebar navigation",
    });
    fireEvent.click(within(list).getByRole("checkbox", { name: /Skills/u }));
    expect(railLabels()).toEqual([
      "Home",
      "Plugins",
      "Docs",
      "More",
      "Settings",
    ]);
  });

  it.each([
    { name: "Docs", isCompactViewport: false },
    { name: "Search threads", isCompactViewport: false },
    { name: "Docs", isCompactViewport: true },
    { name: "Search threads", isCompactViewport: true },
  ])(
    "toggles $name visibility from its customization row (compact: $isCompactViewport) without activating it",
    async ({ name, isCompactViewport }) => {
      renderRail(THREAD_PATH, {
        visibleKeys: ["__bb__/skills"],
        isCompactViewport,
      });
      if (isCompactViewport) fireEvent.click(railButton("More"));
      else fireEvent.keyDown(railButton("More"), { key: "Enter" });
      fireEvent.click(
        await screen.findByRole("menuitem", { name: "Customize navigation" }),
      );

      const editor = await screen.findByTestId("nav-rail-customize");
      const checkbox = within(editor).getByRole("checkbox", {
        name: `Show ${name} in sidebar`,
      });
      expect(checkbox.getAttribute("aria-checked")).toBe("false");

      for (const checked of [true, false]) {
        fireEvent.click(within(editor).getByRole("button", { name }), {
          ctrlKey: !checked,
        });
        expect(checkbox.getAttribute("aria-checked")).toBe(String(checked));
        expect(railLabels().includes(name)).toBe(checked);
        expect(screen.getByTestId("nav-rail-customize")).toBe(editor);
        expect(pathname()).toBe(THREAD_PATH);
        expect(mocks.onNavigate).not.toHaveBeenCalled();
        expect(mocks.dispatch).not.toHaveBeenCalled();
      }
    },
  );

  it("customizes the rail from a popover beside it without leaving Settings", async () => {
    renderRail(THREAD_PATH);
    fireEvent.click(railButton("Settings"));

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );

    const editor = await screen.findByTestId("nav-rail-customize");
    expect(pathname()).toBe(SETTINGS_ROUTE_PATH);
    expect(currentRailLabels()).toEqual(["Settings"]);
    expect(rail().contains(editor)).toBe(false);

    const list = within(editor).getByRole("list", {
      name: "Sidebar navigation",
    });
    fireEvent.click(within(list).getByRole("checkbox", { name: /Skills/u }));
    expect(railLabels()).toEqual([
      "Home",
      "Plugins",
      "Docs",
      "More",
      "Settings",
    ]);
    fireEvent.click(
      within(list).getByRole("checkbox", { name: /Search threads/u }),
    );
    expect(railLabels()).toEqual([
      "Home",
      "Search threads",
      "Plugins",
      "Docs",
      "More",
      "Settings",
    ]);

    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByTestId("nav-rail-customize")).toBeNull(),
    );
    expect(document.activeElement).toBe(railButton("More"));
    expect(pathname()).toBe(SETTINGS_ROUTE_PATH);
  });

  it("opens the customize popover at the top of the navigation and keeps it there while More moves", async () => {
    renderRail(THREAD_PATH);
    let moreTop = 200;
    vi.spyOn(
      screen.getByTestId("sidebar-navigation-rail"),
      "getBoundingClientRect",
    ).mockImplementation(() => new DOMRect(12, 40, 52, 600));
    vi.spyOn(railButton("More"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(12, moreTop, 28, 28),
    );

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );
    const editor = await screen.findByTestId("nav-rail-customize");
    const wrapper = editor.closest<HTMLElement>(
      "[data-radix-popper-content-wrapper]",
    );
    if (!wrapper) throw new Error("Expected the popover position wrapper");
    await waitFor(() => expect(wrapper.style.transform).toContain("40px"));
    const openedAt = wrapper.style.transform;

    moreTop = 120;
    fireEvent(window, new Event("resize"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(wrapper.style.transform).toBe(openedAt);
  });

  it("opens the More menu beside the More button instead of at the top of the rail", async () => {
    renderRail(THREAD_PATH);
    vi.spyOn(railButton("Home"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(12, 40, 28, 28),
    );
    vi.spyOn(railButton("More"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(12, 200, 28, 28),
    );

    const viewport = [
      vi
        .spyOn(document.documentElement, "clientWidth", "get")
        .mockReturnValue(1280),
      vi
        .spyOn(document.documentElement, "clientHeight", "get")
        .mockReturnValue(800),
    ];

    try {
      fireEvent.keyDown(railButton("More"), { key: "Enter" });
      const menu = await screen.findByTestId("nav-rail-more-menu");
      const wrapper = menu.closest<HTMLElement>(
        "[data-radix-popper-content-wrapper]",
      );
      if (!wrapper) throw new Error("Expected the menu position wrapper");

      await waitFor(() =>
        expect(wrapper.style.transform).toBe("translate(52px, 200px)"),
      );
    } finally {
      for (const spy of viewport) spy.mockRestore();
    }
  });

  it("keeps the header New thread button when stored preferences leave New thread out", () => {
    renderRail(THREAD_PATH, { visibleKeys: ["__bb__/extensions"] });

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(mocks.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("offers no New thread row in Customize navigation", async () => {
    renderRail(THREAD_PATH);

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize navigation" }),
    );

    const editor = await screen.findByTestId("nav-rail-customize");
    const list = within(editor).getByRole("list", {
      name: "Sidebar navigation",
    });
    expect(
      within(list)
        .getAllByRole("checkbox")
        .map((checkbox) => checkbox.getAttribute("aria-label")),
    ).toEqual([
      "Show Search threads in sidebar",
      "Show Plugins in sidebar",
      "Show Skills in sidebar",
      "Show Docs in sidebar",
    ]);
    expect(screen.getByRole("button", { name: "New thread" })).toBeDefined();
  });
});
