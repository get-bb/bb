// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { sdk } from "@/lib/sdk";
import { resetSidebarBootstrapCacheForTest } from "@/lib/sidebar-bootstrap-cache";
import { sidebarNavigationQueryKey } from "./queries/query-keys";
import { usePromptMentions } from "./usePromptMentions";

const queryClients: ReturnType<
  typeof createQueryClientTestHarness
>["queryClient"][] = [];

afterEach(() => {
  cleanup();
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSidebarBootstrapCacheForTest();
  window.localStorage.clear();
});

function navigation(count = 1): SidebarBootstrapResponse {
  return makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({
        id: "proj_picker",
        name: "Picker project",
        threads: Array.from({ length: count }, (_, index) =>
          makeThreadListEntry({
            id: `thr_picker_${index}`,
            projectId: "proj_picker",
            title: `Catalog entry ${index}`,
            titleFallback: null,
            createdAt: index + 1,
            updatedAt: index + 1,
          }),
        ),
      }),
    ],
  });
}

function setup(initial: SidebarBootstrapResponse) {
  let serverNavigation = initial;
  const pathQueries: string[] = [];
  vi.spyOn(sdk.system, "config").mockResolvedValue(makeSystemConfig());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
        "http://localhost",
      );
      let body: unknown;
      if (url.pathname === "/api/v1/sidebar-bootstrap") {
        body = serverNavigation;
      } else if (url.pathname === "/api/v1/plugins/contributions") {
        body = { threadActions: [], mentionProviders: [] };
      } else if (url.pathname === "/api/v1/projects/proj_picker/paths") {
        const query = url.searchParams.get("query") ?? "";
        pathQueries.push(query);
        if (query === "Catalog entry") return new Promise<Response>(() => {});
        body = {
          paths:
            query === "cedar"
              ? [
                  {
                    kind: "file",
                    path: "notes/cedar.md",
                    name: "cedar.md",
                    score: 100,
                    positions: [],
                  },
                ]
              : [],
        };
      } else if (url.pathname === "/api/v1/threads") {
        body = serverNavigation.projects.flatMap((project) => project.threads);
      } else {
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const { queryClient, wrapper } = createQueryClientTestHarness();
  queryClients.push(queryClient);
  queryClient.setQueryData(sidebarNavigationQueryKey(), initial);
  const hook = renderHook(
    () =>
      usePromptMentions("proj_picker", {
        environmentId: null,
      }),
    { wrapper },
  );
  return {
    ...hook,
    pathQueries,
    updateServer(next: SidebarBootstrapResponse) {
      serverNavigation = next;
    },
    search(query: string | null) {
      act(() => hook.result.current.setQuery(query, "@"));
    },
  };
}

it("finds an exact title after the first two hundred sidebar threads", async () => {
  const picker = setup(navigation(215));
  picker.search("Catalog entry 214");
  await waitFor(() =>
    expect(picker.pathQueries).toContain("Catalog entry 214"),
  );
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "thread", threadId: "thr_picker_214" }),
    ),
  );
});

it("refreshes a server rename when mentions reopen without a realtime event", async () => {
  const initial = navigation();
  const picker = setup(initial);
  picker.search("Catalog entry 0");
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "thread", threadId: "thr_picker_0" }),
    ),
  );
  picker.search(null);
  picker.updateServer(navigationWithRenamedThread(initial));
  picker.search("Revised checklist");
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({
        kind: "thread",
        threadId: "thr_picker_0",
        title: "Revised checklist",
      }),
    ),
  );
});

function navigationWithRenamedThread(
  initial: SidebarBootstrapResponse,
): SidebarBootstrapResponse {
  return {
    ...initial,
    projects: initial.projects.map((project) => ({
      ...project,
      threads: project.threads.map((thread) => ({
        ...thread,
        title: "Revised checklist",
      })),
    })),
  };
}

it("discovers a server project when mentions reopen without a realtime event", async () => {
  const initial = navigation();
  const picker = setup(initial);
  picker.search("Picker project");
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "project", projectId: "proj_picker" }),
    ),
  );
  picker.search(null);
  picker.updateServer({
    ...initial,
    projects: [
      ...initial.projects,
      makeProjectWithThreadsResponse({
        id: "proj_added",
        name: "Additional workspace",
      }),
    ],
  });
  picker.search("Additional workspace");
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "project", projectId: "proj_added" }),
    ),
  );
});

it.each(["debounce", "request"])(
  "removes outdated path rows during %s",
  async (stage) => {
    const picker = setup(navigation());
    picker.search("cedar");
    await waitFor(() =>
      expect(picker.result.current.results.suggestions).toContainEqual(
        expect.objectContaining({ kind: "path", path: "notes/cedar.md" }),
      ),
    );
    picker.search("Catalog entry");
    if (stage === "request") {
      await waitFor(() =>
        expect(picker.pathQueries).toContain("Catalog entry"),
      );
    }
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "thread", threadId: "thr_picker_0" }),
    );
    expect(
      picker.result.current.results.suggestions.filter(
        (row) => row.kind === "path",
      ),
    ).toEqual([]);
  },
);
