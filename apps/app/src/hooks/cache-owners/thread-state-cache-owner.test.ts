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
  beginThreadReadStateTransaction,
  beginThreadMetadataTransaction,
  rollbackThreadListMutationTransaction,
  rollbackThreadReadStateTransaction,
} from "./thread-state-cache-owner";

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
      hostReconnectGraceExpiresAt: null,
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
