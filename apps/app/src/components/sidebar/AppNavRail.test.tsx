// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
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
import {
  getPluginPanelRoutePath,
  getThreadRoutePath,
  isPluginsRoutePath,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import { AppNavRail, NavRailNewThreadButton } from "./AppNavRail";
import { SidebarNavigationModelProvider } from "./SidebarNavigationModel";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  onNewChat: vi.fn(),
  onOpenCustomize: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
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

function RailHarness() {
  const location = useLocation();
  const isSettings = location.pathname.startsWith(SETTINGS_ROUTE_PATH);
  const isAppMode = !isSettings && !isPluginsRoutePath(location.pathname);
  return (
    <SidebarNavigationModelProvider
      onNewChat={mocks.onNewChat}
      onOpenCustomize={mocks.onOpenCustomize}
      splitEnabled={false}
    >
      <AppNavRail
        isAppMode={isAppMode}
        isSettingsActive={isSettings}
        settingsRoutePath={SETTINGS_ROUTE_PATH}
      />
      <NavRailNewThreadButton />
      <output data-testid="pathname">{location.pathname}</output>
    </SidebarNavigationModelProvider>
  );
}

function renderRail(
  initialPath: string,
  options: { visibleKeys?: string[] } = {},
) {
  const store = createStore();
  if (options.visibleKeys) {
    store.set(pluginNavPanelOrderAtom, ALL_KEYS);
    store.set(pluginNavVisiblePanelKeysAtom, options.visibleKeys);
  }
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <TooltipProvider>
          <SidebarProvider>
            <RailHarness />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function rail(): HTMLElement {
  return screen.getByTestId("app-nav-rail");
}

function railButton(name: string): HTMLElement {
  const button = Array.from(rail().querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Expected a rail button named ${name}`);
  return button;
}

function railLabels(): (string | null)[] {
  return Array.from(rail().querySelectorAll("button"), (button) =>
    button.getAttribute("aria-label"),
  );
}

function currentRailLabels(): (string | null)[] {
  return Array.from(
    rail().querySelectorAll('button[aria-current="page"]'),
    (button) => button.getAttribute("aria-label"),
  );
}

function pathname(): string | null {
  return screen.getByTestId("pathname").textContent;
}

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

  it("returns Home to the last thread, skipping plugin panels and Settings visited since", () => {
    renderRail(THREAD_PATH);

    fireEvent.click(railButton("Docs"));
    fireEvent.click(railButton("Settings"));
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

  it("keeps hidden destinations out of the rail", () => {
    renderRail(THREAD_PATH, {
      visibleKeys: ["__bb__/new-thread", "__bb__/extensions"],
    });

    expect(railLabels()).toEqual(["Home", "Plugins", "More", "Settings"]);
  });

  it("keeps hidden destinations reachable from More and opens Customize from Settings by going Home first", async () => {
    renderRail(THREAD_PATH);
    fireEvent.click(railButton("Settings"));

    fireEvent.keyDown(railButton("More"), { key: "Enter" });
    expect(
      await screen.findByRole("menuitem", { name: "Search threads" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Customize sidebar" }),
    );

    expect(mocks.onOpenCustomize).toHaveBeenCalledTimes(1);
    expect(pathname()).toBe(THREAD_PATH);
  });

  it("drops the header New thread button when the user hid New thread", () => {
    renderRail(THREAD_PATH, { visibleKeys: ["__bb__/extensions"] });

    expect(screen.queryByRole("button", { name: "New thread" })).toBeNull();
    cleanup();

    renderRail(THREAD_PATH);
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(mocks.onNewChat).toHaveBeenCalledTimes(1);
  });
});
