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
import { useState, type ReactNode } from "react";
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
} from "@/lib/plugin-slots";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
  getThreadRoutePath,
  isPluginsRoutePath,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import {
  AppNavRail,
  NavRailNewThreadButton,
  NavRailSettingsButton,
} from "./AppNavRail";
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

vi.mock("@/components/sidebar/AppSidebar", () => ({
  AppSidebar: ({
    renderRail,
    railFooter,
  }: {
    railFooter: ReactNode;
    renderRail: (customize: {
      isOpen: boolean;
      onOpenChange: () => void;
    }) => ReactNode;
  }) => (
    <>
      {renderRail({ isOpen: false, onOpenChange: () => {} })}
      {railFooter}
    </>
  ),
}));

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
];
const DOCS_PATH = getPluginPanelRoutePath({ pluginId: "garden", path: "docs" });
const AUTOMATIONS_PLUGIN_PANEL_PATH = "automations";

function RailHarness({ useLayout = false }: { useLayout?: boolean }) {
  const closeMobileSidebar = useCloseMobileSidebar();
  const location = useLocation();
  const isSettings = location.pathname.startsWith(SETTINGS_ROUTE_PATH);
  const isAppMode = !isSettings && !isPluginsRoutePath(location.pathname);
  const [isCustomizing, setCustomizing] = useState(false);
  return (
    <SidebarNavigationModelProvider
      onNavigate={mocks.onNavigate}
      onNewChat={mocks.onNewChat}
      splitEnabled={false}
    >
      {useLayout ? (
        <>
          <AppLayoutSidebar
            mode={isSettings ? "settings" : "app"}
            onResizeMouseDown={() => {}}
            isResizing={false}
            settingsRoutePath={SETTINGS_ROUTE_PATH}
          />
          <SidebarTrigger />
          <SidebarUpdatesBadge onNavigate={closeMobileSidebar} />
        </>
      ) : (
        <>
          <AppNavRail
            isAppMode={isAppMode}
            customize={{ isOpen: isCustomizing, onOpenChange: setCustomizing }}
          />
          <NavRailSettingsButton
            isSettingsActive={isSettings}
            settingsRoutePath={SETTINGS_ROUTE_PATH}
          />
        </>
      )}
      <NavRailNewThreadButton />
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
              <RailHarness useLayout={options.useLayout} />
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

function pathname(): string | null {
  return screen.getByTestId("pathname").textContent;
}

beforeAll(async () => {
  await SidebarVisibilityCustomize.preload();
});

beforeEach(() => {
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
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  window.localStorage.clear();
});

describe("AppNavRail", () => {
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

  it("draws a remembered plugin panel before boot and keeps the same button when the plugin registers", () => {
    resetPluginSlotStoreForTest();
    resetPluginFrontendBootStateForTest();
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

  it("drops a remembered plugin panel that never registers once frontends have settled", () => {
    resetPluginSlotStoreForTest();
    resetPluginFrontendBootStateForTest();
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

  it("does not mount a plugin panel's sidebar accessory", () => {
    const accessoryMounted = vi.fn();
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
            experimental_sidebarAccessory: () => {
              accessoryMounted();
              return <span>492/1</span>;
            },
          },
        ],
      }),
    );

    renderRail(THREAD_PATH);

    expect(railButton("Docs")).toBeDefined();
    expect(accessoryMounted).not.toHaveBeenCalled();
    expect(rail().textContent).not.toContain("492/1");
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
      await screen.findByRole("menuitem", { name: "Customize rail" }),
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

  it("customizes the rail from a popover beside it without leaving Settings", async () => {
    renderRail(THREAD_PATH);
    fireEvent.click(railButton("Settings"));

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize rail" }),
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

  it("opens the customize popover at the top of the rail and keeps it there while More moves", async () => {
    renderRail(THREAD_PATH);
    let moreTop = 200;
    vi.spyOn(railButton("Home"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(12, 40, 28, 28),
    );
    vi.spyOn(railButton("More"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(12, moreTop, 28, 28),
    );

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize rail" }),
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

  it("opens the More menu at the top of the rail instead of beside the More button", async () => {
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
        expect(wrapper.style.transform).toBe("translate(52px, 40px)"),
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

  it("offers no New thread row in Customize rail", async () => {
    renderRail(THREAD_PATH);

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Customize rail" }),
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
