// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ProjectSource,
  type ThreadListEntry,
  type ThreadWithRuntime,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY } from "@/lib/root-compose-create-preference";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { RootComposeRoute } from "./RootComposeView";

type ThreadOverrides = Partial<ThreadWithRuntime>;
type ThreadListEntryOverrides = Partial<ThreadListEntry>;
type ProjectWithThreadsOverrides = Partial<ProjectWithThreadsResponse>;

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localHostId: "host_local",
    localDaemonHostId: "host_local",
    hasDaemon: true,
    supportsNativeFolderPicker: false,
    platform: null,
    isLocalDaemonHost: (hostId: string | null | undefined) =>
      hostId === "host_local",
    pickFolder: null,
  }),
}));

const STANDARD_PROJECT_ID = "proj_standard";

interface RootComposeFetchRoutesOptions {
  createThreadShouldFail?: boolean;
  createdThread?: ThreadWithRuntime;
  sidebarNavigation?: SidebarBootstrapResponse;
  threads?: readonly ThreadListEntry[];
}

interface RootComposeFetchRequests {
  createThread: Request[];
}

const localHost: Host = {
  id: "host_local",
  name: "This Mac",
  type: "persistent",
  status: "connected",
  lastSeenAt: 100,
  createdAt: 0,
  updatedAt: 100,
};

const standardProjectSource: ProjectSource = {
  id: "src_standard",
  projectId: STANDARD_PROJECT_ID,
  type: "local_path",
  hostId: "host_local",
  path: "/tmp/bb-standard-project",
  isDefault: true,
  createdAt: 1,
  updatedAt: 1,
};

const systemExecutionOptions = {
  providers: [
    {
      id: "codex",
      displayName: "Codex",
      available: true,
      capabilities: {
        supportsArchive: true,
        supportsRename: true,
        supportsServiceTier: false,
        supportsUserQuestion: true,
        supportedPermissionModes: ["full", "workspace-write"],
      },
    },
  ],
  models: [
    {
      id: "gpt-5",
      model: "gpt-5",
      displayName: "GPT-5",
      description: "GPT-5",
      supportedReasoningEfforts: [
        { reasoningEffort: "medium", description: "Medium" },
      ],
      defaultReasoningEffort: "medium",
      isDefault: true,
    },
  ],
  selectedOnlyModels: [],
  modelLoadError: null,
} satisfies SystemExecutionOptionsResponse;

const systemConfig = {
  featureFlags: { placeholder: false },
  hostDaemonPort: null,
  voiceTranscriptionEnabled: false,
} satisfies SystemConfigResponse;

function LocationCapture() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function RootComposeWithLocation() {
  return (
    <>
      <RootComposeRoute />
      <LocationCapture />
    </>
  );
}

function RootComposeWithFocusButton() {
  const navigate = useNavigate();
  return (
    <>
      <RootComposeWithLocation />
      <button
        type="button"
        onClick={() => navigate("/", { state: { focusPrompt: true } })}
      >
        Sidebar new thread
      </button>
    </>
  );
}

function makeThread(overrides: ThreadOverrides = {}): ThreadWithRuntime {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thr_created",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinnedAt: null,
    projectId: PERSONAL_PROJECT_ID,
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Created thread",
    titleFallback: "Created thread",
    updatedAt: 1,
    ...overrides,
  };
}

function makeThreadListEntry(
  overrides: ThreadListEntryOverrides = {},
): ThreadListEntry {
  return {
    ...makeThread({
      environmentId: "env_reuse",
      id: "thr_reuse_source",
      projectId: STANDARD_PROJECT_ID,
      title: "Reusable worktree",
      titleFallback: "Reusable worktree",
    }),
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: "host_local",
    environmentBranchName: "bb/reuse-worktree",
    environmentName: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
    ...overrides,
  };
}

function makeProjectWithThreadsResponse(
  overrides: ProjectWithThreadsOverrides = {},
): ProjectWithThreadsResponse {
  return {
    createdAt: 1,
    defaultExecutionOptions: null,
    id: PERSONAL_PROJECT_ID,
    kind: "personal",
    name: "Personal",
    sources: [],
    threads: [],
    updatedAt: 1,
    ...overrides,
  };
}

function buildSidebarNavigationResponse(
  projects: readonly ProjectWithThreadsResponse[] = [],
): SidebarBootstrapResponse {
  return {
    projects: [...projects],
    personalProject: makeProjectWithThreadsResponse(),
  };
}

function makeStandardProjectWithThreadsResponse(): ProjectWithThreadsResponse {
  return makeProjectWithThreadsResponse({
    id: STANDARD_PROJECT_ID,
    kind: "standard",
    name: "Standard Project",
    sources: [standardProjectSource],
    threads: [],
  });
}

function seedRootComposeDraft(text: string): void {
  seedProjectRootComposeDraft(PERSONAL_PROJECT_ID, text);
}

function getRootComposeDraftStorageKey(projectId: string): string {
  return `bb.promptbox.contents-${encodeURIComponent(projectId.trim())}-draft-3`;
}

function seedProjectRootComposeDraft(projectId: string, text: string): void {
  window.localStorage.setItem(
    getRootComposeDraftStorageKey(projectId),
    JSON.stringify({ text, attachments: [] }),
  );
}

function seedNavigateToThreadAfterCreatePreference(enabled: boolean): void {
  window.localStorage.setItem(
    NAVIGATE_TO_THREAD_AFTER_CREATE_STORAGE_KEY,
    JSON.stringify(enabled),
  );
}

function isEnabledButton(element: HTMLElement): boolean {
  return element instanceof HTMLButtonElement && !element.disabled;
}

function installRootComposeFetchRoutes(
  options: RootComposeFetchRoutesOptions = {},
): RootComposeFetchRequests {
  const requests: RootComposeFetchRequests = {
    createThread: [],
  };
  const sidebarNavigation =
    options.sidebarNavigation ?? buildSidebarNavigationResponse();
  const projectIds = [
    sidebarNavigation.personalProject.id,
    ...sidebarNavigation.projects.map((project) => project.id),
  ];
  installFetchRoutes([
    {
      pathname: "/api/v1/sidebar-bootstrap",
      handler: () => jsonResponse(sidebarNavigation),
    },
    {
      pathname: "/api/v1/projects",
      handler: () => jsonResponse(sidebarNavigation.projects),
    },
    ...projectIds.flatMap((projectId) => [
      {
        pathname: `/api/v1/projects/${projectId}/prompt-history`,
        handler: () => jsonResponse([]),
      },
      {
        pathname: `/api/v1/projects/${projectId}/default-execution-options`,
        handler: () => jsonResponse(null),
      },
      {
        pathname: `/api/v1/projects/${projectId}/branches`,
        handler: () =>
          jsonResponse({
            branches: ["main"],
            branchesTruncated: false,
            checkout: { kind: "branch", branchName: "main" },
            defaultBranch: "main",
            hasUncommittedChanges: false,
            operation: { kind: "none" },
            remoteBranches: [],
            remoteBranchesTruncated: false,
            selectedBranch: null,
          }),
      },
    ]),
    {
      pathname: "/api/v1/threads",
      handler: (request) => {
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId");
        return jsonResponse(
          (options.threads ?? []).filter(
            (thread) => thread.projectId === projectId,
          ),
        );
      },
    },
    {
      method: "POST",
      pathname: "/api/v1/threads",
      handler: (request) => {
        requests.createThread.push(request);
        if (options.createThreadShouldFail) {
          return jsonResponse({ error: "create failed" }, { status: 500 });
        }
        return jsonResponse(options.createdThread ?? makeThread(), {
          status: 201,
        });
      },
    },
    {
      pathname: "/api/v1/hosts",
      handler: () => jsonResponse([localHost]),
    },
    {
      pathname: "/api/v1/system/execution-options",
      handler: () => jsonResponse(systemExecutionOptions),
    },
    {
      pathname: "/api/v1/system/config",
      handler: () => jsonResponse(systemConfig),
    },
  ]);
  return requests;
}

interface RenderRootComposeRouteOptions {
  initialEntry?: string | { pathname: string; state?: unknown };
  rootRouteElement?: ReactNode;
}

function renderRootComposeRoute(
  options: RenderRootComposeRouteOptions = {},
): void {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  const initialEntry = options.initialEntry ?? "/";
  const rootRouteElement = options.rootRouteElement ?? (
    <RootComposeWithLocation />
  );

  render(
    <QueryClientWrapper>
      <Suspense fallback={null}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <QuickCreateProjectProvider>
            <Routes>
              <Route path="/" element={rootRouteElement} />
              <Route path="/threads/:threadId" element={<LocationCapture />} />
              <Route
                path="/projects/:projectId/threads/:threadId"
                element={<LocationCapture />}
              />
            </Routes>
          </QuickCreateProjectProvider>
        </MemoryRouter>
      </Suspense>
    </QueryClientWrapper>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("RootComposeRoute", () => {
  it("redirects the personal legacy project route to root compose", async () => {
    render(
      <MemoryRouter initialEntries={[`/projects/${PERSONAL_PROJECT_ID}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<RootComposeRoute />} />
          <Route path="/" element={<LocationCapture />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe("/");
    });
    expect(screen.queryByText("Not found")).toBeNull();
    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      PERSONAL_PROJECT_ID,
    );
  });

  it("stays on root compose after creating a thread by default", async () => {
    const requests = installRootComposeFetchRoutes();
    seedRootComposeDraft("Open a debugging thread");
    renderRootComposeRoute();

    await screen.findByRole("textbox");
    const submitButton = screen.getByTitle("Submit (Enter)");
    await waitFor(() => {
      expect(isEnabledButton(submitButton)).toBe(true);
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(requests.createThread).toHaveLength(1);
    });
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });

  it("navigates to a created thread when the navigate-on-create preference is on", async () => {
    const thread = makeThread({ id: "thr_new_thread" });
    installRootComposeFetchRoutes({ createdThread: thread });
    seedNavigateToThreadAfterCreatePreference(true);
    seedRootComposeDraft("Open a debugging thread");
    renderRootComposeRoute();

    await screen.findByRole("textbox");
    const submitButton = screen.getByTitle("Submit (Enter)");
    await waitFor(() => {
      expect(isEnabledButton(submitButton)).toBe(true);
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    });
  });

  it("focuses the rich prompt editor when root compose navigation requests focus", async () => {
    installRootComposeFetchRoutes();
    seedRootComposeDraft("Continue this draft");
    renderRootComposeRoute({
      rootRouteElement: <RootComposeWithFocusButton />,
    });

    const textbox = await screen.findByRole("textbox");
    const sidebarButton = screen.getByRole("button", {
      name: "Sidebar new thread",
    });
    sidebarButton.focus();
    expect(document.activeElement).toBe(sidebarButton);

    fireEvent.click(sidebarButton);

    await waitFor(() => {
      expect(document.activeElement).toBe(textbox);
    });
  });

  it("clears the reuse-environment selection after creating a thread", async () => {
    const standardProject = makeStandardProjectWithThreadsResponse();
    const createdThread = makeThread({
      id: "thr_standard_created",
      projectId: STANDARD_PROJECT_ID,
    });
    const requests = installRootComposeFetchRoutes({
      createdThread,
      sidebarNavigation: buildSidebarNavigationResponse([standardProject]),
      threads: [makeThreadListEntry()],
    });
    window.localStorage.setItem(
      "bb.root-compose.project-id",
      STANDARD_PROJECT_ID,
    );
    seedProjectRootComposeDraft(
      STANDARD_PROJECT_ID,
      "Review the existing worktree",
    );
    renderRootComposeRoute({
      initialEntry: {
        pathname: "/",
        state: { reuseEnvironmentId: "env_reuse" },
      },
    });

    await screen.findByRole("button", { name: "Stop reusing worktree" });
    const submitButton = screen.getByTitle("Submit (Enter)");
    await waitFor(() => {
      expect(isEnabledButton(submitButton)).toBe(true);
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(requests.createThread).toHaveLength(1);
    });
    const createBody = await requests.createThread[0]?.json();
    expect(createBody.environment).toEqual({
      type: "reuse",
      environmentId: "env_reuse",
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop reusing worktree" }),
      ).toBeNull();
    });
  });

  it("does not navigate when creation fails and the navigate-on-create preference is on", async () => {
    const requests = installRootComposeFetchRoutes({
      createThreadShouldFail: true,
    });
    seedNavigateToThreadAfterCreatePreference(true);
    seedRootComposeDraft("Open a debugging thread");
    renderRootComposeRoute();

    await screen.findByRole("textbox");
    const submitButton = screen.getByTitle("Submit (Enter)");
    await waitFor(() => {
      expect(isEnabledButton(submitButton)).toBe(true);
    });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(requests.createThread).toHaveLength(1);
    });
    expect(screen.getByTestId("pathname").textContent).toBe("/");
  });
});
