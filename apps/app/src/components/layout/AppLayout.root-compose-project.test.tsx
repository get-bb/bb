// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppLayout,
  defaultAppLayoutDependencies,
  type AppLayoutDependencies,
} from "./AppLayout";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";

const mockUseThread = vi.hoisted(() => vi.fn());
const mockUseThreadDetailBootstrap = vi.hoisted(() => vi.fn());
const commandHandlers = vi.hoisted(() => new Map<string, () => boolean>());

/* SAFETY: The fixture replaces each production dependency with a focused test implementation. */
/* SAFETY: The fixture replaces each production dependency with focused test implementations. */
const appLayoutDependencies: AppLayoutDependencies = Object.assign(
  {},
  defaultAppLayoutDependencies,
  {
    useAppCommandHandler: (command: string, handler: () => boolean) => {
      commandHandlers.set(command, handler);
    },
    useAppCommandShortcut: () => null,
    AppLayoutSidebar: () => <aside data-testid="app-sidebar" />,
    ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    ProjectPathDialog: () => null,
    AppPageHeader: ({
      center,
      actions,
    }: {
      center?: ReactNode;
      actions?: ReactNode;
    }) => (
      <header>
        {center}
        {actions}
      </header>
    ),
    headerIconButtonClass: "header-icon-button",
    IframeDragGuardOverlay: () => null,
    getBbDesktopInfo: () => null,
    shouldReserveMacosTrafficLights: () => false,
    shouldUseMacosDesktopChrome: () => false,
    useFaviconBadge: () => {},
    useQuickCreateProjectController: () => ({
      hostId: null,
      hostName: null,
      isCreating: false,
      platform: "darwin",
      projectPathDialog: { onOpenChange: vi.fn(), target: null },
      submitProjectPath: vi.fn(),
    }),
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
        projects: [
          {
            id: "proj_opened",
            kind: "standard",
            name: "Opened Project",
            sources: [],
            threads: [],
            defaultExecutionOptions: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      isError: false,
      isSuccess: true,
    }),
    didThreadDetailBootstrapRefreshAfterMount: () => true,
    useThread: (...args: Parameters<typeof mockUseThread>) =>
      mockUseThread(...args),
    useThreadDetailBootstrap: (
      ...args: Parameters<typeof mockUseThreadDetailBootstrap>
    ) => mockUseThreadDetailBootstrap(...args),
    useThreadPendingInteractions: () => ({ data: undefined }),
    getLatestPendingInteraction: () => null,
  },
);

describe("AppLayout root compose project preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    commandHandlers.clear();
    mockUseThread.mockReturnValue({
      data: {
        id: "thr_opened",
        projectId: "proj_opened",
        title: "Opened Thread",
        titleFallback: "Opened Thread",
        lastReadAt: 100,
        latestAttentionAt: 100,
      },
    });
    mockUseThreadDetailBootstrap.mockReturnValue({
      isError: false,
      isSuccess: true,
    });
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    commandHandlers.clear();
    vi.clearAllMocks();
  });

  it("uses the opened thread project for the new-thread command", async () => {
    window.localStorage.setItem(
      ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
      "proj_last_run",
    );

    render(
      <MemoryRouter
        initialEntries={["/projects/proj_opened/threads/thr_opened"]}
      >
        <AppLayout dependencies={appLayoutDependencies}>
          <div>Thread route</div>
        </AppLayout>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.title).toBe("Opened Thread");
    });

    act(() => {
      expect(commandHandlers.get("thread.new")?.()).toBe(true);
    });

    await waitFor(() => {
      expect(
        window.localStorage.getItem(ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY),
      ).toBe("proj_opened");
    });
  });

  it("keeps the stored project when the route has no project", () => {
    window.localStorage.setItem(
      ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
      "proj_last_run",
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppLayout dependencies={appLayoutDependencies}>
          <div>New thread route</div>
        </AppLayout>
      </MemoryRouter>,
    );

    act(() => {
      expect(commandHandlers.get("thread.new")?.()).toBe(true);
    });

    expect(
      window.localStorage.getItem(ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY),
    ).toBe("proj_last_run");
  });
});
