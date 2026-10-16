// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
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
