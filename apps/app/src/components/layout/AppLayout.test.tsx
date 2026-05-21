// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
import { afterEach, describe, expect, it } from "vitest";
import { NewManagerDialogProvider } from "@/hooks/useNewManagerDialog";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { AppLayout } from "./AppLayout";
import {
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";

interface RenderAppLayoutArgs {
  desktopInfo: BbDesktopApi | null;
  initialEntry: string;
}

interface TestProvidersProps {
  children: ReactNode;
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
            <QuickCreateProjectProvider>
              <NewManagerDialogProvider>{children}</NewManagerDialogProvider>
            </QuickCreateProjectProvider>
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
              <div>Layout content</div>
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

  it("keeps the normal sidebar trigger and reserves the traffic-light area in desktop sidebar chrome", async () => {
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
    const sidebarTrigger = within(inlineTriggerRow).getByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-window-drag-region")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(1);
    expect(contentShell.className).not.toContain("pt-10");
    expect(sidebarPanel?.className).toContain("md:z-10");
    expect(inlineTriggerRow.className).toContain(MACOS_WINDOW_DRAG_CLASS);
    expect(inlineTriggerRow.className).toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    expect(primaryActions.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
    expect(sidebarTrigger.className).toContain(MACOS_WINDOW_NO_DRAG_CLASS);
    expect(sidebarTrigger.className).toContain(
      MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
    );
  });

  it("uses the normal collapsed header trigger with a traffic-light reserve on desktop", async () => {
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
    const headerSidebarTrigger = within(headerRow).getByRole("button", {
      name: "Toggle Sidebar",
    });
    const sidebarTriggers = screen.getAllByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    expect(screen.queryByTestId("app-sidebar-inline-trigger-row")).toBeNull();
    expect(sidebarTriggers).toHaveLength(1);
    expect(sidebarTriggers[0]).toBe(headerSidebarTrigger);
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
    expect(headerSidebarTrigger.className).toContain(
      MACOS_WINDOW_NO_DRAG_CLASS,
    );
    expect(headerSidebarTrigger.className).toContain(
      MACOS_SIDEBAR_TRIGGER_OFFSET_CLASS,
    );
  });
});
