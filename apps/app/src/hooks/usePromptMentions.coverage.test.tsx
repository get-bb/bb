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

function navigation(count: number): SidebarBootstrapResponse {
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
        body = initial;
      } else if (url.pathname === "/api/v1/plugins/contributions") {
        body = { threadActions: [], mentionProviders: [] };
      } else if (url.pathname === "/api/v1/projects/proj_picker/paths") {
        body = { paths: [] };
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
    () => usePromptMentions("proj_picker", { environmentId: null }),
    { wrapper },
  );
  return {
    ...hook,
    search(query: string) {
      act(() => hook.result.current.setQuery(query, "@"));
    },
  };
}

it("finds an exact title after the first two hundred sidebar threads", async () => {
  const picker = setup(navigation(215));
  picker.search("Catalog entry 214");
  await waitFor(() =>
    expect(picker.result.current.results.suggestions).toContainEqual(
      expect.objectContaining({ kind: "thread", threadId: "thr_picker_214" }),
    ),
  );
});
