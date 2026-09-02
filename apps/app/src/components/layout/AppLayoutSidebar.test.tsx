// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
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

const mountCounts = vi.hoisted(() => ({ appSidebar: 0 }));

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  const { useEffect } = await vi.importActual<typeof import("react")>("react");
  return {
    AppSidebar: ({ mobileHosted }: { mobileHosted?: { hidden: boolean } }) => {
      useEffect(() => {
        mountCounts.appSidebar += 1;
      }, []);
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

vi.mock("@/components/settings/SettingsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    SettingsSidebar: ({ mobileHosted }: { mobileHosted?: boolean }) =>
      mobileHosted ? (
        <div data-testid="settings-sidebar-body">Settings sidebar</div>
      ) : (
        <Sidebar>Settings sidebar</Sidebar>
      ),
  };
});

vi.mock("@/components/plugin/PluginsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    PluginsSidebar: ({ mobileHosted }: { mobileHosted?: boolean }) =>
      mobileHosted ? (
        <div data-testid="plugins-sidebar-body">Plugins sidebar</div>
      ) : (
        <Sidebar>Plugins sidebar</Sidebar>
      ),
  };
});

vi.mock("@/components/tools/SkillsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    SkillsSidebar: ({ mobileHosted }: { mobileHosted?: boolean }) =>
      mobileHosted ? (
        <div data-testid="skills-sidebar-body">Skills sidebar</div>
      ) : (
        <Sidebar>Skills sidebar</Sidebar>
      ),
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
}: {
  onMode?: (mode: AppLayoutSidebarMode) => void;
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

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to skills" }),
    );
    expect(screen.getByText("Skills sidebar")).toBeTruthy();
    expect(screen.queryByText("Plugins sidebar")).toBeNull();
  });
});
