import type { WorkspaceStatus } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  buildThreadHeaderGitActions,
  describeEnvironmentActionFailure,
  describeEnvironmentActionSuccess,
} from "./environment-action-model";

function status(overrides: {
  hasUncommittedChanges?: boolean;
  hasCommittedUnmergedChanges?: boolean;
}): WorkspaceStatus {
  return {
    workingTree: {
      state: overrides.hasUncommittedChanges ? "dirty_uncommitted" : "clean",
      hasUncommittedChanges: overrides.hasUncommittedChanges ?? false,
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    },
    checkout: { kind: "branch", branchName: "feature", headSha: null },
    branch: { currentBranch: "feature", defaultBranch: "main" },
    mergeBase: {
      mergeBaseBranch: "main",
      baseRef: null,
      aheadCount: overrides.hasCommittedUnmergedChanges ? 1 : 0,
      behindCount: 0,
      hasCommittedUnmergedChanges:
        overrides.hasCommittedUnmergedChanges ?? false,
      commits: [],
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    },
  };
}

const liveThread = { archivedAt: null };

describe("buildThreadHeaderGitActions", () => {
  it("offers Commit on a dirty tree and Squash merge only on managed environments", () => {
    const dirty = status({ hasUncommittedChanges: true });
    expect(
      buildThreadHeaderGitActions({
        thread: liveThread,
        environment: { managed: false },
        workspaceStatus: dirty,
      }),
    ).toEqual([{ target: { kind: "commit" }, label: "Commit" }]);
    expect(
      buildThreadHeaderGitActions({
        thread: liveThread,
        environment: { managed: true },
        workspaceStatus: dirty,
      }),
    ).toEqual([
      { target: { kind: "commit" }, label: "Commit" },
      { target: { kind: "commit_and_squash_merge" }, label: "Squash merge" },
    ]);
  });

  it("offers a plain Squash merge when only commits are unmerged, nothing when clean or archived", () => {
    expect(
      buildThreadHeaderGitActions({
        thread: liveThread,
        environment: { managed: true },
        workspaceStatus: status({ hasCommittedUnmergedChanges: true }),
      }),
    ).toEqual([{ target: { kind: "squash_merge" }, label: "Squash merge" }]);
    expect(
      buildThreadHeaderGitActions({
        thread: liveThread,
        environment: { managed: true },
        workspaceStatus: status({}),
      }),
    ).toEqual([]);
    expect(
      buildThreadHeaderGitActions({
        thread: { archivedAt: 1 },
        environment: { managed: true },
        workspaceStatus: status({ hasUncommittedChanges: true }),
      }),
    ).toEqual([]);
    expect(
      buildThreadHeaderGitActions({
        thread: liveThread,
        environment: undefined,
        workspaceStatus: status({ hasUncommittedChanges: true }),
      }),
    ).toEqual([]);
  });
});

describe("describeEnvironmentActionFailure", () => {
  it("marks the route's 409 answers as blocked with the server's message", () => {
    const failure = describeEnvironmentActionFailure({
      action: "commit",
      error: new BbHttpError({
        status: 409,
        code: "no_changes",
        message: "No uncommitted changes to commit",
        body: {
          code: "no_changes",
          message: "No uncommitted changes to commit",
        },
      }),
    });
    expect(failure).toMatchObject({
      kind: "blocked",
      title: "Commit failed",
      description: "No uncommitted changes to commit",
    });
  });

  it("prefers workspace-unavailable details over the generic message", () => {
    const failure = describeEnvironmentActionFailure({
      action: "squash_merge",
      error: new BbHttpError({
        status: 409,
        code: "workspace_unavailable",
        message: "Workspace unavailable",
        body: {
          code: "workspace_unavailable",
          message: "Workspace unavailable",
          details: {
            kind: "workspace_unavailable",
            failure: {
              code: "path_not_found",
              workspacePath: "/tmp/missing-workspace",
              message:
                "Managed workspace path does not exist: /tmp/missing-workspace",
            },
          },
        },
      }),
    });
    expect(failure.kind).toBe("blocked");
    expect(failure.description).toBe(
      "Managed workspace path does not exist: /tmp/missing-workspace",
    );
    expect(failure.details?.kind).toBe("workspace_unavailable");
  });

  it("falls back to a transport description for non-HTTP errors", () => {
    const failure = describeEnvironmentActionFailure({
      action: "pull_request_merge",
      error: new Error("socket hang up"),
    });
    expect(failure).toMatchObject({
      kind: "error",
      title: "Failed to merge pull request",
      description: "socket hang up",
    });
  });

  it("describes successes by commit or server message", () => {
    expect(
      describeEnvironmentActionSuccess({
        ok: true,
        action: "commit",
        message: "Created commit abcdef1234",
        commitSha: "abcdef1234567890",
        commitSubject: "Fix the banner",
      }),
    ).toBe("abcdef1 Fix the banner");
    expect(
      describeEnvironmentActionSuccess({
        ok: true,
        action: "pull_request_ready",
        message: "Marked ready",
      }),
    ).toBe("Marked ready");
  });
});
