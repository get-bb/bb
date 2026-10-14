import { MutationObserver } from "@tanstack/react-query";
import type { ThreadListEntry, ThreadWithRuntime } from "@bb/domain";
import { makeThreadWithRuntime as makeThreadWithRuntimeFixture } from "@bb/test-helpers/domain-fixtures";
import type {
  SidebarBootstrapResponse,
  ThreadResponse,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import { createDeferredPromise } from "@bb/test-helpers";
import { makeThreadListEntry as makeThreadListEntryFixture } from "@bb/test-helpers/domain-fixtures";
import { makeThreadResponse as makeThreadResponseFixture } from "@/test/fixtures/thread-responses";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadQueryKey,
} from "../queries/query-keys";
import { updateThreadMutationOptions } from "./thread-state-mutations";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { unpin: vi.fn(), update: vi.fn() } },
}));

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

function makeThreadResponse(
  thread: Partial<ThreadResponse> = {},
): ThreadResponse {
  return makeThreadResponseFixture({
    ...makeThreadWithRuntime(thread),
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("thread state mutations", () => {
  it.each([
    ["title", "Old title", "New title"],
    ["sectionId", "sec_work", "sec_personal"],
  ] as const)(
    "optimistically updates a thread's %s while the update request is pending",
    async (field, before, after) => {
      const queryClient = createAppQueryClient({
        defaultOptions: {
          mutations: { retry: false },
          queries: { gcTime: Infinity, retry: false },
        },
        showMutationErrorToasts: false,
      });
      const threadId = "thread-1";
      const thread = makeThreadWithRuntime({ id: threadId, [field]: before });
      const listEntry = makeThreadListEntry({ id: threadId, [field]: before });
      const threadListKey = threadListQueryKey({
        archived: false,
        projectId: "project-1",
      });
      const update = createDeferredPromise<ThreadResponse>();

      queryClient.setQueryData(threadQueryKey(threadId), thread);
      queryClient.setQueryData(threadListKey, [listEntry]);
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        makeSidebarNavigation([listEntry]),
      );
      vi.mocked(sdk.threads.update).mockReturnValue(update.promise);
      const mutation = new MutationObserver(
        queryClient,
        updateThreadMutationOptions(queryClient),
      );

      const updating = mutation.mutate({ id: threadId, [field]: after });

      await vi.waitFor(() => {
        expect(
          queryClient.getQueryData<ThreadWithRuntime>(
            threadQueryKey(threadId),
          )?.[field],
        ).toBe(after);
      });
      expect(
        queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]?.[
          field
        ],
      ).toBe(after);
      expect(
        queryClient.getQueryData<SidebarBootstrapResponse>(
          sidebarNavigationQueryKey(),
        )?.projects[0]?.threads[0]?.[field],
      ).toBe(after);
      expect(sdk.threads.update).toHaveBeenCalledWith({
        threadId,
        [field]: after,
      });

      update.resolve(
        makeThreadResponse({ id: threadId, [field]: after, updatedAt: 2 }),
      );
      await updating;
      expect(mutation.getCurrentResult().isSuccess).toBe(true);
    },
  );
});
