// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarProvider,
  SidebarTrigger,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar";
import {
  AppLayoutSidebar,
  type AppLayoutSidebarMode,
} from "./AppLayoutSidebar";

vi.mock("@/components/sidebar/useSidebarThreadReveal", () => ({
  useSidebarThreadReveal: () => {},
}));

const mountCounts = vi.hoisted(() => ({ appSidebar: 0 }));

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    AppSidebar: ({
      mobileHosted,
      navRail,
    }: {
      mobileHosted?: { hidden: boolean };
      navRail?: { hidden: boolean; rail: ReactNode; alternateBody: ReactNode };
    }) => {
      useEffect(() => {
        mountCounts.appSidebar += 1;
      }, []);
      if (navRail) {
        return (
          <Sidebar>
            {navRail.rail}
            <div data-testid="app-sidebar-body" hidden={navRail.hidden}>
              App sidebar
            </div>
            {navRail.alternateBody}
          </Sidebar>
        );
      }
      if (mobileHosted) {
        return (
          <div data-testid="app-sidebar-body" hidden={mobileHosted.hidden}>
            App sidebar
          </div>
        );
      }
      return <Sidebar>App sidebar</Sidebar>;
    },
  };
});

vi.mock("@/components/sidebar/AppNavRail", () => ({
  AppNavRail: ({
    isAppMode,
    isSettingsActive,
  }: {
    isAppMode: boolean;
    isSettingsActive: boolean;
  }) => (
    <div
      data-testid="app-nav-rail"
      data-app-mode={isAppMode}
      data-settings-active={isSettingsActive}
    />
  ),
}));

vi.mock("@/components/settings/SettingsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    SettingsSidebar: ({
      mobileHosted,
      navRailHosted,
    }: {
      mobileHosted?: boolean;
      navRailHosted?: boolean;
    }) =>
      mobileHosted || navRailHosted ? (
        <div data-testid="settings-sidebar-body">Settings sidebar</div>
      ) : (
        <Sidebar>Settings sidebar</Sidebar>
      ),
  };
});

vi.mock("@/components/tools/ResourceSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    ResourceSidebar: ({
      mobileHosted,
      navRailHosted,
      workspace,
    }: {
      mobileHosted?: boolean;
      navRailHosted?: boolean;
      workspace: "plugins" | "skills";
    }) => {
      const title =
        workspace === "plugins" ? "Plugins sidebar" : "Skills sidebar";
      return mobileHosted || navRailHosted ? (
        <div data-testid={`${workspace}-sidebar-body`}>{title}</div>
      ) : (
        <Sidebar>{title}</Sidebar>
      );
    },
  };
});

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

function SidebarModeHarness({
  onMode,
  navigationRail = false,
}: {
  onMode?: (mode: AppLayoutSidebarMode) => void;
  navigationRail?: boolean;
}) {
  const [mode, setMode] = useState<AppLayoutSidebarMode>("app");
  const closeMobileSidebar = useCloseMobileSidebar();
  useEffect(() => {
    onMode?.(mode);
  }, [mode, onMode]);
  const navigate = (nextMode: AppLayoutSidebarMode) => {
    closeMobileSidebar();
    setMode(nextMode);
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
        navigationRail={navigationRail}
        onResizeMouseDown={() => {}}
        isResizing={false}
        appRoutePath="/"
        settingsRoutePath="/settings"
        toolsBackRoutePath="/"
      />
      <SidebarTrigger />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mountCounts.appSidebar = 0;
});

describe("AppLayoutSidebar mobile mode transitions", () => {
  it("keeps one drawer panel and the app sidebar mounted across resource round trips", () => {
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
    expect(panel.dataset.state).toBe("open");
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(mountCounts.appSidebar).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to settings" }),
    );

    expect(getMobilePanel()).toBe(panel);
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(getShelfRevealTranslate()).toBe("0px");

    settleMobileToggle();

    expect(getMobilePanel()).toBe(panel);
    expect(panel.dataset.state).toBe("closed");
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
    expect(screen.queryByTestId("plugins-sidebar-body")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(mountCounts.appSidebar).toBe(1);
  });

  it("swaps bodies immediately when navigation does not close the drawer", () => {
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
    expect(panel.dataset.state).toBe("open");
    expect(getAppSidebarBody().hidden).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );

    expect(getMobilePanel()).toBe(panel);
    expect(panel.dataset.state).toBe("open");
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();
  });

  it("keeps separate sidebar shells per mode on wide viewports", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <SidebarModeHarness />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    expect(screen.getByText("App sidebar")).toBeTruthy();
    expect(screen.queryByTestId("app-sidebar-body")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );

    expect(screen.getByText("Settings sidebar")).toBeTruthy();
    expect(screen.queryByText("App sidebar")).toBeNull();
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to plugins" }),
    );
    expect(screen.getByText("Plugins sidebar")).toBeTruthy();
    expect(screen.queryByText("Skills sidebar")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Navigate to skills" }));
    expect(screen.getByText("Skills sidebar")).toBeTruthy();
    expect(screen.queryByText("Plugins sidebar")).toBeNull();
  });

  it("keeps the rail and the app sidebar mounted while the body swaps in rail mode", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarProvider>
          <SidebarModeHarness navigationRail />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    const rail = screen.getByTestId("app-nav-rail");
    expect(rail.dataset.appMode).toBe("true");
    expect(rail.dataset.settingsActive).toBe("false");
    expect(getAppSidebarBody().hidden).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );
    expect(screen.getByTestId("app-nav-rail")).toBe(rail);
    expect(rail.dataset.appMode).toBe("false");
    expect(rail.dataset.settingsActive).toBe("true");
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to plugins" }),
    );
    expect(screen.getByTestId("app-nav-rail")).toBe(rail);
    expect(rail.dataset.settingsActive).toBe("false");
    expect(screen.queryByTestId("settings-sidebar-body")).toBeNull();
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Navigate to skills" }));
    expect(screen.queryByTestId("plugins-sidebar-body")).toBeNull();
    expect(screen.getByTestId("skills-sidebar-body")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate back to app" }),
    );
    expect(screen.getByTestId("app-nav-rail")).toBe(rail);
    expect(screen.queryByTestId("skills-sidebar-body")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
    expect(mountCounts.appSidebar).toBe(1);
    expect(document.querySelectorAll('[data-sidebar="panel"]')).toHaveLength(1);
  });

  it("leaves the compact drawer without a rail when the experiment is on", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarProvider>
          <SidebarModeHarness navigationRail />
        </SidebarProvider>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();

    expect(screen.queryByTestId("app-nav-rail")).toBeNull();
    expect(getAppSidebarBody().hidden).toBe(false);
  });
});
