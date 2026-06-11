// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  ProjectResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { Provider as JotaiProvider, createStore } from "jotai";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import { collapsedProjectIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import {
  projectsQueryKey,
  sidebarNavigationQueryKey,
} from "@/hooks/queries/query-keys";
import {
  ProjectActionsProvider,
  useProjectActions,
} from "./ProjectActionsProvider";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  };
});

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    hasDaemon: false,
    localDaemonHostId: null,
    localHostId: null,
    platform: null,
    pickFolder: null,
    supportsNativeFolderPicker: false,
    isLocalDaemonHost: () => false,
  }),
}));

interface RenderWithProviderOptions {
  initialEntries?: string[];
  jotaiStore?: ReturnType<typeof createStore>;
}

interface RenderWithProviderResult {
  queryClient: QueryClient;
}

function makeProjectResponse(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return {
    createdAt: 1,
    id: "project-1",
    kind: "standard",
    name: "Project One",
    updatedAt: 1,
    sources: [],
    ...overrides,
  };
}

function makeProjectWithThreadsResponse(
  overrides: Partial<ProjectWithThreadsResponse> = {},
): ProjectWithThreadsResponse {
  return {
    ...makeProjectResponse(overrides),
    defaultExecutionOptions: overrides.defaultExecutionOptions ?? null,
    threads: overrides.threads ?? [],
  };
}

function renderWithProvider(
  children: ReactNode,
  { initialEntries = ["/"], jotaiStore }: RenderWithProviderOptions = {},
): RenderWithProviderResult {
  const queryClient = createAppQueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false },
    },
  });
  render(
    <JotaiProvider store={jotaiStore}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <ProjectActionsProvider>{children}</ProjectActionsProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return { queryClient };
}

/** Captures the context value so tests can invoke provider APIs directly. */
function HookProbe({
  onReady,
}: {
  onReady: (actions: ReturnType<typeof useProjectActions>) => void;
}) {
  const actions = useProjectActions();
  onReady(actions);
  return null;
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectActionsProvider", () => {
  it("clears the deleted project from the collapsed-projects atom on success", async () => {
    const project = makeProjectResponse();
    const other = makeProjectResponse({ id: "project-2", name: "Project Two" });
    const jotaiStore = createStore();
    jotaiStore.set(collapsedProjectIdsAtom, [project.id, other.id]);
    vi.mocked(api.deleteProject).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useProjectActions> | null = null;
    renderWithProvider(
      <HookProbe
        onReady={(a) => {
          actions = a;
        }}
      />,
      { jotaiStore },
    );

    act(() => {
      actions!.requestDelete(project);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /remove project/i }),
    );

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith(project.id);
    });

    // The deleted id is removed; unrelated ids stay.
    await waitFor(() => {
      expect(jotaiStore.get(collapsedProjectIdsAtom)).toEqual([other.id]);
    });
  });

  it("removes the deleted project from route-selection caches before navigating to root", async () => {
    const deletedProject = makeProjectResponse();
    const otherProject = makeProjectResponse({
      id: "project-2",
      name: "Project Two",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: "personal-project",
      kind: "personal",
      name: "Personal",
    });
    vi.mocked(api.deleteProject).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useProjectActions> | null = null;
    const { queryClient } = renderWithProvider(
      <>
        <HookProbe
          onReady={(a) => {
            actions = a;
          }}
        />
        <LocationProbe />
      </>,
      { initialEntries: [`/projects/${deletedProject.id}`] },
    );
    queryClient.setQueryData<ProjectResponse[]>(projectsQueryKey(), [
      deletedProject,
      otherProject,
    ]);
    queryClient.setQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
      {
        projects: [
          makeProjectWithThreadsResponse(deletedProject),
          makeProjectWithThreadsResponse(otherProject),
        ],
        personalProject,
      },
    );

    act(() => {
      actions!.requestDelete(deletedProject);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /remove project/i }),
    );

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith(deletedProject.id);
    });

    await waitFor(() => {
      expect(
        queryClient
          .getQueryData<ProjectResponse[]>(projectsQueryKey())
          ?.map((project) => project.id),
      ).toEqual([otherProject.id]);
    });
    expect(
      queryClient
        .getQueryData<SidebarBootstrapResponse>(sidebarNavigationQueryKey())
        ?.projects.map((project) => project.id),
    ).toEqual([otherProject.id]);
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/");
    });
  });

  it("does not navigate when deleting a project outside the current route", async () => {
    const deletedProject = makeProjectResponse();
    const viewedProject = makeProjectResponse({
      id: "project-2",
      name: "Project Two",
    });
    vi.mocked(api.deleteProject).mockResolvedValue(undefined);

    let actions: ReturnType<typeof useProjectActions> | null = null;
    renderWithProvider(
      <>
        <HookProbe
          onReady={(a) => {
            actions = a;
          }}
        />
        <LocationProbe />
      </>,
      { initialEntries: [`/projects/${viewedProject.id}`] },
    );

    act(() => {
      actions!.requestDelete(deletedProject);
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /remove project/i }),
    );

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith(deletedProject.id);
    });
    expect(screen.getByTestId("location").textContent).toBe(
      `/projects/${viewedProject.id}`,
    );
  });
});
