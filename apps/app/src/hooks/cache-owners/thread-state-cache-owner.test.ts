import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { makeThreadWithRuntime as makeThreadWithRuntimeFixture } from "@bb/test-helpers/domain-fixtures";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadListEntry as makeThreadListEntryFixture } from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import {
  applyThreadReadStateResult,
  applyThreadUpdateResult,
  applyThreadPinStateResult,
  applyPinnedThreadOrderResult,
  applyThreadMetadataBatchResult,
  beginThreadMetadataBatchTransaction,
  rollbackThreadMetadataBatchTransaction,
  beginArchiveThreadAndChildrenTransaction,
  beginDeleteThreadTransaction,
  rollbackArchiveThreadsTransaction,
  rollbackDeleteThreadTransaction,
  beginThreadReadStateTransaction,
  beginThreadMetadataTransaction,
  rollbackThreadListMutationTransaction,
  rollbackThreadReadStateTransaction,
} from "./thread-state-cache-owner";

import {
  updateCachedThreadStatusState,
  updateCachedThreadListStatusState,
} from "./query-cache";
import { beginSendThreadMessageTransaction } from "./thread-runtime-cache-owner";

function makeThreadWithRuntime(
  thread: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return makeThreadWithRuntimeFixture({
    id: "thread-1",
    projectId: "project-1",
    environmentId: "env-1",
    title: null,
    titleFallback: null,
    status: "active",
    lastReadAt: null,
    latestAttentionAt: 50,
    createdAt: 1,
    updatedAt: 1,
    runtime: {
      displayStatus: "waiting-for-host",
    },
    ...thread,
  });
}

function makeThreadListEntry(
  thread: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return makeThreadListEntryFixture({
    ...makeThreadWithRuntime(),
    environmentHostId: "host-1",
    environmentName: "Environment",
    environmentBranchName: "main",
    ...thread,
  });
}

function makeSidebarNavigation(
  threads: ThreadListEntry[],
): SidebarBootstrapResponse {
  return makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({
        id: "project-1",
        name: "Project",
        createdAt: 1,
        updatedAt: 1,
        threads,
      }),
    ],
  });
}

describe("thread state cache owner", () => {
  it.each([null, 100])(
    "preserves a follow-up's active state when a delayed read acknowledgement arrives (%s)",
    async (lastReadAt) => {
      const { queryClient } = createQueryClientTestHarness();
      const original = makeThreadListEntry({
        status: "idle",
        runtime: { displayStatus: "idle" },
        lastReadAt: 10,
      });
      const listKey = threadListQueryKey({
        projectId: "project-1",
        archived: false,
      });
      queryClient.setQueryData(
        threadQueryKey(original.id),
        makeThreadWithRuntime(original),
      );
      queryClient.setQueryData(listKey, [original]);
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarNavigation([original]),
      );
      await beginThreadReadStateTransaction({
        queryClient,
        threadId: original.id,
        lastReadAt,
      });
      await beginSendThreadMessageTransaction({
        queryClient,
        request: {
          id: original.id,
          input: [{ type: "text", text: "Follow up", mentions: [] }],
          mode: "auto",
        },
      });
      const activeThread = queryClient.getQueryData<ThreadWithRuntime>(
        threadQueryKey(original.id),
      );
      const activeEntry = makeThreadListEntry({
        ...original,
        ...activeThread,
        title: "Updated title",
        latestAttentionAt: 200,
      });
      queryClient.setQueryData(listKey, [activeEntry]);
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarNavigation([activeEntry]),
      );
      const activeList = queryClient.getQueryData<ThreadListEntry[]>(listKey);
      const activeSidebar = queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      );
      expect(activeThread?.runtime.displayStatus).toBe("active");
      applyThreadReadStateResult({
        queryClient,
        thread: makeThreadWithRuntime({ ...original, lastReadAt }),
      });
      expect(queryClient.getQueryData(threadQueryKey(original.id))).toEqual({
        ...activeThread,
        lastReadAt,
      });
      expect(queryClient.getQueryData(listKey)).toEqual(
        activeList?.map((thread) => ({ ...thread, lastReadAt })),
      );
      expect(
        queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarNavigationQueryKey(),
        )?.projects[0]?.threads,
      ).toEqual(
        activeSidebar?.projects[0]?.threads.map((thread) => ({
          ...thread,
          lastReadAt,
        })),
      );
    },
  );
  it.each(["archive", "delete"])(
    "optimistically removes a whole thread family on %s and restores it without losing unrelated changes",
    async (operation) => {
      const { queryClient } = createQueryClientTestHarness();
      const entries = [
        makeThreadListEntry({ id: "root" }),
        makeThreadListEntry({ id: "child", parentThreadId: "root" }),
        makeThreadListEntry({ id: "grandchild", parentThreadId: "child" }),
        makeThreadListEntry({ id: "other", title: "Unrelated" }),
      ];
      const listKey = threadListQueryKey({
        projectId: "project-1",
        archived: false,
      });
      const sidebarKey = sidebarNavigationQueryKey();
      queryClient.setQueryData(listKey, entries);
      queryClient.setQueryData(sidebarKey, makeSidebarNavigation(entries));
      let rollback;
      if (operation === "archive") {
        const transaction = await beginArchiveThreadAndChildrenTransaction({
          queryClient,
          threadId: "root",
        });
        rollback = () =>
          rollbackArchiveThreadsTransaction({ queryClient, transaction });
      } else {
        const transaction = await beginDeleteThreadTransaction({
          queryClient,
          threadId: "root",
        });
        rollback = () =>
          rollbackDeleteThreadTransaction({
            queryClient,
            transaction,
          });
      }
      const ids = () =>
        queryClient
          .getQueryData<SidebarBootstrapResponse>(sidebarKey)
          ?.projects[0]?.threads.map((thread) => thread.id);
      expect(ids()).toEqual(["other"]);
      expect(
        queryClient
          .getQueryData<typeof entries>(listKey)
          ?.map((thread) => thread.id),
      ).toEqual(["other"]);
      queryClient.setQueryData<typeof entries>(listKey, (list) =>
        list?.map((thread) => ({ ...thread, title: "Concurrent rename" })),
      );
      rollback();
      expect(ids()).toEqual(["root", "child", "grandchild", "other"]);
      expect(
        queryClient
          .getQueryData<typeof entries>(listKey)
          ?.find((thread) => thread.id === "other")?.title,
      ).toBe("Concurrent rename");
    },
  );

  it.each([
    {
      source: "sidebar",
      parentSection: "parent-section",
      sectionId: undefined,
    },
    { source: "detail", parentSection: "parent-section", sectionId: undefined },
    { source: "list", parentSection: "parent-section", sectionId: undefined },
    { source: "sidebar", parentSection: null, sectionId: undefined },
    {
      source: "sidebar",
      parentSection: "parent-section",
      sectionId: "destination",
    },
    { source: "sidebar", parentSection: "parent-section", sectionId: null },
    {
      source: "missing",
      parentSection: "parent-section",
      sectionId: undefined,
    },
  ])(
    "unparents without flashing the old section ($source, $parentSection, $sectionId)",
    async ({ source, parentSection, sectionId }) => {
      const { queryClient } = createQueryClientTestHarness();
      const child = makeThreadWithRuntime({
        parentThreadId: "parent",
        sectionId: "old-section",
      });
      const childEntry = makeThreadListEntry(child);
      const parent = makeThreadListEntry({
        id: "parent",
        sectionId: parentSection,
      });
      const listKey = threadListQueryKey({
        archived: false,
        projectId: "project-1",
      });
      queryClient.setQueryData(threadQueryKey(child.id), child);
      queryClient.setQueryData(
        listKey,
        source === "list" ? [childEntry, parent] : [childEntry],
      );
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarNavigation(
          source === "sidebar" ? [childEntry, parent] : [childEntry],
        ),
      );
      if (source === "detail") {
        queryClient.setQueryData(
          threadQueryKey(parent.id),
          makeThreadWithRuntime(parent),
        );
      }
      const transaction = await beginThreadMetadataTransaction({
        queryClient,
        threadId: child.id,
        parentThreadId: null,
        sectionId,
      });
      const expected =
        source === "missing"
          ? { parentThreadId: "parent", sectionId: "old-section" }
          : {
              parentThreadId: null,
              sectionId: sectionId === undefined ? parentSection : sectionId,
            };
      const cachedChild = () => [
        queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(child.id)),
        queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
        queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarNavigationQueryKey(),
        )?.projects[0]?.threads[0],
      ];
      for (const cached of cachedChild())
        expect(cached).toMatchObject(expected);
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: child.id,
        transaction,
      });
      for (const cached of cachedChild())
        expect(cached).toMatchObject({
          parentThreadId: "parent",
          sectionId: "old-section",
        });
    },
  );

  it("optimistically renames thread in thread, list, and sidebar caches", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const threadId = "thread-1";
    const thread = makeThreadWithRuntime({
      id: threadId,
      title: "Old title",
    });
    const listEntry = makeThreadListEntry({
      id: threadId,
      title: "Old title",
    });
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });

    queryClient.setQueryData(threadQueryKey(threadId), thread);
    queryClient.setQueryData(threadListKey, [listEntry]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([listEntry]),
    );

    const transaction = await beginThreadMetadataTransaction({
      queryClient,
      threadId,
      title: "New title",
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
        ?.title,
    ).toBe("New title");
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]?.title,
    ).toBe("New title");
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.title,
    ).toBe("New title");

    rollbackThreadListMutationTransaction({
      queryClient,
      threadId,
      transaction,
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
        ?.title,
    ).toBe("Old title");
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]?.title,
    ).toBe("Old title");
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.title,
    ).toBe("Old title");
  });

  it("optimistically marks read state in thread, list, and sidebar caches", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const threadId = "thread-1";
    const unreadThread = makeThreadWithRuntime({
      id: threadId,
      lastReadAt: 10,
      latestAttentionAt: 50,
    });
    const unreadListEntry = makeThreadListEntry({
      id: threadId,
      lastReadAt: 10,
      latestAttentionAt: 50,
    });
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });

    queryClient.setQueryData(threadQueryKey(threadId), unreadThread);
    queryClient.setQueryData(threadListKey, [unreadListEntry]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([unreadListEntry]),
    );

    const transaction = await beginThreadReadStateTransaction({
      lastReadAt: 20,
      queryClient,
      threadId,
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
        ?.lastReadAt,
    ).toBe(50);
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]
        ?.lastReadAt,
    ).toBe(50);
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.lastReadAt,
    ).toBe(50);

    rollbackThreadListMutationTransaction({
      queryClient,
      threadId,
      transaction,
    });

    expect(
      queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
        ?.lastReadAt,
    ).toBe(10);
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]
        ?.lastReadAt,
    ).toBe(10);
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.lastReadAt,
    ).toBe(10);
  });
});

it.each([null, 80, 100])(
  "rolls back only the pending read, preserving newer fields and sibling caches (%s)",
  async (lastReadAt) => {
    const { queryClient } = createQueryClientTestHarness();
    const threadId = "thread-1";
    const listKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const original = makeThreadListEntry({
      id: threadId,
      lastReadAt: 10,
      latestAttentionAt: 20,
    });
    queryClient.setQueryData(
      threadQueryKey(threadId),
      makeThreadWithRuntime(original),
    );
    queryClient.setQueryData(listKey, [original]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([original]),
    );
    const transaction = await beginThreadReadStateTransaction({
      queryClient,
      threadId,
      lastReadAt: 100,
    });
    const updated = makeThreadListEntry({
      ...original,
      lastReadAt,
      latestAttentionAt: 200,
      title: "New title",
    });
    const sibling = makeThreadListEntry({ id: "new-sibling", lastReadAt: 300 });
    queryClient.setQueryData(
      threadQueryKey(threadId),
      makeThreadWithRuntime(updated),
    );
    queryClient.setQueryData(listKey, [updated, sibling]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([updated, sibling]),
    );
    rollbackThreadReadStateTransaction({ queryClient, threadId, transaction });
    const expected = {
      lastReadAt: lastReadAt === 100 ? 10 : lastReadAt,
      latestAttentionAt: 200,
      title: "New title",
    };
    expect(queryClient.getQueryData(threadQueryKey(threadId))).toMatchObject(
      expected,
    );
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)).toEqual([
      expect.objectContaining(expected),
      sibling,
    ]);
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads,
    ).toEqual([expect.objectContaining(expected), sibling]);
  },
);

function seedConcurrentThreadCaches() {
  const { queryClient } = createQueryClientTestHarness();
  const listKey = threadListQueryKey({
    archived: false,
    projectId: "project-1",
  });
  const original = makeThreadListEntry({
    status: "idle",
    runtime: { displayStatus: "idle" },
    title: "Original",
    sectionId: "old",
    updatedAt: 10,
  });
  const seed = (thread: ThreadListEntry, siblings: ThreadListEntry[] = []) => {
    queryClient.setQueryData(
      threadQueryKey(thread.id),
      makeThreadWithRuntime(thread),
    );
    queryClient.setQueryData(listKey, [thread, ...siblings]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([thread, ...siblings]),
    );
  };
  const read = () => [
    queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(original.id)),
    queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[0],
    queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    )?.projects[0]?.threads[0],
  ];
  seed(original);
  return { queryClient, listKey, original, seed, read };
}

it.each(["rename", "pin", "reorder", "batch"])(
  "preserves concurrent state on a delayed %s response",
  (operation) => {
    const { queryClient, original, seed, read } = seedConcurrentThreadCaches();
    const current = makeThreadListEntry({
      ...original,
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 30,
      sectionId: "new",
      lastReadAt: 25,
    });
    seed(current);
    const response = makeThreadListEntry({
      ...original,
      title: "Renamed",
      pinnedAt: 20,
      pinSortKey: "a",
    });
    if (operation === "rename")
      applyThreadUpdateResult({
        queryClient,
        thread: response,
        request: { title: "Renamed" },
      });
    if (operation === "pin")
      applyThreadPinStateResult({
        queryClient,
        thread: response,
        pinSortKey: null,
      });
    if (operation === "reorder")
      applyPinnedThreadOrderResult({ queryClient, orderedRoots: [response] });
    if (operation === "batch")
      applyThreadMetadataBatchResult({
        queryClient,
        updates: [{ thread: response, request: { title: "Renamed" } }],
      });
    for (const thread of read()) {
      expect(thread).toMatchObject({
        status: "active",
        runtime: { displayStatus: "active" },
        updatedAt: 30,
        sectionId: "new",
        lastReadAt: 25,
      });
      expect(thread?.title).toBe(
        operation === "rename" || operation === "batch"
          ? "Renamed"
          : "Original",
      );
    }
    if (operation === "pin") expect(read()[0]?.pinnedAt).toBe(20);
    if (operation === "reorder")
      expect(read()[1]).toMatchObject({ pinnedAt: 20, pinSortKey: "a" });
  },
);

it.each(["single", "batch"])(
  "preserves concurrent state on a failed %s metadata operation",
  async (operation) => {
    const { queryClient, original, seed, read, listKey } =
      seedConcurrentThreadCaches();
    const transaction =
      operation === "single"
        ? await beginThreadMetadataTransaction({
            queryClient,
            threadId: original.id,
            title: "Pending",
            sectionId: "pending",
          })
        : await beginThreadMetadataBatchTransaction({
            queryClient,
            updates: [
              { threadId: original.id, title: "Pending", sectionId: "pending" },
            ],
          });
    const sibling = makeThreadListEntry({ id: "new-sibling" });
    seed(
      makeThreadListEntry({
        ...original,
        title: "Pending",
        sectionId: "later-edit",
        status: "active",
        runtime: { displayStatus: "active" },
        updatedAt: 30,
      }),
      [sibling],
    );
    transaction.releasePendingPatches();
    if ("previousThreads" in transaction)
      rollbackThreadMetadataBatchTransaction({ queryClient, transaction });
    else
      rollbackThreadListMutationTransaction({
        queryClient,
        threadId: original.id,
        transaction,
      });
    for (const thread of read())
      expect(thread).toMatchObject({
        title: "Original",
        sectionId: "later-edit",
        status: "active",
        runtime: { displayStatus: "active" },
        updatedAt: 30,
      });
    expect(queryClient.getQueryData<ThreadListEntry[]>(listKey)?.[1]).toEqual(
      sibling,
    );
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[1],
    ).toEqual(sibling);
  },
);

it("preserves concurrent state when an older status event reaches detail and sidebar", () => {
  const { queryClient, original, seed, read } = seedConcurrentThreadCaches();
  seed(
    makeThreadListEntry({
      ...original,
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 30,
    }),
  );
  const stale = {
    status: "idle" as const,
    runtime: { displayStatus: "idle" as const },
    latestAttentionAt: 20,
    activity: original.activity,
    updatedAt: 20,
  };
  updateCachedThreadStatusState(queryClient, original.id, stale);
  updateCachedThreadListStatusState(queryClient, original.id, stale);
  for (const thread of read())
    expect(thread).toMatchObject({
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 30,
    });
});
