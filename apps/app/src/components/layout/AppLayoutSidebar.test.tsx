// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
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

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    AppSidebar: () => <Sidebar>App sidebar</Sidebar>,
  };
});

vi.mock("@/components/settings/SettingsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    SettingsSidebar: () => <Sidebar>Settings sidebar</Sidebar>,
  };
});

vi.mock("@/components/tools/ToolsSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    ToolsSidebar: () => <Sidebar>Tools sidebar</Sidebar>,
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

function SidebarModeHarness() {
  const [mode, setMode] = useState<AppLayoutSidebarMode>("app");
  const closeMobileSidebar = useCloseMobileSidebar();
  const navigate = (nextMode: AppLayoutSidebarMode) => {
    closeMobileSidebar();
    setMode(nextMode);
  };

  return (
    <>
      <button type="button" onClick={() => navigate("settings")}>
        Navigate to settings
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
});

describe("AppLayoutSidebar mobile mode transitions", () => {
  it("waits for the current drawer to close before swapping sidebar modes", () => {
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

    const appPanel = getMobilePanel();
    expect(appPanel.dataset.state).toBe("open");
    expect(appPanel.textContent).toContain("App sidebar");

    fireEvent.click(
      screen.getByRole("button", { name: "Navigate to settings" }),
    );

    // The route/mode changes immediately, but the currently visible panel
    // remains mounted for its one compositor-driven close.
    expect(getMobilePanel()).toBe(appPanel);
    expect(appPanel.textContent).toContain("App sidebar");
    expect(appPanel.style.translate).toBe("-100%");

    settleMobileToggle();

    const settingsPanel = getMobilePanel();
    expect(settingsPanel).not.toBe(appPanel);
    expect(settingsPanel.dataset.state).toBe("closed");
    expect(settingsPanel.textContent).toContain("Settings sidebar");

    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();
    expect(getMobilePanel().dataset.state).toBe("open");

    const reopenedSettingsPanel = getMobilePanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Navigate back to app" }),
    );

    expect(getMobilePanel()).toBe(reopenedSettingsPanel);
    expect(reopenedSettingsPanel.textContent).toContain("Settings sidebar");
    expect(reopenedSettingsPanel.style.translate).toBe("-100%");

    settleMobileToggle();

    const returnedAppPanel = getMobilePanel();
    expect(returnedAppPanel).not.toBe(reopenedSettingsPanel);
    expect(returnedAppPanel.dataset.state).toBe("closed");
    expect(returnedAppPanel.textContent).toContain("App sidebar");
  });

  it("swaps modes immediately when navigation does not close the drawer", () => {
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

    const appPanel = getMobilePanel();
    expect(appPanel.dataset.state).toBe("open");
    expect(appPanel.textContent).toContain("App sidebar");

    fireEvent.click(
      screen.getByRole("button", { name: "Change route without closing" }),
    );

    const settingsPanel = getMobilePanel();
    expect(settingsPanel).not.toBe(appPanel);
    expect(settingsPanel.dataset.state).toBe("open");
    expect(settingsPanel.textContent).toContain("Settings sidebar");
  });
});
