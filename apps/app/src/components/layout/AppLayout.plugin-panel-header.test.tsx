// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { useWindowRightPanel } from "./WindowRightPanelToggle";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import {
  COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS,
  setCompactSecondaryPanelPresentation,
} from "@/components/ui/secondary-panel-shelf-visibility";

const viewportState = vi.hoisted(() => ({
  compact: false,
  macosChrome: false,
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => viewportState.compact,
  CompactViewportOverrideProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/sidebar/AppSidebar", () => ({
  AppSidebar: () => <aside data-testid="app-sidebar" />,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useUiPreferences: () => ({ data: undefined, isError: false }),
  useSystemConfig: () => ({
    data: {
      experiments: {
        changelogPreview: false,
        serverMove: false,
        performanceDiagnostics: false,
      },
    },
  }),
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
}));

vi.mock("@/hooks/usePluginSafeModeCommands", () => ({
  usePluginSafeModeCommands: () => undefined,
}));

vi.mock("@/lib/plugin-slots", () => ({
  usePluginSlots: () => ({
    appOverlays: [],
    commandPaletteActions: [],
    fileOpeners: [],
    navPanels: [
      {
        pluginId: "helm-wiki",
        path: "wiki",
        title: "Helm Wiki",
        icon: "Book",
      },
    ],
    settingsSections: [],
  }),
}));

vi.mock("@/components/plugin/PluginPanelHeader", () => ({
  PluginPanelHeaderCenter: ({ chrome }: { chrome: { title: string } }) => (
    <span data-testid="plugin-panel-header-center">{chrome.title}</span>
  ),
  PluginPanelHeaderActions: () => null,
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="thread-actions-provider">{children}</div>
  ),
}));

vi.mock("@/components/plugin/PluginAppOverlays", () => ({
  PluginAppOverlays: () => <div data-testid="plugin-app-overlays" />,
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("./AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: ({
    center,
    actions,
  }: {
    center?: ReactNode;
    actions?: ReactNode;
  }) => (
    <header data-testid="app-page-header">
      {center}
      {actions}
    </header>
  ),
}));

vi.mock("@/lib/iframe-drag-guard", () => ({
  IframeDragGuardOverlay: () => null,
}));

vi.mock("@/lib/bb-desktop", () => ({
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS: "",
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => viewportState.macosChrome,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: {
      onOpenChange: vi.fn(),
      target: null,
    },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: () => ({ data: undefined }),
  useThreadDetailBootstrap: () => ({ isError: false, isSuccess: true }),
  useThreadPendingInteractions: () => ({ data: undefined }),
}));

function renderPluginPanelRoute(): void {
  render(
    <MemoryRouter initialEntries={["/plugins/helm-wiki/wiki"]}>
      <AppLayout>
        <div>Plugin panel body</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

function isHiddenByCompactShelf(element: HTMLElement): boolean {
  return (
    COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS.split(" ").every((className) =>
      element.classList.contains(className),
    ) && element.dataset.panelShelf === "full"
  );
}

describe("AppLayout plugin panel header", () => {
  beforeEach(() => {
    viewportState.compact = false;
    viewportState.macosChrome = false;
    setCompactSecondaryPanelPresentation("closed");
  });

  afterEach(() => {
    cleanup();
    setCompactSecondaryPanelPresentation("closed");
    vi.clearAllMocks();
  });

  it("leaves the compact header to the plugin page panel host", () => {
    viewportState.compact = true;
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-page-header")).toBeNull();
  });

  it("leaves the regular header to the plugin page panel host", () => {
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-page-header")).toBeNull();
  });

  it("mounts app overlays inside the app-level thread actions provider", () => {
    renderPluginPanelRoute();

    expect(
      screen
        .getByTestId("thread-actions-provider")
        .contains(screen.getByTestId("plugin-app-overlays")),
    ).toBe(true);
  });

  it("hides the fixed left trigger while the compact panel is open", () => {
    viewportState.compact = true;
    renderPluginPanelRoute();

    const trigger = screen.getByTestId("app-sidebar-trigger-overlay");
    expect(trigger.style.zIndex).toBe(
      String(APP_OVERLAY_LAYER.compactSidebarTrigger),
    );
    expect(Number(trigger.style.zIndex)).toBeGreaterThan(
      APP_OVERLAY_LAYER.secondaryPanelFullPage,
    );
    act(() => setCompactSecondaryPanelPresentation("full"));
    expect(screen.getByTestId("app-sidebar-trigger-overlay")).toBe(trigger);
    expect(isHiddenByCompactShelf(trigger)).toBe(true);

    act(() => setCompactSecondaryPanelPresentation("closed"));
    expect(screen.getByTestId("app-sidebar-trigger-overlay")).not.toBeNull();
    expect(isHiddenByCompactShelf(trigger)).toBe(false);
  });

  it("keeps the fixed left trigger visible while the compact sidebar drawer is open", async () => {
    viewportState.compact = true;
    renderPluginPanelRoute();

    const trigger = screen.getByTestId("app-sidebar-trigger-overlay");
    act(() => setCompactSecondaryPanelPresentation("full"));
    expect(trigger.dataset.panelShelf).toBe("full");

    fireEvent.click(screen.getByRole("button", { name: /^Toggle sidebar/ }));

    await waitFor(() => expect(trigger.dataset.panelShelf).toBeUndefined());
  });

  it("keeps the fixed left trigger visible on wide viewports while a compact panel is showing", () => {
    renderPluginPanelRoute();

    act(() => setCompactSecondaryPanelPresentation("full"));
    expect(
      screen.getByTestId("app-sidebar-trigger-overlay").dataset.panelShelf,
    ).toBeUndefined();
  });

  it("moves the trigger and history controls into a window title bar beside the macOS rail", () => {
    viewportState.macosChrome = true;
    renderPluginPanelRoute();

    const titleBar = screen.getByTestId("app-window-title-bar");
    expect(screen.getByTestId("app-layout-root").dataset.framed).toBe("");
    expect(
      titleBar.contains(
        screen.getByRole("button", { name: /^Toggle sidebar/ }),
      ),
    ).toBe(true);
    expect(
      titleBar.contains(screen.getByRole("button", { name: "Go back" })),
    ).toBe(true);
    expect(screen.queryByTestId("app-desktop-sidebar-trigger")).toBeNull();
  });

  it("adds the right panel toggle to the macOS title bar row only while a page has a right panel", () => {
    viewportState.macosChrome = true;
    function RightPanelPage({ isOpen }: { isOpen: boolean }) {
      useWindowRightPanel({ isOpen, enabled: true });
      return null;
    }
    function renderRoute(page: ReactNode) {
      return (
        <MemoryRouter initialEntries={["/plugins/helm-wiki/wiki"]}>
          <AppLayout>{page}</AppLayout>
        </MemoryRouter>
      );
    }
    const view = render(renderRoute(null));
    expect(screen.queryByTestId("window-right-panel-toggle")).toBeNull();

    view.rerender(renderRoute(<RightPanelPage isOpen={false} />));
    const toggle = screen.getByTestId("window-right-panel-toggle");
    expect(screen.getByTestId("app-window-title-bar").contains(toggle)).toBe(
      true,
    );
    expect(toggle.getAttribute("aria-label")).toBe("Show right panel");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    view.rerender(renderRoute(<RightPanelPage isOpen />));
    expect(
      screen
        .getByTestId("window-right-panel-toggle")
        .getAttribute("aria-label"),
    ).toBe("Hide right panel");

    view.rerender(renderRoute(null));
    expect(screen.queryByTestId("window-right-panel-toggle")).toBeNull();
  });

  it("keeps the sidebar toggle in the rail column and no title bar on wide web, Windows, and Linux windows", () => {
    function RightPanelPage() {
      useWindowRightPanel({ isOpen: false, enabled: true });
      return null;
    }
    render(
      <MemoryRouter initialEntries={["/plugins/helm-wiki/wiki"]}>
        <AppLayout>
          <RightPanelPage />
        </AppLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("app-window-title-bar")).toBeNull();
    expect(screen.queryByTestId("window-right-panel-toggle")).toBeNull();
    expect(screen.getByTestId("app-sidebar-trigger-overlay")).toBeTruthy();
    expect(
      screen.getByTestId("app-layout-root").dataset.framed,
    ).toBeUndefined();
  });

  it("keeps the floating macOS trigger on compact windows", () => {
    viewportState.macosChrome = true;
    viewportState.compact = true;
    renderPluginPanelRoute();

    expect(screen.queryByTestId("app-window-title-bar")).toBeNull();
    expect(screen.getByTestId("app-desktop-sidebar-trigger")).toBeTruthy();
    expect(
      screen.getByTestId("app-layout-root").dataset.framed,
    ).toBeUndefined();
  });
});
