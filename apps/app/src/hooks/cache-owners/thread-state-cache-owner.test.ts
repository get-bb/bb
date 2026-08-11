import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import {
  beginThreadReadStateTransaction,
  beginThreadProjectTransaction,
  beginThreadTitleTransaction,
  rollbackThreadListMutationTransaction,
} from "./thread-state-cache-owner";

function makeThreadWithRuntime(
  thread: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    id: "thread-1",
    projectId: "project-1",
    environmentId: "env-1",
    providerId: "codex",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "active",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 50,
    createdAt: 1,
    updatedAt: 1,
    runtime: {
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    },
    ...thread,
  };
}

function makeThreadListEntry(
  thread: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    ...makeThreadWithRuntime(thread),
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: "host-1",
    environmentName: "Environment",
    environmentBranchName: "main",
    environmentWorkspaceDisplayKind: "managed-worktree",
    ...thread,
  };
}

function makeSidebarNavigation(
  threads: ThreadListEntry[],
): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [
      {
        id: "project-1",
        kind: "standard",
        name: "Project",
        gitRemoteUrl: null,
        createdAt: 1,
        updatedAt: 1,
        sources: [],
        threads,
        defaultExecutionOptions: null,
      },
    ],
    personalProject: {
      id: "proj_personal",
      kind: "personal",
      name: "Personal",
      gitRemoteUrl: null,
      createdAt: 1,
      updatedAt: 1,
      sources: [],
      threads: [],
      defaultExecutionOptions: null,
    },
  };
}

describe("thread state cache owner", () => {
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

    const transaction = await beginThreadTitleTransaction({
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

  it("moves a cached thread subtree optimistically and rolls it back together", async () => {
    const { queryClient } = createQueryClientTestHarness();
    const rootId = "thread-root";
    const childId = "thread-child";
    const root = makeThreadWithRuntime({
      id: rootId,
      projectId: "project-1",
    });
    const child = makeThreadWithRuntime({
      id: childId,
      parentThreadId: rootId,
      projectId: "project-1",
    });
    const rootEntry = makeThreadListEntry({
      id: rootId,
      projectId: "project-1",
    });
    const childEntry = makeThreadListEntry({
      id: childId,
      parentThreadId: rootId,
      projectId: "project-1",
    });
    const sourceListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    const targetListKey = threadListQueryKey({
      archived: false,
      projectId: "project-2",
    });
    const navigation = makeSidebarNavigation([rootEntry, childEntry]);
    navigation.projects.push({
      ...navigation.projects[0]!,
      id: "project-2",
      name: "Target",
      threads: [],
    });

    queryClient.setQueryData(threadQueryKey(rootId), root);
    queryClient.setQueryData(threadQueryKey(childId), child);
    queryClient.setQueryData(sourceListKey, [rootEntry, childEntry]);
    queryClient.setQueryData(targetListKey, []);
    queryClient.setQueryData(sidebarNavigationQueryKey(), navigation);

    const transaction = await beginThreadProjectTransaction({
      projectId: "project-2",
      queryClient,
      threadId: rootId,
    });

    expect(queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(rootId)))
      .toMatchObject({ projectId: "project-2" });
    expect(queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(childId)))
      .toMatchObject({ projectId: "project-2" });
    expect(queryClient.getQueryData<ThreadListEntry[]>(sourceListKey)).toEqual(
      [],
    );
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(targetListKey),
    ).toMatchObject([{ id: rootId }, { id: childId }]);
    const movedNavigation = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    );
    expect(movedNavigation?.projects[0]?.threads).toEqual([]);
    expect(movedNavigation?.projects[1]?.threads.map(({ id }) => id)).toEqual([
      rootId,
      childId,
    ]);

    rollbackThreadListMutationTransaction({
      queryClient,
      threadId: rootId,
      transaction,
    });

    expect(queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(rootId)))
      .toMatchObject({ projectId: "project-1" });
    expect(queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(childId)))
      .toMatchObject({ projectId: "project-1" });
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(sourceListKey),
    ).toMatchObject([{ id: rootId }, { id: childId }]);
    expect(queryClient.getQueryData<ThreadListEntry[]>(targetListKey)).toEqual(
      [],
    );
  });
});
