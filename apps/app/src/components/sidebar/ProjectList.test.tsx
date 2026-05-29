// @vitest-environment jsdom

import {
  Suspense,
  useEffect,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { useAtom } from "jotai";
import type { QueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  AppSummary,
  ProjectResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import {
  FakeReconnectingWebSocket,
  resetFakeReconnectingWebSockets,
} from "@/test/fake-reconnecting-websocket";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { wsManager } from "@/lib/ws";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { useRootComposeReuseEnvironment } from "@/lib/root-compose-selection";
import { encodeReuseValue } from "@/components/pickers/environment-picker-value";
import {
  projectsQueryKey,
  threadListQueryKey,
} from "@/hooks/queries/query-keys";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectList } from "./ProjectList";

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

interface ProjectListWrapperProps {
  children: ReactNode;
}

interface ProjectListRenderResult {
  container: HTMLElement;
  queryClient: QueryClient;
}

interface ProjectListRenderOptions {
  extraUi?: ReactNode;
}

type ProjectListRenderProps = ComponentProps<typeof ProjectList>;
type ProjectThreadListEntry = ProjectWithThreadsResponse["threads"][number];
type ProjectThreadListEntryOverrides = Partial<ProjectThreadListEntry>;
type ProjectWithThreadsOverrides = Partial<ProjectWithThreadsResponse>;

interface MakeAppArgs {
  id: string;
  name: string;
  icon: AppSummary["icon"];
}

function makeProjectResponse(
  overrides: Partial<ProjectResponse> = {},
): ProjectResponse {
  return {
    createdAt: 1,
    id: "project-1",
    kind: "standard",
    name: "Project One",
    sources: [],
    updatedAt: 1,
    ...overrides,
  };
}

function makeProjectWithThreadsResponse(
  overrides: ProjectWithThreadsOverrides = {},
): ProjectWithThreadsResponse {
  return {
    ...makeProjectResponse(overrides),
    threads: overrides.threads ?? [],
  };
}

function makeThreadListEntry(
  projectId: string,
  index: number,
  overrides: ProjectThreadListEntryOverrides = {},
): ProjectThreadListEntry {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: index,
    deletedAt: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    id: `thread-${index}`,
    lastReadAt: null,
    latestAttentionAt: index,
    parentThreadId: null,
    pinnedAt: null,
    pinSortKey: null,
    projectId,
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: `Thread ${index}`,
    titleFallback: `Thread ${index}`,
    type: "standard",
    updatedAt: index,
    ...overrides,
  };
}

function makeApp({ id, name, icon }: MakeAppArgs): AppSummary {
  return {
    id,
    name,
    entry: { path: "index.html", kind: "html" },
    capabilities: [],
    icon,
  };
}

const STATUS_APP = makeApp({
  id: "status",
  name: "Status",
  icon: { kind: "builtin", name: "ListTodo" },
});

interface ProjectListHandlerArgs {
  projects: ProjectResponse[];
  threadsByProjectId?: Map<string, ProjectWithThreadsResponse["threads"]>;
}

interface RootComposeReuseProbeProps {
  initialValue: string;
  onValue: (value: string | null) => void;
}

interface PanelStateProbeProps {
  threadId: string;
}

function buildProjectListHandler(args: ProjectListHandlerArgs) {
  return (request: Request) => {
    const url = new URL(request.url);
    if (url.searchParams.get("include") === "threads") {
      return jsonResponse(
        args.projects.map((project) => ({
          ...project,
          threads: args.threadsByProjectId?.get(project.id) ?? [],
        })),
      );
    }
    return jsonResponse(args.projects);
  };
}

function buildSidebarBootstrapResponse(args: {
  personalProject: ProjectWithThreadsResponse;
  projects: ProjectResponse[];
  threadsByProjectId?: Map<string, ProjectWithThreadsResponse["threads"]>;
}): SidebarBootstrapResponse {
  return {
    projects: args.projects.map((project) => ({
      ...project,
      threads: args.threadsByProjectId?.get(project.id) ?? [],
    })),
    personalProject: args.personalProject,
  };
}

function createProjectListWrapper() {
  const harness = createQueryClientTestHarness();

  function ProjectListWrapper({ children }: ProjectListWrapperProps) {
    return harness.wrapper({
      children: (
        <Suspense fallback={null}>
          <BrowserRouter>
            <ProjectActionsProvider>
              <ThreadActionsProvider>{children}</ThreadActionsProvider>
            </ProjectActionsProvider>
          </BrowserRouter>
        </Suspense>
      ),
    });
  }

  return {
    queryClient: harness.queryClient,
    wrapper: ProjectListWrapper,
  };
}

function RootComposeReuseProbe({
  initialValue,
  onValue,
}: RootComposeReuseProbeProps) {
  const [value, setValue] = useRootComposeReuseEnvironment();

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, setValue]);

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

function PanelStateProbe({ threadId }: PanelStateProbeProps) {
  const state = useFixedPanelTabsState(threadId);
  return (
    <div data-testid="panel-state">
      {JSON.stringify({
        activeTabId: state.secondary.activeTabId,
        isOpen: state.secondary.isOpen,
      })}
    </div>
  );
}

interface ConversationCollapseProbeProps {
  threadId: string;
}

// Mirrors one thread's conversation-collapse preference the thread detail view
// reads/writes, and exposes a button that stands in for the collapsed rail's
// expand control so a sidebar-only test can drive the same state. Keyed by
// threadId so a test can probe several threads independently.
function ConversationCollapseProbe({ threadId }: ConversationCollapseProbeProps) {
  const [collapsed, setCollapsed] = useAtom(
    getThreadConversationCollapsedAtom(threadId),
  );
  return (
    <div>
      <div data-testid={`conversation-collapsed:${threadId}`}>
        {String(collapsed)}
      </div>
      <button type="button" onClick={() => setCollapsed(false)}>
        {`expand-conversation:${threadId}`}
      </button>
    </div>
  );
}

async function renderProjectList(
  props: ProjectListRenderProps = {},
  options: ProjectListRenderOptions = {},
): Promise<ProjectListRenderResult> {
  const { queryClient, wrapper } = createProjectListWrapper();
  let container: HTMLElement | null = null;

  await act(async () => {
    const result = render(
      <>
        {options.extraUi}
        <ProjectList {...props} />
      </>,
      { wrapper },
    );
    container = result.container;
  });

  if (container === null) {
    throw new Error("ProjectList render did not produce a container");
  }

  return { container, queryClient };
}

afterEach(() => {
  wsManager.disconnect();
  cleanup();
  resetFakeReconnectingWebSockets();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectList", () => {
  it("primes project and thread-list caches from the sidebar bootstrap", async () => {
    let sidebarBootstrapRequestCount = 0;
    let leanProjectRequestCount = 0;
    let threadRequestCount = 0;
    const projects = [
      makeProjectResponse({ id: "project-1", name: "Project One" }),
      makeProjectResponse({ id: "project-2", name: "Project Two" }),
      makeProjectResponse({ id: "project-3", name: "Project Three" }),
    ];
    const threadsByProjectId = new Map<string, ProjectThreadListEntry[]>(
      projects.map((project, index) => [
        project.id,
        [makeThreadListEntry(project.id, index + 1)],
      ]),
    );
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [makeThreadListEntry(PERSONAL_PROJECT_ID, 4)],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () => {
          sidebarBootstrapRequestCount += 1;
          return jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects,
              threadsByProjectId,
            }),
          );
        },
      },
      {
        pathname: "/api/v1/projects",
        handler: (request) => {
          leanProjectRequestCount += 1;
          return buildProjectListHandler({
            projects,
            threadsByProjectId,
          })(request);
        },
      },
      {
        pathname: "/api/v1/threads",
        handler: () => {
          threadRequestCount += 1;
          return jsonResponse([]);
        },
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    const { queryClient } = await renderProjectList();

    await waitFor(() => {
      expect(queryClient.getQueryData(projectsQueryKey())).toEqual(projects);
      for (const project of projects) {
        expect(
          queryClient.getQueryData(
            threadListQueryKey({ projectId: project.id, archived: false }),
          ),
        ).toEqual(threadsByProjectId.get(project.id));
      }
      expect(
        queryClient.getQueryData(
          threadListQueryKey({
            projectId: PERSONAL_PROJECT_ID,
            archived: false,
          }),
        ),
      ).toEqual(personalProject.threads);
    });
    expect(sidebarBootstrapRequestCount).toBe(1);
    expect(leanProjectRequestCount).toBe(0);
    expect(threadRequestCount).toBe(0);
  });

  it("does not show project error or empty states before the websocket connects", async () => {
    const fetchMock = installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    wsManager.connect();

    const { queryClient } = await renderProjectList();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
      expect(queryClient.getQueryState(projectsQueryKey())?.status).toBe(
        "error",
      );
    });
    expect(screen.queryByText("Projects unavailable")).toBeNull();
    expect(screen.queryByText("No projects")).toBeNull();
  });

  it("toggles a project row instead of linking to a project route", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const thread = makeThreadListEntry(project.id, 1, {
      title: "Project Thread",
      titleFallback: "Project Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([[project.id, [thread]]]),
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    const projectLabel = await screen.findByText("Project One");
    const projectRow = projectLabel.closest(
      "[data-sidebar-sticky-tier='project']",
    );
    expect(
      projectRow?.querySelector("a[href='/projects/project-1']"),
    ).toBeNull();
    expect(screen.getByText("Project Thread")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Project One" }),
    );

    expect(screen.queryByText("Project Thread")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Project One" }));

    expect(screen.getByText("Project Thread")).toBeTruthy();
  });

  it("renders manager app rows directly under their owning manager", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerThread = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-apps",
      title: "Sidebar Manager",
      titleFallback: "Sidebar Manager",
      type: "manager",
    });
    const workerThread = makeThreadListEntry(project.id, 9, {
      id: "thread-manager-worker",
      parentThreadId: managerThread.id,
      title: "Worker Thread",
      titleFallback: "Worker Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([
                [project.id, [managerThread, workerThread]],
              ]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerThread.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    const appRow = await screen.findByRole("button", {
      name: "Open Status app",
    });
    const managerLabel = screen.getByText("Sidebar Manager");
    const workerLabel = screen.getByText("Worker Thread");

    expect(appRow.classList.contains("pl-14")).toBe(true);
    expect(appRow.parentElement?.className).toContain("before:left-10");
    expect(
      Boolean(
        managerLabel.compareDocumentPosition(appRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        appRow.compareDocumentPosition(workerLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("opens a manager app row in the owning thread secondary panel", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerThread = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-open-app",
      title: "Sidebar Manager",
      titleFallback: "Sidebar Manager",
      type: "manager",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([[project.id, [managerThread]]]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerThread.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList(
      {},
      { extraUi: <PanelStateProbe threadId={managerThread.id} /> },
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Open Status app" }),
    );

    await waitFor(() => {
      const probe = screen.getByTestId("panel-state");
      expect(probe.textContent).toContain('"activeTabId":"app:status"');
      expect(probe.textContent).toContain('"isOpen":true');
    });
    expect(window.location.pathname).toBe(
      `/projects/${project.id}/threads/${managerThread.id}`,
    );
  });

  it("hides manager app rows when the owning manager is collapsed", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerThread = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-collapse-apps",
      title: "Sidebar Manager",
      titleFallback: "Sidebar Manager",
      type: "manager",
    });
    const workerThread = makeThreadListEntry(project.id, 9, {
      id: "thread-manager-collapse-worker",
      parentThreadId: managerThread.id,
      title: "Worker Thread",
      titleFallback: "Worker Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([
                [project.id, [managerThread, workerThread]],
              ]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerThread.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    expect(
      await screen.findByRole("button", { name: "Open Status app" }),
    ).toBeTruthy();
    expect(screen.getByText("Worker Thread")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Collapse Sidebar Manager threads",
      }),
    );

    expect(
      screen.queryByRole("button", { name: "Open Status app" }),
    ).toBeNull();
    expect(screen.queryByText("Worker Thread")).toBeNull();
  });

  it("orders project hover actions as menu, new manager, then new thread", async () => {
    window.history.pushState(null, "", "/settings");
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    const reuseValues: (string | null)[] = [];
    const staleReuseValue = encodeReuseValue("env-stale");
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList(
      {},
      {
        extraUi: (
          <RootComposeReuseProbe
            initialValue={staleReuseValue}
            onValue={(value) => {
              reuseValues.push(value);
            }}
          />
        ),
      },
    );

    const managerButton = await screen.findByRole("button", {
      name: "New manager in Project One",
    });
    const threadButton = screen.getByRole("button", {
      name: "New thread in Project One",
    });
    const menuButton = screen.getByRole("button", {
      name: "Project One actions",
    });

    expect(
      Boolean(
        menuButton.compareDocumentPosition(managerButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        managerButton.compareDocumentPosition(threadButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    await waitFor(() => {
      expect(reuseValues.at(-1)).toBe(staleReuseValue);
    });

    fireEvent.click(managerButton);

    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      "project-1",
    );
    expect(window.localStorage.getItem("bb.promptbox.new-thread-mode")).toBe(
      "manager",
    );
    await waitFor(() => {
      expect(reuseValues.at(-1)).toBeNull();
    });
    expect(window.location.pathname).toBe("/");

    fireEvent.click(threadButton);

    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      "project-1",
    );
    expect(window.localStorage.getItem("bb.promptbox.new-thread-mode")).toBe(
      "thread",
    );
  });

  it("renders direct section header create actions", async () => {
    window.history.pushState(null, "", "/settings");
    const onNewProject = vi.fn();
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList({ onNewProject, isCreatingProject: false });

    const newProjectButton = await screen.findByRole("button", {
      name: "New project",
    });
    const newThreadButton = screen.getByRole("button", {
      name: "New thread",
    });
    const newManagerButton = screen.getByRole("button", {
      name: "New manager",
    });

    expect(
      screen.queryByRole("button", { name: "Project options" }),
    ).toBeNull();
    expect(
      newProjectButton.querySelector("[data-icon='FolderPlus']"),
    ).toBeTruthy();

    fireEvent.click(newProjectButton);

    expect(onNewProject).toHaveBeenCalledTimes(1);

    fireEvent.click(newThreadButton);

    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      PERSONAL_PROJECT_ID,
    );
    expect(window.localStorage.getItem("bb.promptbox.new-thread-mode")).toBe(
      "thread",
    );
    expect(window.location.pathname).toBe("/");

    fireEvent.click(newManagerButton);

    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      PERSONAL_PROJECT_ID,
    );
    expect(window.localStorage.getItem("bb.promptbox.new-thread-mode")).toBe(
      "manager",
    );
  });

  it("shows projects unavailable when the project request fails after the websocket connects", async () => {
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    wsManager.connect();
    FakeReconnectingWebSocket.latest().open();

    await renderProjectList();

    expect(await screen.findByText("Projects unavailable")).toBeTruthy();
    expect(screen.queryByText("No projects")).toBeNull();
  });

  it("shows threads unavailable when a project thread list fetch fails after the websocket connects", async () => {
    const project = makeProjectResponse();
    const threadListKey = threadListQueryKey({
      projectId: project.id,
      archived: false,
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => new Response("starting", { status: 503 }),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    wsManager.connect();
    FakeReconnectingWebSocket.latest().open();

    const { queryClient } = await renderProjectList();

    await waitFor(() => {
      expect(queryClient.getQueryData(threadListKey)).toEqual([]);
    });
    await act(async () => {
      await queryClient.resetQueries({ queryKey: threadListKey, exact: true });
    });

    await waitFor(() => {
      expect(queryClient.getQueryState(threadListKey)?.status).toBe("error");
    });
    expect(screen.getByText("Threads unavailable")).toBeTruthy();
  });

  it("renders projectless threads in a Threads section below Projects by default", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const projectlessThread = makeThreadListEntry(PERSONAL_PROJECT_ID, 10, {
      title: "Projectless Thread",
      titleFallback: "Projectless Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [projectlessThread],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    const projectlessThreadLabel =
      await screen.findByText("Projectless Thread");
    const projectlessThreadRow = projectlessThreadLabel.closest("div");
    const projectsLabel = screen.getByText("Projects");
    const threadsLabel = screen.getByText("Threads");
    const sectionStack = projectsLabel.closest(
      "[data-sidebar-sticky-tier='label']",
    )?.parentElement?.parentElement;
    expect(
      Boolean(
        projectsLabel.compareDocumentPosition(threadsLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(sectionStack?.classList.contains("space-y-4")).toBe(true);
    expect(projectlessThreadRow?.parentElement?.className).not.toContain(
      "before:bg-border-hairline",
    );
  });

  it("hides the Pinned section when no active threads are pinned", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    expect(await screen.findByText("Projects")).toBeTruthy();
    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("moves pinned threads into the Pinned section and removes them from canonical sections", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const pinnedThread = makeThreadListEntry(project.id, 10, {
      title: "Pinned Project Thread",
      titleFallback: "Pinned Project Thread",
      pinnedAt: 1_000,
      pinSortKey: "a",
    });
    const unpinnedThread = makeThreadListEntry(project.id, 11, {
      title: "Project Thread",
      titleFallback: "Project Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([
                [project.id, [pinnedThread, unpinnedThread]],
              ]),
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getAllByText("Pinned Project Thread")).toHaveLength(1);
    expect(screen.getByText("Project Thread")).toBeTruthy();
  });

  it("moves pinned manager children with the manager", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const pinnedManager = makeThreadListEntry(project.id, 20, {
      id: "thread-pinned-manager",
      title: "Pinned Manager",
      titleFallback: "Pinned Manager",
      type: "manager",
      pinnedAt: 1_000,
      pinSortKey: "a",
    });
    const managedChild = makeThreadListEntry(project.id, 21, {
      id: "thread-managed-child",
      parentThreadId: pinnedManager.id,
      title: "Managed Child",
      titleFallback: "Managed Child",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([
                [project.id, [pinnedManager, managedChild]],
              ]),
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    expect(await screen.findByText("Pinned")).toBeTruthy();
    expect(screen.getAllByText("Pinned Manager")).toHaveLength(1);
    expect(screen.getAllByText("Managed Child")).toHaveLength(1);
  });

  it("does not indent top-level rows in the projectless Threads section", async () => {
    const projectlessManager = makeThreadListEntry(PERSONAL_PROJECT_ID, 12, {
      id: "thread-projectless-manager",
      title: "Projectless Manager",
      titleFallback: "Projectless Manager",
      type: "manager",
    });
    const projectlessChild = makeThreadListEntry(PERSONAL_PROJECT_ID, 13, {
      id: "thread-projectless-child",
      parentThreadId: projectlessManager.id,
      title: "Projectless Managed Child",
      titleFallback: "Projectless Managed Child",
    });
    const projectlessThread = makeThreadListEntry(PERSONAL_PROJECT_ID, 14, {
      title: "Projectless Top Level Thread",
      titleFallback: "Projectless Top Level Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [projectlessManager, projectlessChild, projectlessThread],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [],
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${projectlessManager.id}/apps`,
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    const standardRow = (
      await screen.findByText("Projectless Top Level Thread")
    ).closest("div");
    const managerRow = screen
      .getByText("Projectless Manager")
      .closest("[data-sidebar-sticky-tier='manager']");
    const childRow = screen
      .getByText("Projectless Managed Child")
      .closest("div");

    expect(standardRow?.classList.contains("pl-2")).toBe(true);
    expect(standardRow?.classList.contains("pl-8")).toBe(false);
    expect(managerRow?.classList.contains("pl-2")).toBe(true);
    expect(managerRow?.classList.contains("pl-8")).toBe(false);
    expect(childRow?.classList.contains("pl-8")).toBe(true);
  });

  it("renders the projectless Threads section as a non-selectable header", async () => {
    const projectlessThread = makeThreadListEntry(PERSONAL_PROJECT_ID, 11, {
      title: "Projectless Header Thread",
      titleFallback: "Projectless Header Thread",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [projectlessThread],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    expect(await screen.findByText("Projectless Header Thread")).toBeTruthy();
    const threadsLabel = screen.getByText("Threads");
    expect(threadsLabel.closest("a")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Collapse Threads" }),
    ).toBeNull();
  });

  it("shows a thread icon only for the projectless empty Threads section", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    await waitFor(() => {
      expect(screen.getAllByText("No threads")).toHaveLength(2);
    });
    const noThreadsLabels = screen.getAllByText("No threads");
    const projectEmptyRow = noThreadsLabels[0]?.closest("div");
    const projectlessEmptyRow = noThreadsLabels[1]?.closest("div");

    expect(projectEmptyRow?.querySelector("svg")).toBeNull();
    expect(projectEmptyRow?.className).toContain("py-0.5");
    expect(projectEmptyRow?.className).not.toContain("h-7");
    expect(projectEmptyRow?.className).toContain("pl-8");
    expect(projectEmptyRow?.className).toContain("pr-2");
    expect(noThreadsLabels[0]?.className).toContain("font-medium");
    expect(noThreadsLabels[0]?.className).toContain(
      "text-sidebar-foreground/85",
    );
    expect(projectEmptyRow?.parentElement?.className).toContain(
      "before:bg-border-hairline",
    );
    expect(projectlessEmptyRow?.querySelector("svg")).toBeTruthy();
    expect(projectlessEmptyRow?.className).toContain("py-0.5");
    expect(projectlessEmptyRow?.className).not.toContain("h-7");
    expect(projectlessEmptyRow?.className).toContain("px-2");
    expect(noThreadsLabels[1]?.className).not.toContain("font-medium");
    expect(noThreadsLabels[1]?.className).toContain("text-muted-foreground");
    expect(projectlessEmptyRow?.parentElement?.className).not.toContain(
      "before:bg-border-hairline",
    );
  });

  it("honors persisted top-level sidebar section order", async () => {
    window.localStorage.setItem(
      "bb.sidebar.sectionOrder",
      JSON.stringify(["threads", "projects"]),
    );
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
            }),
          ),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    await renderProjectList();

    const projectsLabel = await screen.findByText("Projects");
    const threadsLabel = screen.getByText("Threads");
    expect(
      Boolean(
        threadsLabel.compareDocumentPosition(projectsLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("collapses the conversation and moves the single selection to the opened app row", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerThread = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-app-select",
      title: "Sidebar Manager",
      titleFallback: "Sidebar Manager",
      type: "manager",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([[project.id, [managerThread]]]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerThread.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    // Start on the manager thread route so its row is the selected surface.
    window.history.pushState(
      null,
      "",
      `/projects/${project.id}/threads/${managerThread.id}`,
    );

    await renderProjectList(
      {},
      { extraUi: <ConversationCollapseProbe threadId={managerThread.id} /> },
    );

    const appRow = await screen.findByRole("button", {
      name: "Open Status app",
    });
    const findManagerRow = () =>
      screen
        .getByText("Sidebar Manager")
        .closest("[data-sidebar-sticky-tier='manager']");

    // Conversation active: the manager row owns the single selected highlight
    // and no app row is highlighted.
    expect(findManagerRow()?.className).toContain("bg-sidebar-border");
    expect(appRow.className).not.toContain("bg-sidebar-border");
    expect(
      screen.getByTestId(`conversation-collapsed:${managerThread.id}`)
        .textContent,
    ).toBe("false");

    fireEvent.click(appRow);

    // App opened: the conversation collapses and the app row becomes the single
    // selected row; the manager row drops its selected background.
    await waitFor(() => {
      expect(
        screen.getByTestId(`conversation-collapsed:${managerThread.id}`)
          .textContent,
      ).toBe("true");
    });
    expect(
      screen.getByRole("button", { name: "Open Status app" }).className,
    ).toContain("bg-sidebar-border");
    expect(findManagerRow()?.className).not.toContain("bg-sidebar-border");

    // Expanding the conversation flips the selection back to the manager row.
    fireEvent.click(
      screen.getByRole("button", {
        name: `expand-conversation:${managerThread.id}`,
      }),
    );

    await waitFor(() => {
      expect(findManagerRow()?.className).toContain("bg-sidebar-border");
    });
    expect(
      screen.getByRole("button", { name: "Open Status app" }).className,
    ).not.toContain("bg-sidebar-border");
  });

  it("restores the conversation when its thread row is selected while collapsed", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerThread = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-row-restore",
      title: "Sidebar Manager",
      titleFallback: "Sidebar Manager",
      type: "manager",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([[project.id, [managerThread]]]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerThread.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    // Start on the manager thread route so its row is the selected surface.
    window.history.pushState(
      null,
      "",
      `/projects/${project.id}/threads/${managerThread.id}`,
    );

    await renderProjectList(
      {},
      { extraUi: <ConversationCollapseProbe threadId={managerThread.id} /> },
    );

    // Opening the app collapses the conversation so the app fills the view.
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Status app" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId(`conversation-collapsed:${managerThread.id}`)
          .textContent,
      ).toBe("true");
    });

    // Selecting the agent/thread row is the inverse: it restores the
    // conversation by clearing this thread's own collapse flag.
    fireEvent.click(
      screen.getByRole("link", { name: "Open Sidebar Manager" }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(`conversation-collapsed:${managerThread.id}`)
          .textContent,
      ).toBe("false");
    });
  });

  it("keeps each thread's collapse state isolated when selecting another thread", async () => {
    const project = makeProjectResponse({
      id: "project-1",
      name: "Project One",
    });
    const managerA = makeThreadListEntry(project.id, 10, {
      id: "thread-manager-a",
      title: "Manager A",
      titleFallback: "Manager A",
      type: "manager",
    });
    const managerB = makeThreadListEntry(project.id, 9, {
      id: "thread-manager-b",
      title: "Manager B",
      titleFallback: "Manager B",
      type: "manager",
    });
    const personalProject = makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
      threads: [],
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            buildSidebarBootstrapResponse({
              personalProject,
              projects: [project],
              threadsByProjectId: new Map([[project.id, [managerA, managerB]]]),
            }),
          ),
      },
      {
        pathname: `/api/v1/threads/${managerA.id}/apps`,
        handler: () => jsonResponse([STATUS_APP]),
      },
      {
        pathname: `/api/v1/threads/${managerB.id}/apps`,
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/projects",
        handler: () => jsonResponse([project]),
      },
      {
        pathname: "/api/v1/threads",
        handler: () => jsonResponse([]),
      },
      {
        pathname: "/api/v1/system/config",
        handler: () =>
          jsonResponse({
            hostDaemonPort: null,
            voiceTranscriptionEnabled: false,
          }),
      },
      {
        pathname: "/api/v1/hosts",
        handler: () => jsonResponse([]),
      },
    ]);

    // Start on Manager A so opening its app targets A's thread.
    window.history.pushState(
      null,
      "",
      `/projects/${project.id}/threads/${managerA.id}`,
    );

    await renderProjectList(
      {},
      {
        extraUi: (
          <>
            <ConversationCollapseProbe threadId={managerA.id} />
            <ConversationCollapseProbe threadId={managerB.id} />
          </>
        ),
      },
    );

    // Collapse A's conversation by opening its app full-screen.
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Status app" }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId(`conversation-collapsed:${managerA.id}`).textContent,
      ).toBe("true");
    });
    // B was never collapsed.
    expect(
      screen.getByTestId(`conversation-collapsed:${managerB.id}`).textContent,
    ).toBe("false");

    // Selecting B's row restores only B and leaves A collapsed (full-screen app).
    fireEvent.click(screen.getByRole("link", { name: "Open Manager B" }));
    await waitFor(() => {
      expect(window.location.pathname).toBe(
        `/projects/${project.id}/threads/${managerB.id}`,
      );
    });
    expect(
      screen.getByTestId(`conversation-collapsed:${managerB.id}`).textContent,
    ).toBe("false");
    expect(
      screen.getByTestId(`conversation-collapsed:${managerA.id}`).textContent,
    ).toBe("true");

    // Reselecting A restores only A.
    fireEvent.click(screen.getByRole("link", { name: "Open Manager A" }));
    await waitFor(() => {
      expect(
        screen.getByTestId(`conversation-collapsed:${managerA.id}`).textContent,
      ).toBe("false");
    });
  });
});
