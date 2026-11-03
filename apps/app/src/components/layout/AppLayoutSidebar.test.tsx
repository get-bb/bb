// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { startTransition, useState, type ReactNode } from "react";
import { makeThreadWithRuntime } from "@bb/test-helpers/domain-fixtures";
import { threadQueryKey } from "@/hooks/queries/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { resetAppRouteHistoryForTest } from "@/lib/app-route-history";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePluginId } from "@/components/plugin/plugin-context";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
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
import { AppLayoutSidebar } from "./AppLayoutSidebar";
import { resolveRouteSidebar } from "./routeSidebar";

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

vi.mock("@/components/settings/LazySettingsSidebar", () => ({
  LazySettingsSidebar: ({ backTo }: { backTo: string | null }) => (
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
  const [pathname, setPathname] = useState("/");
  const closeMobileSidebar = useCloseMobileSidebar();
  const navigate = (nextPathname: string) => {
    closeMobileSidebar();
    startTransition(() => {
      setPathname(nextPathname);
    });
  };
  const routeSidebar = resolveRouteSidebar(pathname, null);

  return (
    <TooltipProvider>
      <button type="button" onClick={() => navigate("/settings")}>
        Navigate to settings
      </button>
      <button type="button" onClick={() => navigate("/plugins")}>
        Navigate to plugins
      </button>
      <button type="button" onClick={() => navigate("/skills")}>
        Navigate to skills
      </button>
      <button type="button" onClick={() => navigate("/")}>
        Navigate back to app
      </button>
      <button type="button" onClick={() => setPathname("/settings")}>
        Change route without closing
      </button>
      <AppLayoutSidebar
        routeSidebar={routeSidebar}
        isSettingsActive={pathname === "/settings"}
        onResizeMouseDown={() => {}}
        isResizing={false}
        settingsRoutePath="/settings"
        backToAppRoutePath={routeSidebar === null ? null : "/"}
      />
      <SidebarTrigger />
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  mountCounts.appSidebar = 0;
  window.localStorage.clear();
  resetAppRouteHistoryForTest();
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
function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}
function NavigatingHomeNavigation() {
  const navigation = useBbNavigate();
  const [count, setCount] = useState(0);
  return (
    <nav aria-label="Home navigation">
      <button
        onClick={() =>
          navigation.toPluginPanel("home", { subPath: "dashboard" })
        }
      >
        Open dashboard
      </button>
      <a href="/plugins/home/home/dashboard">Dashboard link</a>
      <button onClick={() => navigation.toThread("thr_sidebar")}>
        Open thread
      </button>
      <button onClick={() => navigation.toProject("proj_sidebar")}>
        Open project
      </button>
      <button onClick={() => navigation.toCompose()}>New thread</button>
      <button onClick={() => setCount(count + 1)}>Local action {count}</button>
    </nav>
  );
}
function panelSidebarTree({
  target,
  pathname = "/plugins/home/home/inbox",
  compact = false,
  onResizeMouseDown = vi.fn(),
}: {
  target?: ReturnType<typeof panelSidebar>;
  pathname?: string;
  compact?: boolean;
  onResizeMouseDown?: () => void;
} = {}) {
  const client = new QueryClient();
  client.setQueryData(
    threadQueryKey("thr_sidebar"),
    makeThreadWithRuntime({ id: "thr_sidebar", projectId: "proj_sidebar" }),
  );
  const routeSidebar = resolveRouteSidebar(pathname, target ?? null);
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/plugins/home/home/inbox"]}>
        <RouteNavigationProvider>
          <CompactViewportOverrideProvider isCompactViewport={compact}>
            <SidebarProvider>
              <TooltipProvider>
                <AppLayoutSidebar
                  routeSidebar={routeSidebar}
                  isSettingsActive={pathname === "/settings"}
                  onResizeMouseDown={onResizeMouseDown}
                  isResizing={false}
                  settingsRoutePath="/settings"
                  backToAppRoutePath={routeSidebar === null ? null : "/"}
                />
                <SidebarTrigger />
                <CurrentPath />
              </TooltipProvider>
            </SidebarProvider>
          </CompactViewportOverrideProvider>
        </RouteNavigationProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
describe("navigation panel sidebar composition", () => {
  it.each(["Open dashboard", "Dashboard link"])(
    "closes the compact drawer on actual %s navigation but keeps local actions open",
    (name) => {
      vi.useFakeTimers();
      render(
        panelSidebarTree({
          target: panelSidebar("inbox", NavigatingHomeNavigation),
          compact: true,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
      settleMobileToggle();
      const panel = getMobilePanel();
      fireEvent.click(screen.getByRole("button", { name: "Local action 0" }));
      expect(panel.dataset.state).toBe("open");
      fireEvent.click(screen.getByText(name));
      settleMobileToggle();
      expect(screen.getByTestId("current-path").textContent).toBe(
        "/plugins/home/home/dashboard",
      );
      expect(panel.dataset.state).toBe("closed");
      fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
      settleMobileToggle();
      fireEvent.click(screen.getByText(name));
      settleMobileToggle();
      expect(panel.dataset.state).toBe("closed");
    },
  );
  it.each(["Open thread", "Open project", "New thread"])(
    "closes the compact drawer through the existing SDK %s route",
    (name) => {
      vi.useFakeTimers();
      render(
        panelSidebarTree({
          target: panelSidebar("inbox", NavigatingHomeNavigation),
          compact: true,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
      settleMobileToggle();
      fireEvent.click(screen.getByRole("button", { name }));
      settleMobileToggle();
      expect(getMobilePanel().dataset.state).toBe("closed");
      expect(screen.getByTestId("current-path").textContent).not.toBe(
        "/plugins/home/home/inbox",
      );
    },
  );
  it("restores the host resize handle and calls the native drag handler", () => {
    const onResizeMouseDown = vi.fn();
    render(
      panelSidebarTree({ target: panelSidebar("inbox"), onResizeMouseDown }),
    );
    fireEvent.mouseDown(screen.getByTestId("plugin-sidebar-resize-handle"), {
      clientX: 280,
      button: 0,
    });
    expect(onResizeMouseDown).toHaveBeenCalledOnce();
  });
  it("keeps native header/history controls and navigates back and forward", () => {
    render(
      panelSidebarTree({
        target: panelSidebar("inbox", NavigatingHomeNavigation),
      }),
    );
    expect(screen.getByTestId("plugin-sidebar-top-reserve-row")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Go back" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Open dashboard" }));
    expect(screen.getByTestId("current-path").textContent).toBe(
      "/plugins/home/home/dashboard",
    );
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByTestId("current-path").textContent).toBe(
      "/plugins/home/home/inbox",
    );
    fireEvent.click(screen.getByRole("button", { name: "Go forward" }));
    expect(screen.getByTestId("current-path").textContent).toBe(
      "/plugins/home/home/dashboard",
    );
  });
  it("gives the panel sidebar the same row back to the app as Settings in the top list layout", async () => {
    await registerNavigationPlugin();
    const store = createStore();
    store.set(sidebarNavigationProviderAtom, "navigation/top-list");
    render(
      <Provider store={store}>
        {panelSidebarTree({ target: panelSidebar("inbox") })}
      </Provider>,
    );
    expect(getAppSidebarBody().hidden).toBe(true);
    expect(
      screen.getByRole("link", { name: "Back to app" }).getAttribute("href"),
    ).toBe("/");
    expect(screen.getByText("Home")).toBeTruthy();
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }).textContent,
    ).toBe("home:inbox");
  });
  it("keeps the scoped body during compact drawer closing and restores native navigation after settling", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      panelSidebarTree({ target: panelSidebar("inbox"), compact: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    settleMobileToggle();
    const panel = getMobilePanel();
    const rail = getRail();
    expect(panel.dataset.state).toBe("open");
    fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    rerender(panelSidebarTree({ compact: true }));
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
    const { rerender } = render(
      panelSidebarTree({ target: panelSidebar("inbox") }),
    );
    const rail = getRail();
    const native = getAppSidebarBody();
    expect(native.hidden).toBe(true);
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }).textContent,
    ).toBe("home:inbox");
    rerender(panelSidebarTree({ target: panelSidebar("dashboard") }));
    expect(
      screen.getByRole("navigation", { name: "Home navigation" }).textContent,
    ).toBe("home:dashboard");
    expect(getRail()).toBe(rail);
    rerender(panelSidebarTree());
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
      panelSidebarTree({
        target: panelSidebar("inbox"),
        pathname: "/settings",
      }),
    );
    expect(screen.getByTestId("settings-sidebar-body")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
    rerender(
      panelSidebarTree({ target: panelSidebar("inbox"), pathname: "/plugins" }),
    );
    expect(screen.getByTestId("plugins-sidebar-body")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Home navigation" }),
    ).toBeNull();
  });
  it("contains a crash inside the panel sidebar and retries on new input or generation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const Broken = () => {
      throw new Error("Synthetic sidebar crash");
    };
    try {
      const { rerender } = render(
        panelSidebarTree({ target: panelSidebar("inbox", Broken) }),
      );
      const rail = getRail();
      expect(getAppSidebarBody().hidden).toBe(true);
      expect(screen.getByText("plugin home crashed")).toBeTruthy();
      rerender(panelSidebarTree({ target: panelSidebar("dashboard") }));
      expect(
        screen.getByRole("navigation", { name: "Home navigation" }),
      ).toBeTruthy();
      rerender(panelSidebarTree({ target: panelSidebar("inbox", Broken) }));
      expect(screen.getByText("plugin home crashed")).toBeTruthy();
      rerender(
        panelSidebarTree({
          target: panelSidebar("inbox", ScopedHomeNavigation, 2),
        }),
      );
      expect(
        screen.getByRole("navigation", { name: "Home navigation" }).textContent,
      ).toBe("home:inbox");
      expect(getRail()).toBe(rail);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
