import { describe, expect, it } from "vitest";
import type {
  ThreadListEntry,
  ThreadWithRuntime,
  WorkspaceStatus,
} from "@bb/domain";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import type {
  EnvironmentDiffBranchesResponse,
  EnvironmentStatusResponse,
  ProjectBranchesResponse,
  ThreadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import {
  getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
  optimisticallyInsertThread,
} from "../cache-owners/query-cache";
import {
  environmentDiffFilesQueryKeyPrefix,
  environmentDiffPatchQueryKeyPrefix,
  environmentWorkStatusQueryKey,
  threadListQueryKey,
  threadsQueryKey,
} from "./query-keys";
import {
  resolveEnvironmentMergeBaseBranchesPlaceholder,
  resolveEnvironmentWorkStatusPlaceholder,
  resolveProjectSourceBranchesPlaceholder,
  resolveThreadPlaceholder,
  resolveThreadTimelinePlaceholder,
} from "./query-placeholders";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { requireEnabledQueryArg } from "./query-helpers";

describe("requireEnabledQueryArg", () => {
  it("returns the value when present", () => {
    expect(
      requireEnabledQueryArg({
        value: "thr_1",
        hookName: "useThread",
        argName: "thread id",
      }),
    ).toBe("thr_1");
  });

  it("keeps a numeric zero rather than treating it as missing", () => {
    expect(
      requireEnabledQueryArg({
        value: 0,
        hookName: "useLocalProviderCliStatus",
        argName: "daemonPort",
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

function makeStatusResponse(
  state: WorkspaceStatus["workingTree"]["state"],
): EnvironmentStatusResponse {
  return {
    outcome: "available",
    workspace: makeWorkspaceStatus({
      workingTree: makeWorkspaceWorkingTree({ state }),
      checkout: { kind: "branch", branchName: "feature", headSha: null },
      branch: { currentBranch: "feature", defaultBranch: "main" },
      mergeBase: makeWorkspaceMergeBase({ baseRef: "origin/main" }),
    }),
  };
}

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
    hasUncommittedChanges: false,
    operation: { kind: "none" },
    originDefaultBranch: "origin/main",
    remoteBranches: ["origin/main"],
    remoteBranchesTruncated: false,
    selectedBranch: null,
  };
}

function makeEnvironmentDiffBranchesResponse(): EnvironmentDiffBranchesResponse {
  return {
    branches: ["main"],
    branchesTruncated: false,
    remoteBranches: ["origin/main"],
    remoteBranchesTruncated: false,
    selectedBranch: null,
  };
}

function makeThreadWithRuntime(
  thread: Partial<ThreadWithRuntime> = {},
): ThreadWithRuntime {
  return {
    id: "thread-1",
    projectId: "project-1",
    providerId: "codex",
    createdAt: 1,
    status: "active",
    updatedAt: 1,
    lastReadAt: null,
    latestAttentionAt: 1,
    environmentId: "env-1",
    title: null,
    titleFallback: null,
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    runtime: {
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    },
    ...thread,
  };
}

function makeThreadTimelineResponse(
  rows: ThreadTimelineResponse["rows"],
): ThreadTimelineResponse {
  return {
    activeThinking: null,
    activeWorkflow: null,
    pendingTodos: null,
    goal: null,
    maxSeq: 0,
    rows,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

describe("resolveEnvironmentWorkStatusPlaceholder", () => {
  it("reuses previous work status only for the same thread query", () => {
    const previousStatus = makeStatusResponse("clean");
    const previousNotApplicableStatus: EnvironmentStatusResponse = {
      outcome: "not_applicable",
      reason: "non_git_environment",
      message: "Workspace status is not available for non-git environments",
    };

    expect(
      resolveEnvironmentWorkStatusPlaceholder(
        previousStatus,
        ["environmentWorkStatus", "thread-1", null],
        "thread-1",
      ),
    ).toBe(previousStatus);

    expect(
      resolveEnvironmentWorkStatusPlaceholder(
        previousStatus,
        ["environmentWorkStatus", "thread-1", null],
        "thread-2",
      ),
    ).toBeUndefined();

    expect(
      resolveEnvironmentWorkStatusPlaceholder(
        previousNotApplicableStatus,
        ["environmentWorkStatus", "thread-1", null],
        "thread-1",
      ),
    ).toBe(previousNotApplicableStatus);

    expect(
      resolveEnvironmentWorkStatusPlaceholder(
        previousNotApplicableStatus,
        ["environmentWorkStatus", "thread-1", null],
        "thread-2",
      ),
    ).toBeUndefined();
  });
});

describe("resolveThreadPlaceholder", () => {
  it("reuses previous thread data only for the same thread query", () => {
    const previousThread: ThreadResponse = {
      ...makeThreadWithRuntime({ id: "thread-1" }),
      canSpawnChild: false,
    };

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

describe("resolveEnvironmentMergeBaseBranchesPlaceholder", () => {
  it("reuses previous branch data only when the environment, limit, and selected branch match", () => {
    const previousBranches = makeEnvironmentDiffBranchesResponse();

    expect(
      resolveEnvironmentMergeBaseBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "environmentMergeBaseBranches",
          "env-1",
          "",
          50,
          "origin/main",
        ],
        environmentId: "env-1",
        limit: 50,
        selectedBranch: "origin/main",
      }),
    ).toBe(previousBranches);

    expect(
      resolveEnvironmentMergeBaseBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "environmentMergeBaseBranches",
          "env-1",
          "",
          50,
          "origin/main",
        ],
        environmentId: "env-2",
        limit: 50,
        selectedBranch: "origin/main",
      }),
    ).toBeUndefined();

    expect(
      resolveEnvironmentMergeBaseBranchesPlaceholder({
        previousData: previousBranches,
        previousQueryKey: [
          "environmentMergeBaseBranches",
          "env-1",
          "",
          50,
          "origin/main",
        ],
        environmentId: "env-1",
        limit: 50,
        selectedBranch: "main",
      }),
    ).toBeUndefined();
  });
});

describe("getEnvironmentWorkspaceStateInvalidationQueryKeys", () => {
  it("targets workspace-derived status and the observer-backed diff TOC, but never the observer-less patch cache", () => {
    const queryKeys = getEnvironmentWorkspaceStateInvalidationQueryKeys({
      environmentId: "env-1",
    });

    expect(queryKeys).toEqual([
      ["environmentWorkStatus", "env-1"],
      ["environmentPullRequest", "env-1"],
      ["environmentDiffFiles", "env-1"],
      ["environmentFilePreview", "env-1"],
    ]);
    // The patch cache is observer-less; invalidation is a no-op for it, so it
    // must be evicted (removeEnvironmentDiffPatchQueries) rather than appearing
    // in any invalidate-key list.
    expect(queryKeys).not.toContainEqual(
      environmentDiffPatchQueryKeyPrefix("env-1"),
    );
  });
});

describe("getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys", () => {
  it("targets only merge-base-dependent work status and the diff TOC/patch caches", () => {
    const { queryClient } = createQueryClientTestHarness();

    queryClient.setQueryData(
      environmentWorkStatusQueryKey("env-1", null),
      null,
    );
    queryClient.setQueryData(
      environmentWorkStatusQueryKey("env-1", "main"),
      null,
    );
    queryClient.setQueryData(
      environmentWorkStatusQueryKey("env-2", "main"),
      null,
    );

    const queryKeys =
      getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys(queryClient, {
        environmentId: "env-1",
      });

    // Only the merge-base-scoped work status for env-1, plus the observer-backed
    // diff TOC cache (invalidated by prefix — a moved merge base affects every
    // ref-derived diff target). The observer-less patch cache is absent: it is
    // evicted separately via removeEnvironmentDiffPatchQueries.
    expect(queryKeys).toHaveLength(2);
    expect(queryKeys).toContainEqual(
      environmentWorkStatusQueryKey("env-1", "main"),
    );
    expect(queryKeys).toContainEqual(
      environmentDiffFilesQueryKeyPrefix("env-1"),
    );
    expect(queryKeys).not.toContainEqual(
      environmentDiffPatchQueryKeyPrefix("env-1"),
    );
    expect(queryKeys).not.toContainEqual(
      environmentWorkStatusQueryKey("env-1", null),
    );
    expect(queryKeys).not.toContainEqual(
      environmentWorkStatusQueryKey("env-2", "main"),
    );
  });
});

describe("optimisticallyInsertThread", () => {
  it("does not treat the prefix-only threads key as an active thread list", () => {
    const { queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(threadsQueryKey(), []);

    optimisticallyInsertThread(queryClient, makeThreadWithRuntime());

    expect(
      queryClient.getQueryData<ThreadListEntry[]>(threadsQueryKey()),
    ).toEqual([]);
  });

  it("preserves the server-provided runtime state", () => {
    const { queryClient } = createQueryClientTestHarness();
    const threadListKey = threadListQueryKey({
      archived: false,
      projectId: "project-1",
    });
    queryClient.setQueryData(threadListKey, []);

    optimisticallyInsertThread(queryClient, makeThreadWithRuntime());

    const [thread] =
      queryClient.getQueryData<ThreadListEntry[]>(threadListKey) ?? [];
    expect(thread?.runtime).toEqual({
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    });
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

    // A side chat of the same parent must not contaminate the parent's
    // fork-filtered list.
    optimisticallyInsertThread(
      queryClient,
      makeThreadWithRuntime({
        id: "side-chat-1",
        sourceThreadId: "source-1",
        originKind: "side-chat",
      }),
    );
    expect(queryClient.getQueryData<ThreadListEntry[]>(forkListKey)).toEqual(
      [],
    );

    // A fork of the same parent does belong in the fork list.
    optimisticallyInsertThread(
      queryClient,
      makeThreadWithRuntime({
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
