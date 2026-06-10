// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  SidebarBootstrapResponse,
  ThreadListResponse,
} from "@bb/server-contract";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { threadListQueryKey } from "./queries/query-keys";
import { THREAD_MENTION_CANDIDATE_LIMIT } from "./queries/thread-queries";
import { usePromptMentions } from "./usePromptMentions";

interface TestWrapperProps {
  children: ReactNode;
}

type ThreadListEntryFixture = ThreadListResponse[number];
type ThreadListEntryFixtureOverrides = Partial<ThreadListEntryFixture>;
type SidebarProjectFixture = SidebarBootstrapResponse["projects"][number];

interface ProjectFixtureOptions {
  id: string;
  kind?: SidebarProjectFixture["kind"];
  name: string;
  threads?: ThreadListResponse;
}

function makeThreadListEntry(
  overrides: ThreadListEntryFixtureOverrides = {},
): ThreadListEntryFixture {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    environmentBranchName: "main",
    environmentHostId: "host-1",
    environmentName: null,
    environmentWorkspaceDisplayKind: "managed-worktree",
    hasPendingInteraction: false,
    id: "thr_default",
    lastReadAt: null,
    latestAttentionAt: 1,
    parentThreadId: null,
    pinSortKey: null,
    pinnedAt: null,
    projectId: "proj_code",
    providerId: "codex",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    status: "idle",
    stopRequestedAt: null,
    title: "Default thread",
    titleFallback: "Default thread",
    updatedAt: 1,
    ...overrides,
  };
}

function makeProjectFixture(
  options: ProjectFixtureOptions,
): SidebarProjectFixture {
  return {
    createdAt: 1,
    defaultExecutionOptions: null,
    id: options.id,
    kind: options.kind ?? "standard",
    name: options.name,
    sources: [],
    threads: options.threads ?? [],
    updatedAt: 1,
  };
}

function makeSidebarBootstrapResponse(
  projects: readonly SidebarProjectFixture[],
): SidebarBootstrapResponse {
  return {
    personalProject: makeProjectFixture({
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
    }),
    projects: [...projects],
  };
}

function createWrapper() {
  const harness = createQueryClientTestHarness();

  function Wrapper({ children }: TestWrapperProps) {
    return harness.wrapper({ children });
  }

  return {
    queryClient: harness.queryClient,
    wrapper: Wrapper,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePromptMentions", () => {
  it("returns global active thread title matches in all mode", async () => {
    const projectId = "proj_code";
    const threads: ThreadListResponse = [
      makeThreadListEntry({
        id: "thr_frontend_parent",
        projectId,
        title: "Frontend Parent",
        titleFallback: "Frontend Parent",
      }),
      makeThreadListEntry({
        id: "thr_other_project_frontend",
        projectId: "proj_other",
        title: "Frontend notes",
        titleFallback: "Frontend notes",
      }),
      makeThreadListEntry({
        id: "thr_parser_refactor",
        projectId,
        title: "Parser refactor",
        titleFallback: "Parser refactor",
      }),
    ];
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: (request) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("archived")).toBe("false");
          expect(url.searchParams.get("limit")).toBe(
            String(THREAD_MENTION_CANDIDATE_LIMIT),
          );
          expect(url.searchParams.has("projectId")).toBe(false);
          return jsonResponse(threads);
        },
      },
      {
        pathname: `/api/v1/projects/${projectId}/paths`,
        handler: () => jsonResponse({ paths: [], truncated: false }),
      },
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            makeSidebarBootstrapResponse([
              makeProjectFixture({ id: projectId, name: "Code" }),
              makeProjectFixture({ id: "proj_other", name: "Other Project" }),
            ]),
          ),
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        usePromptMentions(projectId, {
          environmentId: null,
        }),
      { wrapper },
    );

    act(() => {
      result.current.setQuery("frontend");
    });

    await waitFor(() => {
      expect(result.current.suggestions.length).toBeGreaterThan(0);
    });
    const firstSuggestion = result.current.suggestions[0];
    if (!firstSuggestion || firstSuggestion.kind !== "thread") {
      throw new Error(
        "Expected first prompt mention suggestion to be a thread",
      );
    }
    expect(firstSuggestion.threadId).toBe("thr_frontend_parent");
    expect(firstSuggestion.title).toBe("Frontend Parent");
    expect(firstSuggestion.replacement).toBe("thread:thr_frontend_parent");

    await waitFor(() => {
      const crossProjectSuggestion = result.current.suggestions.find(
        (suggestion) =>
          suggestion.kind === "thread" &&
          suggestion.threadId === "thr_other_project_frontend",
      );
      expect(crossProjectSuggestion).toMatchObject({
        kind: "thread",
        projectName: "Other Project",
      });
    });
  });

  it("ranks same-project thread matches ahead of equally relevant cross-project matches", async () => {
    const projectId = "proj_code";
    const threads: ThreadListResponse = [
      makeThreadListEntry({
        id: "thr_other_project_shared",
        projectId: "proj_other",
        title: "Shared context",
        titleFallback: "Shared context",
      }),
      makeThreadListEntry({
        id: "thr_current_project_shared",
        projectId,
        title: "Shared context",
        titleFallback: "Shared context",
      }),
    ];
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: (request) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("archived")).toBe("false");
          expect(url.searchParams.get("limit")).toBe(
            String(THREAD_MENTION_CANDIDATE_LIMIT),
          );
          expect(url.searchParams.has("projectId")).toBe(false);
          return jsonResponse(threads);
        },
      },
      {
        pathname: `/api/v1/projects/${projectId}/paths`,
        handler: () => jsonResponse({ paths: [], truncated: false }),
      },
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            makeSidebarBootstrapResponse([
              makeProjectFixture({ id: projectId, name: "Code" }),
              makeProjectFixture({ id: "proj_other", name: "Other Project" }),
            ]),
          ),
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        usePromptMentions(projectId, {
          environmentId: null,
        }),
      { wrapper },
    );

    act(() => {
      result.current.setQuery("shared");
    });

    await waitFor(() => {
      expect(result.current.suggestions.length).toBeGreaterThan(0);
    });
    const firstSuggestion = result.current.suggestions[0];
    if (!firstSuggestion || firstSuggestion.kind !== "thread") {
      throw new Error(
        "Expected first prompt mention suggestion to be a thread",
      );
    }
    expect(firstSuggestion.threadId).toBe("thr_current_project_shared");
  });

  it("uses cached thread lists as placeholder candidates while the capped global request is pending", async () => {
    const projectId = "proj_code";
    const cachedThreads: ThreadListResponse = [
      makeThreadListEntry({
        id: "thr_cached_frontend",
        projectId,
        title: "Cached frontend notes",
        titleFallback: "Cached frontend notes",
      }),
    ];
    let resolveThreadRequest: (response: Response) => void = () => {};
    const pendingThreadResponse = new Promise<Response>((resolve) => {
      resolveThreadRequest = resolve;
    });
    let threadRequestCount = 0;
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: (request) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("archived")).toBe("false");
          expect(url.searchParams.get("limit")).toBe(
            String(THREAD_MENTION_CANDIDATE_LIMIT),
          );
          expect(url.searchParams.has("projectId")).toBe(false);
          threadRequestCount += 1;
          return pendingThreadResponse;
        },
      },
      {
        pathname: `/api/v1/projects/${projectId}/paths`,
        handler: () => jsonResponse({ paths: [], truncated: false }),
      },
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            makeSidebarBootstrapResponse([
              makeProjectFixture({
                id: projectId,
                name: "Code",
                threads: cachedThreads,
              }),
            ]),
          ),
      },
    ]);
    const { queryClient, wrapper } = createWrapper();
    queryClient.setQueryData<ThreadListResponse>(
      threadListQueryKey({ archived: false, projectId }),
      cachedThreads,
    );

    const { result } = renderHook(
      () =>
        usePromptMentions(projectId, {
          environmentId: null,
        }),
      { wrapper },
    );

    act(() => {
      result.current.setQuery("cached frontend");
    });

    await waitFor(() => {
      expect(threadRequestCount).toBe(1);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.suggestions[0]).toMatchObject({
        kind: "thread",
        threadId: "thr_cached_frontend",
      });
    });

    resolveThreadRequest(jsonResponse(cachedThreads));
  });

  it("does not carry stale thread-query errors after the mention session closes", async () => {
    const projectId = "proj_code";
    let shouldFailThreadRequest = true;
    let threadRequestCount = 0;
    let resolveThreadRequest: (response: Response) => void = () => {};
    const pendingThreadResponse = new Promise<Response>((resolve) => {
      resolveThreadRequest = resolve;
    });
    installFetchRoutes([
      {
        pathname: "/api/v1/threads",
        handler: () => {
          threadRequestCount += 1;
          return shouldFailThreadRequest
            ? jsonResponse(
                { error: "thread candidates failed" },
                { status: 500 },
              )
            : pendingThreadResponse;
        },
      },
      {
        pathname: `/api/v1/projects/${projectId}/paths`,
        handler: () => jsonResponse({ paths: [], truncated: false }),
      },
      {
        pathname: "/api/v1/sidebar-bootstrap",
        handler: () =>
          jsonResponse(
            makeSidebarBootstrapResponse([
              makeProjectFixture({ id: projectId, name: "Code" }),
            ]),
          ),
      },
    ]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        usePromptMentions(projectId, {
          environmentId: null,
        }),
      { wrapper },
    );

    act(() => {
      result.current.setQuery("frontend");
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    act(() => {
      result.current.setQuery(null);
    });

    await waitFor(() => {
      expect(result.current.query).toBeNull();
      expect(result.current.isError).toBe(false);
      expect(result.current.suggestions).toEqual([]);
    });

    shouldFailThreadRequest = false;
    act(() => {
      result.current.setQuery("backend");
    });

    await waitFor(() => {
      expect(threadRequestCount).toBe(2);
      expect(result.current.isError).toBe(false);
    });

    resolveThreadRequest(jsonResponse([]));
  });
});
