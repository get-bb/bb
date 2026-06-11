// @vitest-environment jsdom

// ProjectList owns the sidebar Workflows section's gating: the recent-runs
// fetch only fires when the workflows experiment is on, and the section only
// renders when it has runs. Row-level behavior (links, glyphs, archive/delete)
// lives in SidebarWorkflowsSection.test.tsx.

import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  ProjectResponse,
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeWorkflowRunResponse } from "@/test/fixtures/workflow-runs";
import {
  installFetchRoutes,
  jsonResponse,
  type FetchRoute,
} from "@/test/http-test-utils";
import { wsManager } from "@/lib/ws";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens";
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

function makePersonalProject(): ProjectWithThreadsResponse {
  return {
    ...makeProjectResponse({
      id: PERSONAL_PROJECT_ID,
      kind: "personal",
      name: "Personal",
    }),
    threads: [],
    defaultExecutionOptions: null,
  };
}

function buildSidebarNavigationResponse(args: {
  personalProject: ProjectWithThreadsResponse;
  projects: ProjectResponse[];
}): SidebarBootstrapResponse {
  return {
    projects: args.projects.map((project) => ({
      ...project,
      threads: [],
      defaultExecutionOptions: null,
    })),
    personalProject: args.personalProject,
  };
}

interface InstallSidebarRoutesArgs {
  routes?: FetchRoute[];
  workflowsExperimentEnabled: boolean;
}

// The sidebar lists global apps unconditionally and recent workflow runs when
// the workflows experiment is on; default both to empty lists when a test
// doesn't register the route itself.
function installSidebarFetchRoutes({
  routes = [],
  workflowsExperimentEnabled,
}: InstallSidebarRoutesArgs) {
  const project = makeProjectResponse();
  const defaultedRoutes: FetchRoute[] = [
    ...routes,
    {
      pathname: "/api/v1/sidebar-bootstrap",
      handler: () =>
        jsonResponse(
          buildSidebarNavigationResponse({
            personalProject: makePersonalProject(),
            projects: [project],
          }),
        ),
    },
    { pathname: "/api/v1/projects", handler: () => jsonResponse([project]) },
    { pathname: "/api/v1/threads", handler: () => jsonResponse([]) },
    { pathname: "/api/v1/hosts", handler: () => jsonResponse([]) },
    {
      pathname: "/api/v1/system/config",
      handler: () =>
        jsonResponse({
          experiments: {
            claudeCodeMockCliTraffic: false,
            workflows: workflowsExperimentEnabled,
          },
          hostDaemonPort: null,
          voiceTranscriptionEnabled: false,
        }),
    },
  ];
  for (const pathname of ["/api/v1/workflow-runs"]) {
    if (!defaultedRoutes.some((route) => route.pathname === pathname)) {
      defaultedRoutes.push({ pathname, handler: () => jsonResponse([]) });
    }
  }
  return installFetchRoutes(defaultedRoutes);
}

function createProjectListWrapper() {
  const harness = createQueryClientTestHarness();

  function ProjectListWrapper({ children }: { children: ReactNode }) {
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

  return ProjectListWrapper;
}

async function renderProjectList(): Promise<void> {
  const wrapper = createProjectListWrapper();
  await act(async () => {
    render(<ProjectList />, { wrapper });
  });
}

afterEach(() => {
  wsManager.disconnect();
  cleanup();
  resetFakeReconnectingWebSockets();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectList Workflows section", () => {
  it("lists recent workflow runs in a top-level Workflows section", async () => {
    const run = makeWorkflowRunResponse({
      id: "wfr_sidebar",
      workflowName: "deep-research",
      status: "completed",
    });
    installSidebarFetchRoutes({
      workflowsExperimentEnabled: true,
      routes: [
        { pathname: "/api/v1/workflow-runs", handler: () => jsonResponse([run]) },
      ],
    });

    await renderProjectList();

    const runLink = await screen.findByRole("link", {
      name: "Open deep-research workflow run",
    });
    expect(runLink.getAttribute("href")).toBe("/workflows/runs/wfr_sidebar");
    const workflowsLabel = screen.getByText("Workflows");
    expect(
      workflowsLabel.closest('[data-sidebar-sticky-tier="label"]')?.className,
    ).toContain(CHROME_SECTION_LABEL_CLASS);
    // Default order places Workflows after the Threads section.
    expect(
      Boolean(
        screen.getByText("Threads").compareDocumentPosition(workflowsLabel) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Collapse Workflows section" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("hides the Workflows section when there are no recent runs", async () => {
    installSidebarFetchRoutes({ workflowsExperimentEnabled: true });

    await renderProjectList();

    expect(await screen.findByText("Projects")).toBeTruthy();
    expect(screen.queryByText("Workflows")).toBeNull();
  });

  it("hides the Workflows section and skips the run fetch when the workflows experiment is off", async () => {
    let workflowRunsRequestCount = 0;
    installSidebarFetchRoutes({
      workflowsExperimentEnabled: false,
      routes: [
        {
          pathname: "/api/v1/workflow-runs",
          handler: () => {
            workflowRunsRequestCount += 1;
            return jsonResponse([]);
          },
        },
      ],
    });

    await renderProjectList();

    expect(await screen.findByText("Projects")).toBeTruthy();
    expect(screen.queryByText("Workflows")).toBeNull();
    expect(workflowRunsRequestCount).toBe(0);
  });
});
