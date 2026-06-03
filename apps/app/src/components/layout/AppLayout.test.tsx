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
import { Suspense, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  BbDesktopApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
  SystemConfigResponse,
} from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { AppLayout } from "./AppLayout";
import {
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";

interface RenderAppLayoutArgs {
  children?: ReactNode;
  desktopInfo: BbDesktopApi | null;
  initialEntry: string;
}

interface TestProvidersProps {
  children: ReactNode;
}

interface SidebarResizeEndScenario {
  name: string;
  finishDrag: () => void;
}

const testSystemConfig: SystemConfigResponse = {
  featureFlags: {
    askUserQuestion: false,
    terminals: false,
  },
  hostDaemonPort: null,
  voiceTranscriptionEnabled: false,
};

function createBbDesktopApi(info: BbDesktopInfo): BbDesktopApi {
  return {
    ...info,
    browser: createNoopDesktopBrowserApi(),
    async checkForUpdates() {
      return info;
    },
    async getInfo() {
      return info;
    },
    async installUpdate() {
      return undefined;
    },
    onChange(_listener: BbDesktopInfoChangeHandler) {
      return () => undefined;
    },
    setTheme() {
      // no-op
    },
  };
}

function setBbDesktopInfo(desktopInfo: BbDesktopApi | null): void {
  if (desktopInfo === null) {
    delete window.bbDesktop;
    return;
  }
  window.bbDesktop = desktopInfo;
}

function installProjectRoutes(): void {
  installFetchRoutes([
    {
      pathname: "/api/v1/projects",
      handler: () => jsonResponse([]),
    },
    {
      pathname: "/api/v1/system/config",
      handler: () => jsonResponse(testSystemConfig),
    },
  ]);
}

async function renderAppLayout(args: RenderAppLayoutArgs): Promise<void> {
  setBbDesktopInfo(args.desktopInfo);
  installProjectRoutes();

  const { wrapper: QueryClientTestWrapper } = createQueryClientTestHarness();

  function TestProviders({ children }: TestProvidersProps) {
    return (
      <QueryClientTestWrapper>
        <MemoryRouter initialEntries={[args.initialEntry]}>
          <Suspense fallback={null}>
            <QuickCreateProjectProvider>{children}</QuickCreateProjectProvider>
          </Suspense>
        </MemoryRouter>
      </QueryClientTestWrapper>
    );
  }

  await act(async () => {
    render(
      <Routes>
        <Route
          path="*"
          element={
            <AppLayout>
              {args.children ?? <div>Layout content</div>}
            </AppLayout>
          }
        />
      </Routes>,
      { wrapper: TestProviders },
    );
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  setBbDesktopInfo(null);
});

describe("AppLayout desktop chrome", () => {
  it("keeps the browser layout when the desktop preload global is absent", async () => {
    await renderAppLayout({ desktopInfo: null, initialEntry: "/settings" });

    const sidebarTriggers = await screen.findAllByRole("button", {
      name: "Toggle Sidebar",
    });
    const headerRow = screen.getByTestId("app-page-header-content-row");

    expect(sidebarTriggers).toHaveLength(1);
    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-window-drag-region")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    expect(screen.queryByTestId("app-desktop-sidebar-trigger")).toBeNull();
    expect(screen.queryByTestId("app-page-header-trigger-spacer")).toBeNull();
    expect(
      screen.getByTestId("app-sidebar-inline-trigger-row").className,
    ).not.toContain(MACOS_TRAFFIC_LIGHT_RESERVE_CLASS);
    expect(
      screen.getByTestId("app-sidebar-primary-actions").className,
    ).not.toContain(MACOS_TRAFFIC_LIGHT_RESERVE_CLASS);
    expect(headerRow.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    expect(headerRow.className).not.toContain(
      MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
    );
    expect(headerRow.parentElement?.className).not.toContain(
      MACOS_WINDOW_DRAG_CLASS,
    );
  });

  it("renders root with project-style header spacing in browser layout", async () => {
    await renderAppLayout({ desktopInfo: null, initialEntry: "/" });

    const headerRow = await screen.findByTestId("app-page-header-content-row");
    const header = headerRow.parentElement;

    expect(header?.className).toContain("h-12");
    expect(header?.className).not.toContain("border-b");
    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(1);
  });

  it("pins the sidebar trigger at the window root while the expanded sidebar row stays a drag spacer in desktop chrome", async () => {
    await renderAppLayout({
      desktopInfo: createBbDesktopApi({
        lastCheckedAt: null,
        latestVersion: null,
        pendingVersion: null,
        platform: "macos",
        updateAvailable: false,
        updateDownloaded: false,
        version: "0.0.1",
      }),
      initialEntry: "/",
    });

    await screen.findByRole("button", { name: "Toggle Sidebar" });
    const contentShell = screen.getByTestId("app-layout-content-shell");
    const inlineTriggerRow = screen.getByTestId(
      "app-sidebar-inline-trigger-row",
    );
    const primaryActions = screen.getByTestId("app-sidebar-primary-actions");
    const sidebarPanel = document.querySelector("[data-sidebar='panel']");
    const overlay = screen.getByTestId("app-desktop-sidebar-trigger");
    const sidebarTrigger = within(overlay).getByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-window-drag-region")).toBeNull();
    // The pinned overlay is the only toggle; the sidebar's top row no longer
    // hosts one (it just clears the traffic lights and stays draggable).
    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(1);
    expect(
      within(inlineTriggerRow).queryByRole("button", {
        name: "Toggle Sidebar",
      }),
    ).toBeNull();
    expect(contentShell.className).not.toContain("pt-10");
    expect(sidebarPanel?.className).toContain("md:z-10");
    expect(inlineTriggerRow.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    expect(inlineTriggerRow.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    expect(primaryActions.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    // Overlay wrapper is offset clear of the traffic lights and stays a
    // window-drag region; only the button itself is no-drag, so the title
    // strip above/below the shorter button stays draggable instead of
    // becoming an oversized dead zone.
    expect(overlay.className).toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
    );
    expect(overlay.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    expect(overlay.className).not.toContain(MACOS_APP_REGION_NO_DRAG_CLASS);
    expect(sidebarTrigger.className).toContain(MACOS_WINDOW_NO_DRAG_CLASS);
    expect(sidebarTrigger.className).toContain(
      MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
    );
  });

  it("keeps the pinned trigger and reserves its footprint in the collapsed header on desktop", async () => {
    await renderAppLayout({
      desktopInfo: createBbDesktopApi({
        lastCheckedAt: null,
        latestVersion: null,
        pendingVersion: null,
        platform: "macos",
        updateAvailable: false,
        updateDownloaded: false,
        version: "0.0.1",
      }),
      initialEntry: "/projects/proj_desktop",
    });

    const initialSidebarTrigger = await screen.findByRole("button", {
      name: "Toggle Sidebar",
    });

    fireEvent.click(initialSidebarTrigger);

    const headerRow = screen.getByTestId("app-page-header-content-row");
    const overlay = screen.getByTestId("app-desktop-sidebar-trigger");
    const sidebarTrigger = within(overlay).getByRole("button", {
      name: "Toggle Sidebar",
    });
    const triggerSpacer = screen.getByTestId("app-page-header-trigger-spacer");
    const inlineTriggerRow = screen.getByTestId(
      "app-sidebar-inline-trigger-row",
    );
    const sidebarTriggers = screen.getAllByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    // The sidebar's top reserve stays mounted while collapsed so its content
    // (New Thread / New Manager / Projects) holds the same vertical position
    // below the title-bar chrome as when expanded, instead of riding up under
    // the pinned trigger during the collapse animation. It remains a pure
    // window-drag spacer with no second toggle.
    expect(inlineTriggerRow.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    expect(
      within(inlineTriggerRow).queryByRole("button", {
        name: "Toggle Sidebar",
      }),
    ).toBeNull();
    // Collapsing keeps the single pinned overlay toggle. The header reserves
    // the toggle's footprint with a non-interactive spacer instead of a second
    // trigger, so its content lines up the same as when the sidebar is open.
    expect(sidebarTriggers).toHaveLength(1);
    expect(sidebarTriggers[0]).toBe(sidebarTrigger);
    expect(
      within(headerRow).queryByRole("button", { name: "Toggle Sidebar" }),
    ).toBeNull();
    expect(triggerSpacer.getAttribute("aria-hidden")).toBe("true");
    expect(headerRow.contains(triggerSpacer)).toBe(true);
    expect(document.querySelectorAll("[data-sidebar='trigger']")).toHaveLength(
      1,
    );
    expect(headerRow.className).toContain(MACOS_COLLAPSED_HEADER_RESERVE_CLASS);
    expect(headerRow.parentElement?.className).toContain(
      MACOS_WINDOW_DRAG_CLASS,
    );
    expect(headerRow.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    // No-drag is scoped to the button; the offset wrapper stays draggable.
    expect(overlay.className).toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS,
    );
    expect(overlay.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    expect(overlay.className).not.toContain(MACOS_APP_REGION_NO_DRAG_CLASS);
    expect(sidebarTrigger.className).toContain(MACOS_WINDOW_NO_DRAG_CLASS);
    expect(sidebarTrigger.className).toContain(
      MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
    );
  });

  it.each<SidebarResizeEndScenario>([
    {
      name: "mouseup",
      finishDrag: () => {
        fireEvent.mouseUp(window, { clientX: 360 });
      },
    },
    {
      name: "window blur",
      finishDrag: () => {
        fireEvent.blur(window);
      },
    },
    {
      name: "Escape",
      finishDrag: () => {
        fireEvent.keyDown(window, { key: "Escape" });
      },
    },
  ])(
    "shields iframes with a drag overlay while sidebar resize is active and removes it after $name",
    async ({ finishDrag }) => {
      await renderAppLayout({
        desktopInfo: null,
        initialEntry: "/projects/proj_sidebar_resize",
        children: <iframe title="Review Board app" />,
      });

      const appLayoutRoot = await screen.findByTestId("app-layout-root");
      const resizeHandle = screen.getByTestId("app-sidebar-resize-handle");
      const iframe = screen.getByTitle("Review Board app");

      expect(appLayoutRoot.contains(iframe)).toBe(true);
      expect(screen.queryByTestId("iframe-drag-guard-overlay")).toBeNull();

      fireEvent.mouseDown(resizeHandle, {
        buttons: 1,
        clientX: 320,
        clientY: 0,
      });

      await waitFor(() => {
        expect(
          screen.queryByTestId("iframe-drag-guard-overlay"),
        ).not.toBeNull();
      });
      expect(document.body.style.cursor).toBe("col-resize");
      // Regression guard: the drag must be intercepted by the overlay, never by
      // disabling the iframe's pointer-events — that detaches the iframe's
      // compositor scroll node in Chromium and kills wheel-scroll after resize.
      expect(appLayoutRoot.className).not.toContain(
        "[&_iframe]:pointer-events-none",
      );

      finishDrag();

      await waitFor(() => {
        expect(screen.queryByTestId("iframe-drag-guard-overlay")).toBeNull();
      });
      expect(document.body.style.cursor).toBe("");
      expect(document.body.style.userSelect).toBe("");
    },
  );
});
