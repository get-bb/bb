import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  archivedThreadsListQueryKey,
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
} from "@/lib/query/query-keys";
import {
  project,
  sidebarBootstrap,
  threadListEntry,
  threadResponse,
} from "../test/fixtures";
import {
  findCachedThreadListEntry,
  getCachedSidebarThreads,
  insertThreadIntoCachedLists,
} from "./thread-list-cache";
import {
  applyThreadPinStateResult,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  beginPinThreadTransaction,
  beginThreadMetadataTransaction,
  beginThreadReadStateTransaction,
  beginUnarchiveThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackThreadListMutation,
} from "./thread-state-cache";

function seed() {
  const queryClient = new QueryClient();
  const parent = threadListEntry({
    id: "t1",
    latestAttentionAt: 50,
    lastReadAt: 10,
  });
  const child = threadListEntry({ id: "t1c", parentThreadId: "t1" });
  const other = threadListEntry({ id: "t2", projectId: "proj_2" });
  const personal = threadListEntry({
    id: "tp",
    projectId: PERSONAL_PROJECT_ID,
  });
  const archived = threadListEntry({ id: "ta", archivedAt: 5 });
  queryClient.setQueryData(
    sidebarNavigationQueryKey(),
    sidebarBootstrap({
      projects: [
        project({ id: "proj_1", threads: [parent, child] }),
        project({ id: "proj_2", threads: [other] }),
      ],
      personalProject: project({
        id: PERSONAL_PROJECT_ID,
        kind: "personal",
        threads: [personal],
      }),
    }),
  );
  queryClient.setQueryData(
    threadListQueryKey({ archived: false, projectId: "proj_1" }),
    [parent, child],
  );
  queryClient.setQueryData(archivedThreadsListQueryKey({}), {
    pageParams: [0],
    pages: [[archived]],
  });
  queryClient.setQueryData(
    threadQueryKey("t1"),
    threadResponse({ id: "t1", latestAttentionAt: 50, lastReadAt: 10 }),
  );
  queryClient.setQueryData(
    threadQueryKey("ta"),
    threadResponse({ id: "ta", archivedAt: 5 }),
  );
  return { queryClient, parent, child, other, personal, archived };
}

function sidebarThreadIds(queryClient: QueryClient): string[] {
  return getCachedSidebarThreads(queryClient).map((thread) => thread.id);
}

function projectList(queryClient: QueryClient): ThreadListEntry[] | undefined {
  return queryClient.getQueryData<ThreadListEntry[]>(
    threadListQueryKey({ archived: false, projectId: "proj_1" }),
  );
}

describe("thread state cache transactions", () => {
  it("pin patches the detail, every list, and the sidebar; rollback restores all three", async () => {
    const { queryClient } = seed();
    const transaction = await beginPinThreadTransaction({
      queryClient,
      threadId: "t1",
      pinnedAt: 123,
    });
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))?.pinnedAt,
    ).toBe(123);
    expect(projectList(queryClient)?.[0]).toMatchObject({
      pinnedAt: 123,
      pinSortKey: null,
    });
    expect(findCachedThreadListEntry(queryClient, "t1")?.pinnedAt).toBe(123);
    // Untouched rows keep their identity (structural sharing for renderers).
    const beforeOther = getCachedSidebarThreads(queryClient).find(
      (t) => t.id === "t2",
    );

    rollbackThreadListMutation({ queryClient, threadId: "t1" }, transaction);
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))?.pinnedAt,
    ).toBeNull();
    expect(projectList(queryClient)?.[0].pinnedAt).toBeNull();
    expect(findCachedThreadListEntry(queryClient, "t1")?.pinnedAt).toBeNull();
    expect(
      getCachedSidebarThreads(queryClient).find((t) => t.id === "t2"),
    ).toEqual(beforeOther);
  });

  it("applies the pin response to lists without inventing a pinSortKey", () => {
    const { queryClient } = seed();
    applyThreadPinStateResult(
      queryClient,
      threadResponse({ id: "t1", pinnedAt: 7 }),
    );
    expect(projectList(queryClient)?.[0]).toMatchObject({
      pinnedAt: 7,
      pinSortKey: null,
    });
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))?.pinnedAt,
    ).toBe(7);
  });

  it("read state: mark read never trails latestAttentionAt; mark unread clears", async () => {
    const { queryClient } = seed();
    await beginThreadReadStateTransaction({
      queryClient,
      threadId: "t1",
      lastReadAt: 20,
    });
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))
        ?.lastReadAt,
    ).toBe(50);
    expect(findCachedThreadListEntry(queryClient, "t1")?.lastReadAt).toBe(50);
    await beginThreadReadStateTransaction({
      queryClient,
      threadId: "t1",
      lastReadAt: null,
    });
    expect(findCachedThreadListEntry(queryClient, "t1")?.lastReadAt).toBeNull();
  });

  it("metadata: rename and section move only touch the given fields", async () => {
    const { queryClient } = seed();
    await beginThreadMetadataTransaction({
      queryClient,
      threadId: "t1",
      title: "Renamed",
    });
    expect(findCachedThreadListEntry(queryClient, "t1")).toMatchObject({
      title: "Renamed",
      sectionId: null,
    });
    await beginThreadMetadataTransaction({
      queryClient,
      threadId: "t1",
      sectionId: "sec",
    });
    expect(findCachedThreadListEntry(queryClient, "t1")).toMatchObject({
      title: "Renamed",
      sectionId: "sec",
    });
  });

  it("archive-all removes the thread and its children from live lists and stamps archivedAt on cached details; rollback restores", async () => {
    const { queryClient } = seed();
    const transaction = await beginArchiveThreadAndChildrenTransaction({
      queryClient,
      threadId: "t1",
    });
    expect(transaction.archivedThreadIds.sort()).toEqual(["t1", "t1c"]);
    expect(sidebarThreadIds(queryClient)).toEqual(["t2", "tp"]);
    expect(projectList(queryClient)).toEqual([]);
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))
        ?.archivedAt,
    ).toEqual(expect.any(Number));
    // The archived (paginated) list is untouched.
    expect(
      queryClient.getQueryData<{ pages: ThreadListEntry[][] }>(
        archivedThreadsListQueryKey({}),
      )?.pages[0],
    ).toHaveLength(1);

    rollbackArchiveThreadsTransaction(queryClient, transaction);
    expect(sidebarThreadIds(queryClient)).toEqual(["t1", "t1c", "t2", "tp"]);
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))
        ?.archivedAt,
    ).toBeNull();
  });

  it("unarchive drops the row from the paginated archived list and clears archivedAt on the detail", async () => {
    const { queryClient } = seed();
    await beginUnarchiveThreadTransaction({ queryClient, threadId: "ta" });
    expect(
      queryClient.getQueryData<{ pages: ThreadListEntry[][] }>(
        archivedThreadsListQueryKey({}),
      )?.pages[0],
    ).toEqual([]);
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("ta"))
        ?.archivedAt,
    ).toBeNull();
  });

  it("delete removes the row everywhere and evicts thread-scoped queries; rollback brings the row back", async () => {
    const { queryClient } = seed();
    queryClient.setQueryData(threadTimelineQueryKey("t1"), { rows: [] });
    const transaction = await beginDeleteThreadTransaction({
      queryClient,
      threadId: "t1",
    });
    expect(sidebarThreadIds(queryClient)).toEqual(["t1c", "t2", "tp"]);
    expect(queryClient.getQueryData(threadQueryKey("t1"))).toBeUndefined();
    expect(
      queryClient.getQueryData(threadTimelineQueryKey("t1")),
    ).toBeUndefined();
    rollbackThreadListMutation({ queryClient, threadId: "t1" }, transaction);
    expect(sidebarThreadIds(queryClient)).toEqual(["t1", "t1c", "t2", "tp"]);
    expect(
      queryClient.getQueryData<ThreadListEntry>(threadQueryKey("t1"))?.id,
    ).toBe("t1");
  });
});

describe("insertThreadIntoCachedLists", () => {
  it("prepends a created thread to matching flat lists and its project's sidebar rows only", () => {
    const { queryClient } = seed();
    queryClient.setQueryData(
      threadListQueryKey({ archived: false, projectId: "proj_2" }),
      [],
    );
    queryClient.setQueryData(threadListQueryKey({ archived: true }), []);
    const created = threadResponse({
      id: "new",
      projectId: "proj_1",
      createdAt: 99,
    });
    insertThreadIntoCachedLists(queryClient, created);
    expect(projectList(queryClient)?.map((t) => t.id)).toEqual([
      "new",
      "t1",
      "t1c",
    ]);
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(
        threadListQueryKey({ archived: false, projectId: "proj_2" }),
      ),
    ).toEqual([]);
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(
        threadListQueryKey({ archived: true }),
      ),
    ).toEqual([]);
    const sidebar = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(sidebar?.projects[0].threads.map((t) => t.id)).toEqual([
      "new",
      "t1",
      "t1c",
    ]);
    expect(sidebar?.projects[1].threads.map((t) => t.id)).toEqual(["t2"]);
    expect(sidebar?.projects[0].threads[0]).toMatchObject({
      pinSortKey: null,
      hasPendingInteraction: false,
      environmentWorkspaceDisplayKind: "other",
    });
    // Idempotent.
    insertThreadIntoCachedLists(queryClient, created);
    expect(projectList(queryClient)).toHaveLength(3);
  });

  it("puts a personal thread under the personal project", () => {
    const { queryClient } = seed();
    insertThreadIntoCachedLists(
      queryClient,
      threadResponse({ id: "np", projectId: PERSONAL_PROJECT_ID }),
    );
    const sidebar = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(sidebar?.personalProject.threads.map((t) => t.id)).toEqual([
      "np",
      "tp",
    ]);
  });
});
