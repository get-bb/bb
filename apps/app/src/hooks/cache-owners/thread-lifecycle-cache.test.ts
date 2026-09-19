import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
} from "../queries/query-keys";
import {
  getCachedSidebarNavigationThreads,
  optimisticallyInsertThread,
  updateCachedThreadListStatusState,
} from "./query-cache";
import { applyQueuedMessageDeleteResult } from "./thread-runtime-cache-owner";

function setup() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          id: "project-1",
          threads: [
            makeThreadListEntry({
              id: "draft",
              projectId: "project-1",
              lifecycle: "draft",
              status: "pending",
            }),
          ],
        }),
      ],
    }),
  );
  return queryClient;
}

describe("sidebar lifecycle cache", () => {
  it("moves a sent draft to Active on realtime status and preserves Archived priority", () => {
    const queryClient = setup();
    const archivedKey = archivedThreadsListQueryKey({});
    const archived = makeThreadListEntry({
      id: "archived",
      lifecycle: "archived",
      archivedAt: 1,
    });
    queryClient.setQueryData(archivedKey, {
      pages: [[archived]],
      pageParams: [0],
    });
    const active = makeThreadListEntry({ status: "active" });
    const statusChange = {
      status: active.status,
      runtime: active.runtime,
      activity: active.activity,
      latestAttentionAt: active.latestAttentionAt,
      updatedAt: active.updatedAt,
    };
    updateCachedThreadListStatusState(queryClient, "draft", statusChange);
    updateCachedThreadListStatusState(queryClient, "archived", statusChange);
    expect(getCachedSidebarNavigationThreads(queryClient)[0]?.lifecycle).toBe(
      "active",
    );
    expect(queryClient.getQueryData(archivedKey)).toMatchObject({
      pages: [[{ lifecycle: "archived" }]],
    });
  });

  it("corrects an early pending bootstrap row when Save draft completes without reverting an admitted thread", () => {
    const queryClient = setup();
    const thread = makeThreadResponse({
      id: "saved",
      projectId: "project-1",
      status: "pending",
    });
    optimisticallyInsertThread(queryClient, thread);
    optimisticallyInsertThread(queryClient, thread, "draft");
    expect(
      getCachedSidebarNavigationThreads(queryClient).find(
        (entry) => entry.id === "saved",
      )?.lifecycle,
    ).toBe("draft");
    const active = makeThreadListEntry({ status: "active" });
    updateCachedThreadListStatusState(queryClient, "saved", {
      status: active.status,
      runtime: active.runtime,
      activity: active.activity,
      latestAttentionAt: active.latestAttentionAt,
      updatedAt: active.updatedAt,
    });
    optimisticallyInsertThread(queryClient, thread, "draft");
    expect(
      getCachedSidebarNavigationThreads(queryClient).find(
        (entry) => entry.id === "saved",
      )?.lifecycle,
    ).toBe("active");
  });

  it("refreshes bootstrap and archived membership after deleting a held message", () => {
    const queryClient = setup();
    const archivedKey = archivedThreadsListQueryKey({});
    queryClient.setQueryData(archivedKey, { pages: [[]], pageParams: [0] });
    applyQueuedMessageDeleteResult({ queryClient, threadId: "draft" });
    expect(
      queryClient.getQueryState(sidebarNavigationQueryKey())?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
    expect(getCachedSidebarNavigationThreads(queryClient)[0]?.id).toBe("draft");
  });
});
