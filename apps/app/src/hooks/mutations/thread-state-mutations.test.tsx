// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import type {
  SidebarBootstrapResponse,
  ThreadResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import { useUpdateThread } from "./thread-state-mutations";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    updateThread: vi.fn(),
  };
});

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
    status: "active",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
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

function makeThreadResponse(
  thread: Partial<ThreadResponse> = {},
): ThreadResponse {
  return {
    ...makeThreadWithRuntime(thread),
    canSpawnChild: true,
    ...thread,
  };
}

function makeThreadListEntry(
  thread: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    ...makeThreadWithRuntime(thread),
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
    projects: [
      {
        id: "project-1",
        kind: "standard",
        name: "Project",
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
      createdAt: 1,
      updatedAt: 1,
      sources: [],
      threads: [],
      defaultExecutionOptions: null,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("thread state mutations", () => {
  it("optimistically renames a thread while the update request is pending", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
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
    let resolveUpdate: (thread: ThreadResponse) => void = () => {};

    queryClient.setQueryData(threadQueryKey(threadId), thread);
    queryClient.setQueryData(threadListKey, [listEntry]);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation([listEntry]),
    );
    vi.mocked(api.updateThread).mockImplementation(
      () =>
        new Promise<ThreadResponse>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const { result } = renderHook(() => useUpdateThread(), { wrapper });

    act(() => {
      result.current.mutate({ id: threadId, title: "New title" });
    });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<ThreadWithRuntime>(threadQueryKey(threadId))
          ?.title,
      ).toBe("New title");
    });
    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]?.title,
    ).toBe("New title");
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.title,
    ).toBe("New title");
    expect(api.updateThread).toHaveBeenCalledWith(threadId, {
      title: "New title",
    });

    act(() => {
      resolveUpdate(
        makeThreadResponse({
          id: threadId,
          title: "New title",
          updatedAt: 2,
        }),
      );
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });
});
