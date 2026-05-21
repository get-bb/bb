// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
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
        <MemoryRouter initialEntries={["/"]}>
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
    await renderAppLayout({ desktopInfo: null });

    const sidebarTriggers = await screen.findAllByRole("button", {
      name: "Toggle Sidebar",
    });
    expect(sidebarTriggers).toHaveLength(1);
    expect(screen.queryByTestId("bb-desktop-titlebar")).toBeNull();
  });

  it("renders the sidebar trigger inside the desktop title-bar strip", async () => {
    await renderAppLayout({
      desktopInfo: {
        platform: "macos",
        version: "0.0.1",
      },
    });

    const titleBar = await screen.findByTestId("bb-desktop-titlebar");
    const sidebarTrigger = within(titleBar).getByRole("button", {
      name: "Toggle Sidebar",
    });

    expect(
      screen.getAllByRole("button", { name: "Toggle Sidebar" }),
    ).toHaveLength(1);
    expect(titleBar.className).toContain("[-webkit-app-region:drag]");
    expect(sidebarTrigger.className).toContain("[-webkit-app-region:no-drag]");
  });
});
