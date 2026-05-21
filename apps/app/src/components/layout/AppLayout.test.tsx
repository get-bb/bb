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
import type { BbDesktopInfo, SystemConfigResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { NewManagerDialogProvider } from "@/hooks/useNewManagerDialog";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { AppLayout } from "./AppLayout";

interface RenderAppLayoutArgs {
  desktopInfo: BbDesktopInfo | null;
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

function setBbDesktopInfo(desktopInfo: BbDesktopInfo | null): void {
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
    await renderAppLayout({ desktopInfo: null, initialEntry: "/" });

    const sidebarTriggers = await screen.findAllByRole("button", {
      name: "Toggle Sidebar",
    });
    expect(sidebarTriggers).toHaveLength(1);
    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-window-drag-region")).toBeNull();
    expect(screen.queryByTestId("bb-desktop-sidebar-trigger")).toBeNull();
    expect(screen.getByTestId("app-sidebar-inline-trigger-row")).toBeTruthy();
  });

  it("floats the desktop sidebar trigger without reserving a title-bar strip", async () => {
    await renderAppLayout({
      desktopInfo: {
        platform: "macos",
        version: "0.0.1",
      },
      initialEntry: "/",
    });

    const dragRegion = await screen.findByTestId(
      "bb-desktop-window-drag-region",
    );
    const floatingTrigger = screen.getByTestId("bb-desktop-sidebar-trigger");
    const contentShell = screen.getByTestId("app-layout-content-shell");
    const sidebarTrigger = within(floatingTrigger).getByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(1);
    expect(screen.queryByTestId("app-sidebar-inline-trigger-row")).toBeNull();
    expect(contentShell.className).not.toContain("pt-10");
    expect(dragRegion.className).toContain("fixed");
    expect(dragRegion.className).toContain("top-0");
    expect(dragRegion.className).toContain("h-7");
    expect(dragRegion.className).toContain("w-20");
    expect(dragRegion.className).toContain("[-webkit-app-region:drag]");
    expect(floatingTrigger.className).toContain("left-[84px]");
    expect(floatingTrigger.className).toContain("top-0");
    expect(floatingTrigger.className).toContain(
      "[-webkit-app-region:no-drag]",
    );
    expect(sidebarTrigger.className).toContain("h-7");
    expect(sidebarTrigger.className).toContain("[-webkit-app-region:no-drag]");
  });

  it("keeps one fixed desktop sidebar trigger after the sidebar is collapsed", async () => {
    await renderAppLayout({
      desktopInfo: {
        platform: "macos",
        version: "0.0.1",
      },
      initialEntry: "/projects/proj_desktop",
    });

    const initialSidebarTrigger = await screen.findByRole("button", {
      name: "Toggle Sidebar",
    });

    fireEvent.click(initialSidebarTrigger);

    const sidebarTriggers = screen.getAllByRole("button", {
      name: "Toggle Sidebar",
    });
    const floatingTrigger = screen.getByTestId("bb-desktop-sidebar-trigger");

    expect(sidebarTriggers).toHaveLength(1);
    expect(within(floatingTrigger).getByRole("button")).toBe(
      sidebarTriggers[0],
    );
    expect(screen.queryByTestId("app-sidebar-inline-trigger-row")).toBeNull();
  });
});
