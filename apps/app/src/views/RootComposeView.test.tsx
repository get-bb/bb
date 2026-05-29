// @vitest-environment jsdom

import { Suspense } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadWithRuntime,
} from "@bb/domain";
import type {
  ManagerTemplatesResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
  SystemConfigResponse,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { RootComposeRoute } from "./RootComposeView";

type HostIdCandidate = string | null | undefined;
type ThreadOverrides = Partial<ThreadWithRuntime>;
type ProjectWithThreadsOverrides = Partial<ProjectWithThreadsResponse>;

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localHostId: "host_local",
    hasDaemon: true,
    supportsNativeFolderPicker: false,
    platform: null,
    isLocalHost: (hostId: HostIdCandidate) => hostId === "host_local",
    pickFolder: null,
  }),
}));

const ROOT_COMPOSE_DRAFT_STORAGE_KEY =
  "bb.promptbox.contents-proj_personal-draft-3";
const ROOT_COMPOSE_MODE_STORAGE_KEY = "bb.promptbox.new-thread-mode";

interface RootComposeFetchRoutesOptions {
  createThreadShouldFail?: boolean;
  createdThread?: ThreadWithRuntime;
  hiredManager?: ThreadWithRuntime;
}

interface RootComposeFetchRequests {
  createThread: Request[];
  hireManager: Request[];
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

const managerTemplates = {
  templates: [],
  activeName: "default",
} satisfies ManagerTemplatesResponse;

const systemConfig = {
  featureFlags: {
    askUserQuestion: false,
    terminals: false,
  },
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
    type: "standard",
    updatedAt: 1,
    ...overrides,
  };
}

function makeProjectWithThreadsResponse(
  overrides: ProjectWithThreadsOverrides = {},
): ProjectWithThreadsResponse {
  return {
    createdAt: 1,
    id: PERSONAL_PROJECT_ID,
    kind: "personal",
    name: "Personal",
    sources: [],
    threads: [],
    updatedAt: 1,
    ...overrides,
  };
}

function buildSidebarBootstrapResponse(): SidebarBootstrapResponse {
  return {
    projects: [],
    personalProject: makeProjectWithThreadsResponse(),
  };
}

function seedRootComposeDraft(text: string): void {
  window.localStorage.setItem(
    ROOT_COMPOSE_DRAFT_STORAGE_KEY,
    JSON.stringify({ text, attachments: [] }),
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
    hireManager: [],
  };
  installFetchRoutes([
    {
      pathname: "/api/v1/sidebar-bootstrap",
      handler: () => jsonResponse(buildSidebarBootstrapResponse()),
    },
    {
      pathname: "/api/v1/projects",
      handler: () => jsonResponse([]),
    },
    {
      pathname: `/api/v1/projects/${PERSONAL_PROJECT_ID}/prompt-history`,
      handler: () => jsonResponse([]),
    },
    {
      pathname: `/api/v1/projects/${PERSONAL_PROJECT_ID}/default-execution-options`,
      handler: () => jsonResponse(null),
    },
    {
      pathname: "/api/v1/threads",
      handler: () => jsonResponse([]),
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
      pathname: "/api/v1/manager-templates",
      handler: () => jsonResponse(managerTemplates),
    },
    {
      pathname: "/api/v1/system/execution-options",
      handler: () => jsonResponse(systemExecutionOptions),
    },
    {
      pathname: "/api/v1/system/config",
      handler: () => jsonResponse(systemConfig),
    },
    {
      method: "POST",
      pathname: `/api/v1/projects/${PERSONAL_PROJECT_ID}/managers`,
      handler: (request) => {
        requests.hireManager.push(request);
        return jsonResponse(
          options.hiredManager ??
            makeThread({
              id: "thr_manager",
              title: "Manager",
              titleFallback: "Manager",
              type: "manager",
            }),
          { status: 201 },
        );
      },
    },
  ]);
  return requests;
}

function renderRootComposeRoute(): void {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();

  render(
    <QueryClientWrapper>
      <Suspense fallback={null}>
        <MemoryRouter initialEntries={["/"]}>
          <QuickCreateProjectProvider>
            <Routes>
              <Route path="/" element={<RootComposeWithLocation />} />
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

  it("navigates to a successfully created new thread", async () => {
    const thread = makeThread({ id: "thr_new_thread" });
    installRootComposeFetchRoutes({ createdThread: thread });
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

  it("navigates to a successfully hired manager thread", async () => {
    const manager = makeThread({
      id: "thr_new_manager",
      title: "Manager",
      titleFallback: "Manager",
      type: "manager",
    });
    installRootComposeFetchRoutes({ hiredManager: manager });
    window.localStorage.setItem(ROOT_COMPOSE_MODE_STORAGE_KEY, "manager");
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
          projectId: manager.projectId,
          threadId: manager.id,
        }),
      );
    });
  });

  it("does not navigate when new thread creation fails", async () => {
    const requests = installRootComposeFetchRoutes({
      createThreadShouldFail: true,
    });
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
