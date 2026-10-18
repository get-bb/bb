// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { startTransition, useState, type ReactNode } from "react";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePluginId } from "@/components/plugin/plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarProvider,
  SidebarTrigger,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar";
import {
  sidebarNavigationPlacement,
  sidebarNavigationProviderAtom,
  type ResolvedSidebarNavigation,
} from "@/components/sidebar/sidebarNavigationProvider";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { registerNavigationPlugin } from "@/test/fixtures/navigation-plugin";
import {
  AppLayoutSidebar,
  type AppLayoutSidebarMode,
} from "./AppLayoutSidebar";

vi.mock("@/views/useMobileRecentsThreadReveal", () => ({
  useMobileRecentsThreadReveal: () => {},
}));

const mountCounts = vi.hoisted(() => ({ appSidebar: 0 }));

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    AppSidebar: ({
      isBodyHidden,
      isSettingsActive,
      navigation,
      alternateBody,
    }: {
      isBodyHidden: boolean;
      isSettingsActive: boolean;
      navigation: ResolvedSidebarNavigation;
      alternateBody: ReactNode;
    }) => {
      useEffect(() => {
        mountCounts.appSidebar += 1;
      }, []);
      const placement = sidebarNavigationPlacement(navigation);
      return (
        <Sidebar>
          {placement === "rail" ? <div data-testid="app-nav-rail" /> : null}
          <div
            data-testid="app-sidebar-body"
            data-navigation-placement={placement}
            hidden={isBodyHidden}
          >
            App sidebar
          </div>
          {alternateBody}
          {placement === "rail" ? (
            <button
              data-testid="settings-footer"
              data-settings-active={isSettingsActive}
            />
          ) : null}
        </Sidebar>
      );
    },
  };
});

vi.mock("@/components/settings/SettingsSidebar", () => ({
  SettingsSidebar: ({ backTo }: { backTo: string | null }) => (
    <div data-testid="settings-sidebar-body" data-back-to={backTo ?? ""}>
      Settings sidebar
    </div>
  ),
}));

vi.mock("@/components/tools/ResourceSidebar", () => ({
  ResourceSidebar: ({
    workspace,
    backTo,
  }: {
    workspace: "plugins" | "skills";
    backTo: string | null;
  }) => (
    <div data-testid={`${workspace}-sidebar-body`} data-back-to={backTo ?? ""}>
      {workspace === "plugins" ? "Plugins sidebar" : "Skills sidebar"}
    </div>
  ),
}));

const MOBILE_TOGGLE_SETTLE_MS = 220;

function settleMobileToggle() {
  act(() => {
    vi.advanceTimersByTime(MOBILE_TOGGLE_SETTLE_MS);
  });
}

function getMobilePanel(): HTMLElement {
  const panel = document.querySelector('[data-sidebar="panel"]');
  if (!(panel instanceof HTMLElement)) {
    throw new Error("Expected the mobile sidebar panel");
  }
  return panel;
}

function getShelfRevealTranslate(): string {
  const backdrop = document.querySelector("[data-sidebar-mobile-backdrop]");
  if (!(backdrop instanceof HTMLElement)) {
    throw new Error("Expected the mobile sidebar backdrop");
  }
  return backdrop.style.translate;
}

function getAppSidebarBody(): HTMLElement {
  return screen.getByTestId("app-sidebar-body");
}

function SidebarModeHarness() {
  const [mode, setMode] = useState<AppLayoutSidebarMode>("app");
  const closeMobileSidebar = useCloseMobileSidebar();
  const navigate = (nextMode: AppLayoutSidebarMode) => {
    closeMobileSidebar();
    startTransition(() => {
      setMode(nextMode);
    });
  };

  return (
    <>
      <button type="button" onClick={() => navigate("settings")}>
        Navigate to settings
      </button>
      <button type="button" onClick={() => navigate("plugins")}>
        Navigate to plugins
      </button>
      <button type="button" onClick={() => navigate("skills")}>
        Navigate to skills
      </button>
      <button type="button" onClick={() => navigate("app")}>
        Navigate back to app
      </button>
      <button type="button" onClick={() => setMode("settings")}>
        Change route without closing
      </button>
      <AppLayoutSidebar
        mode={mode}
        onResizeMouseDown={() => {}}
        isResizing={false}
        settingsRoutePath="/settings"
        backToAppRoutePath={mode === "app" ? null : "/"}
      />
      <SidebarTrigger />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  mountCounts.appSidebar = 0;
  window.localStorage.clear();
});

function getRail(): HTMLElement {
  return screen.getByTestId("app-nav-rail");
}

describe("AppLayoutSidebar", () => {
  it("holds the body of a closing compact drawer until it has settled, keeping one panel, the rail, and the app sidebar mounted", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <SidebarModeHarness />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();

    const panel = getMobilePanel();
    const rail = getRail();
    expect(panel.dataset.state).toBe("open");
    expect(panel.contains(rail)).toBe(true);
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(mountCounts.appSidebar).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to settings" }),
    );

    expect(getMobilePanel()).toBe(panel);
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "true",
    );
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(getShelfRevealTranslate()).toBe("0px");

    settleMobileToggle();

    expect(getMobilePanel()).toBe(panel);
    expect(panel.dataset.state).toBe("closed");
    expect(getRail()).toBe(rail);
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "true",
    );
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body").textContent).toBe(
      "Settings sidebar",
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();
    expect(getMobilePanel().dataset.state).toBe("open");

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to plugins" }),
    );
    settleMobileToggle();
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();
    expect(screen.queryByTestId("skills-sidebar-body")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();
    fireEvent.click(
      screen.getByRole("button", { name: "Navigate back to app" }),
    );

    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(getShelfRevealTranslate()).toBe("0px");

    settleMobileToggle();

    expect(getMobilePanel()).toBe(panel);
    expect(getRail()).toBe(rail);
    expect(screen.queryByTestId("plugins-sidebar-body")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(mountCounts.appSidebar).toBe(1);
  });

  it("swaps the body beside the rail immediately when navigation leaves the compact drawer open", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <SidebarModeHarness />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();

    const panel = getMobilePanel();
    const rail = getRail();
    expect(panel.dataset.state).toBe("open");
    expect(getAppSidebarBody().hidden).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );

    expect(getMobilePanel()).toBe(panel);
    expect(panel.dataset.state).toBe("open");
    expect(getRail()).toBe(rail);
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "true",
    );
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();
  });

  it("keeps the rail and the app sidebar mounted while the body swaps on wide viewports", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <SidebarModeHarness />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const rail = getRail();
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "false",
    );
    expect(getAppSidebarBody().hidden).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );
    expect(getRail()).toBe(rail);
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "true",
    );
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to plugins" }),
    );
    expect(getRail()).toBe(rail);
    expect(screen.getByTestId("settings-footer").dataset.settingsActive).toBe(
      "false",
    );
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Navigate to skills" }));
    expect(screen.queryByTestId("plugins-sidebar-body")).toBeNull();
    expect(screen.getByTestId("skills-sidebar-body")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate back to app" }),
    );
    expect(getRail()).toBe(rail);
    expect(screen.queryByTestId("skills-sidebar-body")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(mountCounts.appSidebar).toBe(1);
    expect(document.querySelectorAll('[data-sidebar="panel"]')).toHaveLength(1);
  });

  it("drops the rail in the top list layout and gives Settings a row back to the app", async () => {
    await registerNavigationPlugin();
    const store = createStore();
    store.set(sidebarNavigationProviderAtom, "navigation/top-list");
    render(
      <Provider store={store}>
        <CompactViewportOverrideProvider isCompactViewport={false}>
          <SidebarProvider>
            <SidebarModeHarness />
          </SidebarProvider>
        </CompactViewportOverrideProvider>
      </Provider>,
    );

    expect(screen.queryByTestId("app-nav-rail")).toBeNull();
    expect(screen.queryByTestId("settings-footer")).toBeNull();
    expect(getAppSidebarBody().dataset.navigationPlacement).toBe("list");

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );

    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body").dataset.backTo).toBe(
      "/",
    );
  });
});

function panelSidebar(
  subPath: string,
  component = ScopedHomeNavigation,
  generation = 1,
) {
  const panel: PluginNavPanelSlot = {
    pluginId: "home",
    id: "home",
    title: "Home",
    path: "home",
    icon: "House",
    component: () => null,
    generation,
    experimental_sidebar: component,
  };
  return { panel, subPath };
}
function ScopedHomeNavigation({ subPath }: { subPath: string }) {
  const pluginId = usePluginId();
  return (
    <nav aria-label="Home navigation">
      {pluginId}:{subPath}
    </nav>
  );
}
function routeSidebar(
  target?: ReturnType<typeof panelSidebar>,
  mode: AppLayoutSidebarMode = "app",
  compact = false,
) {
  return (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <SidebarProvider>
        <AppLayoutSidebar
          mode={mode}
          pluginSidebar={target}
          onResizeMouseDown={() => {}}
          isResizing={false}
          settingsRoutePath="/settings"
          backToAppRoutePath={null}
        />
        <SidebarTrigger />
      </SidebarProvider>
    </CompactViewportOverrideProvider>
  );
}
describe("navigation panel sidebar composition", () => {
  it("keeps the scoped body during compact drawer closing and restores native navigation after settling", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      routeSidebar(panelSidebar("inbox"), "app", true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();
    const panel = getMobilePanel();
    const rail = getRail();
    expect(panel.dataset.state).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    rerender(routeSidebar(undefined, "app", true));
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }),
    ).toBeTruthy();
    expect(getAppSidebarBody().hidden).toBe(true);
    settleMobileToggle();
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(getMobilePanel()).toBe(panel);
    expect(panel.dataset.state).toBe("closed");
    expect(getRail()).toBe(rail);
    expect(mountCounts.appSidebar).toBe(1);
  });
  it("uses the exact plugin scope/subpath and restores the same native rail/body on leaving or disabling the panel", () => {
    const { rerender } = render(routeSidebar(panelSidebar("inbox")));
    const rail = getRail();
    const native = getAppSidebarBody();
    expect(native.hidden).toBe(true);
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }).textContent,
    ).toBe("home:inbox");
    rerender(routeSidebar(panelSidebar("dashboard")));
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }).textContent,
    ).toBe("home:dashboard");
    expect(getRail()).toBe(rail);
    rerender(routeSidebar());
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
    expect(getAppSidebarBody()).toBe(native);
    expect(native.hidden).toBe(false);
    expect(getRail()).toBe(rail);
    expect(mountCounts.appSidebar).toBe(1);
  });
  it("keeps settings/resources authoritative even if a stale plugin target is supplied", () => {
    const { rerender } = render(
      routeSidebar(panelSidebar("inbox"), "settings"),
    );
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
    rerender(routeSidebar(panelSidebar("inbox"), "plugins"));
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
  });
  it("restores native navigation on a crash, isolates a repeated failed route and retries new input/generation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => {
      throw new Error("Synthetic sidebar crash");
    };
    try {
      const { rerender } = render(routeSidebar(panelSidebar("inbox", Broken)));
      expect(getAppSidebarBody().hidden).toBe(false);
      rerender(routeSidebar(panelSidebar("dashboard")));
      expect(
        screen.getByRole("navigation", { name: "Home navigation" }),
      ).toBeTruthy();
      rerender(routeSidebar(panelSidebar("inbox", Broken)));
      expect(getAppSidebarBody().hidden).toBe(false);
      rerender(routeSidebar(panelSidebar("inbox", ScopedHomeNavigation, 2)));
      expect(getAppSidebarBody().hidden).toBe(true);
      expect(
        screen.getByRole("navigation", { name: "Home navigation" }).textContent,
      ).toBe("home:inbox");
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
