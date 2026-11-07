import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectBranchesResponse,
  SidebarBootstrapResponse,
  ThreadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  makeThreadResponse as makeThreadResponseFixture,
  makeThreadTimelineResponse as makeThreadTimelineResponseFixture,
} from "@/test/fixtures/thread-responses";
import { optimisticallyInsertThread } from "../cache-owners/query-cache";
import {
  sidebarNavigationQueryKey,
  threadListQueryKey,
  threadsQueryKey,
} from "./query-keys";
import {
  resolveProjectSourceBranchesPlaceholder,
  resolveThreadPlaceholder,
  resolveThreadTimelinePlaceholder,
} from "./query-placeholders";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { HttpError } from "@/lib/api";
import { BbHttpError } from "@/lib/sdk";
import { isTransientReadError, requireEnabledQueryArg } from "./query-helpers";

describe("requireEnabledQueryArg", () => {
  it("keeps a numeric zero rather than treating it as missing", () => {
    expect(
      requireEnabledQueryArg({
        value: 0,
        hookName: "useCount",
        argName: "count",
      }),
    ).toBe(0);
  });

  it.each([null, undefined, ""])("throws when the value is %p", (value) => {
    expect(() =>
      requireEnabledQueryArg({
        value,
        hookName: "useThread",
        argName: "thread id",
      }),
    ).toThrow("useThread: thread id is required when query is enabled");
  });
});

describe("isTransientReadError", () => {
  it("retries coded transport errors but never HTTP failures", () => {
    expect(
      isTransientReadError({ code: "transport_error", message: "Offline" }),
    ).toBe(true);
    expect(
      isTransientReadError({
        code: "handler_error",
        status: 500,
        message: "Failed to fetch",
      }),
    ).toBe(false);
  });
  it("matches browser transport failures but not HTTP responses", () => {
    expect(isTransientReadError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientReadError(new TypeError("Load failed"))).toBe(true);
    expect(isTransientReadError({ name: "AbortError" })).toBe(true);
    expect(
      isTransientReadError(
        new HttpError({ status: 404, message: "Not found" }),
      ),
    ).toBe(false);
    expect(
      isTransientReadError(
        new BbHttpError({
          status: 404,
          message: "Not found",
          body: { error: "Not found" },
          code: null,
        }),
      ),
    ).toBe(false);
    expect(isTransientReadError(new Error("Unexpected parse error"))).toBe(
      false,
    );
  });
});

function makeProjectBranchesResponse(): ProjectBranchesResponse {
  return {
    branches: ["main"],
    branchesTruncated: false,
    checkout: {
      kind: "branch",
      branchName: "main",
      headSha: "abc123",
    },
    defaultBranch: "main",
    defaultBranchRelation: "equal",
    defaultWorktreeBaseBranch: "origin/main",
    isWorktree: false,
    hasUncommittedChanges: false,
    operation: { kind: "none" },
    originDefaultBranch: "origin/main",
    remoteBranches: ["origin/main"],
    remoteBranchesTruncated: false,
    selectedBranch: null,
  };
}

function makeThreadResponse(
  thread: Partial<ThreadResponse> = {},
): ThreadResponse {
  return makeThreadResponseFixture({
    id: "thread-1",
    projectId: "project-1",
    createdAt: 1,
    status: "active",
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    environmentId: "env-1",
    runtime: {
      displayStatus: "waiting-for-host",
    },
    canSpawnChild: false,
    ...thread,
  });
}

function makeSidebarNavigation(): SidebarBootstrapResponse {
  return makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({
        id: "project-1",
        name: "Project",
        createdAt: 1,
        updatedAt: 1,
      }),
    ],
  });
}

function makeThreadTimelineResponse(
  rows: ThreadTimelineResponse["rows"],
): ThreadTimelineResponse {
  return makeThreadTimelineResponseFixture({
    rows,
    timelinePage: {
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      olderCursor: null,
      historySnapshot: "snapshot-1",
      olderRowsSourceSeqEnd: null,
    },
  });
}

describe("resolveThreadPlaceholder", () => {
  it("reuses previous thread data only for the same thread query", () => {
    const previousThread = makeThreadResponse({ id: "thread-1" });

    expect(
      resolveThreadPlaceholder(
        previousThread,
        ["thread", "thread-1"],
        "thread-1",
      ),
    ).toBe(previousThread);

    expect(
      resolveThreadPlaceholder(
        previousThread,
        ["thread", "thread-1"],
        "thread-2",
      ),
    ).toBeUndefined();
  });
});

describe("resolveThreadTimelinePlaceholder", () => {
  it("reuses previous timeline rows only while the thread matches", () => {
    const previousTimeline = makeThreadTimelineResponse([
      {
        id: "assistant-1",
        kind: "conversation",
        role: "assistant",
        threadId: "thread-1",
        turnId: "turn-1",
        text: "Done",
        sourceSeqStart: 1,
        sourceSeqEnd: 1,
        messageSeq: 1,
        startedAt: 1,
        createdAt: 1,
        attachments: null,
        turnRequest: null,
      },
    ]);

    expect(
      resolveThreadTimelinePlaceholder(
        previousTimeline,
        ["threadTimeline", "thread-1"],
        "thread-1",
      ),
    ).toBe(previousTimeline);

    expect(
      resolveThreadTimelinePlaceholder(
        previousTimeline,
        ["threadTimeline", "thread-1"],
        "thread-2",
      ),
    ).toBeUndefined();
  });
});

describe("resolveProjectSourceBranchesPlaceholder", () => {
  it("reuses previous branch data only when the project, host, and limit match", () => {
    const previousBranches = makeProjectBranchesResponse();

    expect(
      resolveProjectSourceBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "projectSourceBranches",
          "project-1",
          "host-1",
          "",
          50,
          "",
        ],
        projectId: "project-1",
        hostId: "host-1",
        limit: 50,
        selectedBranch: "",
      }),
    ).toBe(previousBranches);

    expect(
      resolveProjectSourceBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "projectSourceBranches",
          "project-1",
          "host-1",
          "",
          50,
          "origin/main",
        ],
        projectId: "project-1",
        hostId: "host-1",
        limit: 50,
        selectedBranch: "origin/main",
      }),
    ).toBe(previousBranches);

    expect(
      resolveProjectSourceBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "projectSourceBranches",
          "project-1",
          "host-2",
          "",
          50,
          "",
        ],
        projectId: "project-1",
        hostId: "host-1",
        limit: 50,
        selectedBranch: "",
      }),
    ).toBeUndefined();

    expect(
      resolveProjectSourceBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "projectSourceBranches",
          "project-1",
          "host-1",
          "",
          25,
          "",
        ],
        projectId: "project-1",
        hostId: "host-1",
        limit: 50,
        selectedBranch: "",
      }),
    ).toBeUndefined();

    expect(
      resolveProjectSourceBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "projectSourceBranches",
          "project-1",
          "host-1",
          "",
          50,
          "origin/main",
        ],
        projectId: "project-1",
        hostId: "host-1",
        limit: 50,
        selectedBranch: "upstream/main",
      }),
    ).toBeUndefined();
  });
});

describe("optimisticallyInsertThread", () => {
  it("does not treat the prefix-only threads key as an active thread list", () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(threadsQueryKey(), []);

    optimisticallyInsertThread(queryClient, makeThreadResponse());

    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadsQueryKey()),
    ).toEqual([]);
  });

  it("places a new thread on its selected machine in the first cached sidebar row", () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation(),
    );

    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse(),
      "host-selected",
    );

    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.environmentHostId,
    ).toBe("host-selected");
  });

  it("projects queued work into the thread list and sidebar immediately", () => {
    const { queryClient } = createQueryClientTestHarness();
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData(threadListKey, []);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation(),
    );

    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse({ queuedMessageCount: 1 }),
    );

    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0]
        ?.queuedWork,
    ).toBe("waiting");
    expect(
      queryClient.getQueryData<SidebarBootstrapResponse>(
        sidebarNavigationQueryKey(),
      )?.projects[0]?.threads[0]?.queuedWork,
    ).toBe("waiting");
  });

  it("adds queued work without replacing newer realtime row state", () => {
    const { queryClient } = createQueryClientTestHarness();
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData(threadListKey, []);
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarNavigation(),
    );
    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse({
        runtime: {
          displayStatus: "active",
        },
      }),
    );

    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse({ queuedMessageCount: 1 }),
    );

    const listThread =
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey)?.[0];
    const sidebarThread = queryClient.getQueryData<SidebarBootstrapResponse>(
      sidebarNavigationQueryKey(),
    )?.projects[0]?.threads[0];
    expect(listThread?.runtime.displayStatus).toBe("active");
    expect(listThread?.queuedWork).toBe("waiting");
    expect(sidebarThread?.runtime.displayStatus).toBe("active");
    expect(sidebarThread?.queuedWork).toBe("waiting");
  });

  it("respects the originKind filter when inserting source-derived threads", () => {
    const { queryClient } = createQueryClientTestHarness();
    const forkListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
      sourceThreadId: "source-1",
      originKind: "fork",
    });
    queryClient.setQueryData(forkListKey, []);

    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse({
        id: "side-chat-1",
        sourceThreadId: "source-1",
        originKind: "fork",
        visibility: "hidden",
      }),
    );
    expect(queryClient.getQueryData<ThreadListEntry[]>(forkListKey)).toEqual(
      [],
    );

    optimisticallyInsertThread(
      queryClient,
      makeThreadResponse({
        id: "fork-1",
        sourceThreadId: "source-1",
        originKind: "fork",
      }),
    );
    expect(
      queryClient
        .getQueryData<ThreadListEntry[]>(forkListKey)
        ?.map((entry) => entry.id),
    ).toEqual(["fork-1"]);
  });
});
