// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { InfiniteData } from "@tanstack/react-query";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { archivedThreadsListQueryKey } from "../queries/query-keys";
import { useDeleteThreadFolder } from "./thread-folder-mutations";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    deleteThreadFolder: vi.fn(),
  };
});

function makeThreadListEntry(
  thread: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thread-1",
    projectId: "project-1",
    environmentId: "env-1",
    providerId: "codex",
    title: null,
    titleFallback: null,
    folderId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    childOrigin: null,
    archivedAt: 1,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    activity: { activeWorkflowCount: 0 },
    hasPendingInteraction: false,
    environmentBranchName: "main",
    environmentHostId: "host-1",
    environmentName: "Environment",
    environmentWorkspaceDisplayKind: "managed-worktree",
    ...thread,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("thread folder mutations", () => {
  it("clears the deleted folder archived list cache", async () => {
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const archivedKey = archivedThreadsListQueryKey({ folderId: "fld_work" });
    const archivedData: InfiniteData<ThreadListEntry[]> = {
      pageParams: [0],
      pages: [
        [
          makeThreadListEntry({
            folderId: "fld_work",
            id: "archived-thread",
          }),
        ],
      ],
    };
    queryClient.setQueryData(archivedKey, archivedData);
    vi.mocked(api.deleteThreadFolder).mockResolvedValue({
      id: "fld_work",
      name: "Work",
      updatedThreadCount: 1,
    });

    const { result } = renderHook(() => useDeleteThreadFolder(), { wrapper });

    act(() => {
      result.current.mutate({ id: "fld_work" });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(queryClient.getQueryData(archivedKey)).toBeUndefined();
  });
});
