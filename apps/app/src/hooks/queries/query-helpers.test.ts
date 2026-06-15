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
  EnvironmentDiffResponse,
  EnvironmentStatusResponse,
  ProjectBranchesResponse,
} from "@bb/server-contract";
import {
  getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys,
  getEnvironmentWorkspaceStateInvalidationQueryKeys,
  optimisticallyInsertThread,
} from "../cache-owners/query-cache";
import {
  environmentGitDiffQueryKey,
  environmentWorkStatusQueryKey,
  threadListQueryKey,
  threadsQueryKey,
} from "./query-keys";
import {
  resolveEnvironmentGitDiffPlaceholder,
  resolveEnvironmentMergeBaseBranchesPlaceholder,
  resolveEnvironmentWorkStatusPlaceholder,
  resolveProjectSourceBranchesPlaceholder,
  resolveThreadPlaceholder,
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
      branch: { currentBranch: "feature", defaultBranch: "main" },
      mergeBase: makeWorkspaceMergeBase({ baseRef: "origin/main" }),
    }),
  };
}

function makeGitDiffResponse(): EnvironmentDiffResponse {
  return {
    outcome: "available",
    diff: {
      diff: "diff --git a/file b/file",
      truncated: false,
      shortstat: " 1 file changed, 1 insertion(+)\n",
      files: "M\tfile\n",
      mergeBaseRef: null,
    },
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
    hasUncommittedChanges: false,
    operation: { kind: "none" },
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
    automationId: null,
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
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    runtime: {
      displayStatus: "waiting-for-host",
      hostReconnectGraceExpiresAt: null,
    },
    ...thread,
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
    const previousThread = makeThreadWithRuntime({ id: "thread-1" });

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

describe("resolveEnvironmentGitDiffPlaceholder", () => {
  it("reuses previous git diff data only for the same environment", () => {
    const previousGitDiff = makeGitDiffResponse();

    expect(
      resolveEnvironmentGitDiffPlaceholder(
        previousGitDiff,
        ["environmentGitDiff", "env-1", "all", "main"],
        "env-1",
      ),
    ).toBe(previousGitDiff);

    expect(
      resolveEnvironmentGitDiffPlaceholder(
        previousGitDiff,
        ["environmentGitDiff", "env-1", "all", "main"],
        "env-2",
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
  it("targets workspace-derived status and diff queries", () => {
    expect(
      getEnvironmentWorkspaceStateInvalidationQueryKeys({
        environmentId: "env-1",
      }),
    ).toEqual([
      ["environmentWorkStatus", "env-1"],
      ["environmentGitDiff", "env-1"],
      ["environmentFilePreview", "env-1"],
    ]);
  });
});

describe("getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys", () => {
  it("targets only merge-base-dependent work status and branch-based diff queries", () => {
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
      environmentGitDiffQueryKey("env-1", "commit", "abc123"),
      makeGitDiffResponse(),
    );
    queryClient.setQueryData(
      environmentGitDiffQueryKey("env-1", "all", "main"),
      makeGitDiffResponse(),
    );
    queryClient.setQueryData(
      environmentGitDiffQueryKey("env-2", "all", "main"),
      makeGitDiffResponse(),
    );

    const queryKeys =
      getCachedEnvironmentRefWorkspaceStateInvalidationQueryKeys(queryClient, {
        environmentId: "env-1",
      });

    expect(queryKeys).toHaveLength(2);
    expect(queryKeys).toContainEqual(
      environmentWorkStatusQueryKey("env-1", "main"),
    );
    expect(queryKeys).toContainEqual(
      environmentGitDiffQueryKey("env-1", "all", "main"),
    );
    expect(queryKeys).not.toContainEqual(
      environmentWorkStatusQueryKey("env-1", null),
    );
    expect(queryKeys).not.toContainEqual(
      environmentGitDiffQueryKey("env-1", "commit", "abc123"),
    );
    expect(queryKeys).not.toContainEqual(
      environmentGitDiffQueryKey("env-2", "all", "main"),
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
});
