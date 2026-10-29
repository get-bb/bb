import { describe, expect, it } from "vitest";
import { experimental_PluginRpcCallError } from "@get-bb/plugin-sdk";
import {
  makeWorkspaceMergeBase,
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
  type WorkspaceStatusFixture,
} from "./workspace-status-fixtures";
import {
  getGitStatusDisplay,
  gitStatusErrorMessage,
} from "./git-status-display";

interface MakeStatusOptions {
  aheadCount?: number;
  behindCount?: number;
  changedFiles?: number;
  deletions?: number;
  insertions?: number;
  state: WorkspaceStatusFixture["workingTree"]["state"];
}

function makeStatus(options: MakeStatusOptions): WorkspaceStatusFixture {
  const aheadCount = options.aheadCount ?? 0;
  const behindCount = options.behindCount ?? 0;
  const hasUncommittedChanges =
    options.state === "untracked" ||
    options.state === "dirty_uncommitted" ||
    options.state === "dirty_and_committed_unmerged";
  const fileCount = options.changedFiles ?? 0;
  const files = Array.from({ length: fileCount }, (_, index) => ({
    path: `file-${index}.ts`,
    status: "M" as const,
    insertions: null,
    deletions: null,
  }));
  return makeWorkspaceStatus({
    workingTree: makeWorkspaceWorkingTree({
      hasUncommittedChanges,
      state: options.state,
      insertions: options.insertions ?? 0,
      deletions: options.deletions ?? 0,
      files,
    }),
    mergeBase: makeWorkspaceMergeBase({
      baseRef: "origin/main",
      aheadCount,
      behindCount,
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: aheadCount > 0,
    }),
  });
}

describe("workspace-status", () => {
  it("qualifies counts when squash detection could not finish", () => {
    const status = makeStatus({
      state: "committed_unmerged",
      aheadCount: 2,
      behindCount: 3,
    });
    if (!status.mergeBase) throw new Error("Missing comparison fixture");
    status.mergeBase.squashMergeCheckComplete = false;
    expect(getGitStatusDisplay(status, { showBranchComparison: true })).toEqual(
      {
        label: "Diverged",
        summary: "2 ahead, 3 behind relative to main",
        warning:
          "Squash-merge check incomplete; counts may include already-merged commits.",
      },
    );
  });

  it("reports untracked workspaces without echoing working-tree file counts", () => {
    expect(
      getGitStatusDisplay(makeStatus({ changedFiles: 1, state: "untracked" })),
    ).toMatchObject({
      label: "Untracked",
      summary: "",
    });
  });

  it("includes branch comparison in untracked status summaries", () => {
    expect(
      getGitStatusDisplay(
        makeStatus({
          behindCount: 2,
          changedFiles: 1,
          state: "untracked",
        }),
        {
          mergeBaseBranch: "main",
          showBranchComparison: true,
        },
      ),
    ).toMatchObject({
      label: "Untracked",
      summary: "2 behind main",
    });
  });

  it("reports diverged branches as an explicit git status display", () => {
    expect(
      getGitStatusDisplay(
        makeStatus({
          aheadCount: 2,
          behindCount: 1,
          state: "committed_unmerged",
        }),
        {
          mergeBaseBranch: "main",
          showBranchComparison: true,
        },
      ),
    ).toMatchObject({
      label: "Diverged",
      summary: "2 ahead, 1 behind relative to main",
    });
  });

  it("reports dirty work without echoing the working-tree diff stats", () => {
    expect(
      getGitStatusDisplay(
        makeStatus({
          changedFiles: 3,
          deletions: 2,
          insertions: 8,
          state: "dirty_uncommitted",
        }),
      ),
    ).toMatchObject({
      label: "Dirty",
      summary: "",
    });
  });

  it("reports dirty committed work with only the branch comparison summary", () => {
    expect(
      getGitStatusDisplay(
        makeStatus({
          aheadCount: 2,
          changedFiles: 3,
          deletions: 2,
          insertions: 8,
          state: "dirty_and_committed_unmerged",
        }),
        {
          mergeBaseBranch: "main",
          showBranchComparison: true,
        },
      ),
    ).toMatchObject({
      label: "Dirty",
      summary: "2 ahead of main",
    });
  });

  it("reports unavailable workspace status explicitly", () => {
    expect(getGitStatusDisplay(undefined)).toMatchObject({
      label: "Unknown",
      summary: "Workspace status unavailable.",
    });
  });

  it("reports typed unavailable workspace failures explicitly", () => {
    expect(
      getGitStatusDisplay(undefined, {
        workspaceUnavailable: {
          code: "workspace_type_mismatch",
          message:
            "Loaded environment env_1 is bound to /tmp/old, not /tmp/current",
        },
      }),
    ).toMatchObject({
      label: "Unknown",
      summary:
        "Loaded environment env_1 is bound to /tmp/old, not /tmp/current",
    });
  });

  it("shows the read error when no status has loaded", () => {
    expect(
      getGitStatusDisplay(undefined, { errorMessage: "Host is offline" }),
    ).toMatchObject({ label: "Unknown", summary: "Host is offline" });
  });

  it("reports a deleted workspace before the read error", () => {
    expect(
      getGitStatusDisplay(undefined, {
        errorMessage: "Environment unavailable",
        workspaceDeleted: true,
      }),
    ).toMatchObject({ label: "Unknown", summary: "Workspace not found." });
  });
});

describe("gitStatusErrorMessage", () => {
  it("shows the Git plugin's refusal message", () => {
    expect(
      gitStatusErrorMessage(
        new experimental_PluginRpcCallError({
          code: "conflict",
          message: "Workspace is still starting.",
        }),
      ),
    ).toBe("Workspace is still starting.");
  });

  it("hides transport and handler failures behind a generic message", () => {
    expect(
      gitStatusErrorMessage(
        new experimental_PluginRpcCallError({
          code: "transport_error",
          message: "bb connect hit a temporary problem",
        }),
      ),
    ).toBe("Workspace status unavailable.");
    expect(gitStatusErrorMessage(new Error("boom"))).toBe(
      "Workspace status unavailable.",
    );
    expect(gitStatusErrorMessage(null)).toBeNull();
  });
});
