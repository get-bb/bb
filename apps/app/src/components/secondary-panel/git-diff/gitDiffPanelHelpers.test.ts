import type { WorkspaceCommitSummary } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildGitDiffSelectionOptions,
  buildGitDiffTarget,
  shouldResetSelectedGitDiffCommit,
} from "./gitDiffPanelHelpers";

function makeCommit(
  overrides: Partial<WorkspaceCommitSummary> = {},
): WorkspaceCommitSummary {
  return {
    authorName: "Author",
    authoredAt: 1,
    sha: "abc123",
    shortSha: "abc123",
    subject: "Initial change",
    ...overrides,
  };
}

describe("gitDiffPanelHelpers", () => {
  it("builds git diff targets from commit, uncommitted, and merge-base selections", () => {
    expect(buildGitDiffTarget("commit-sha", "main")).toEqual({
      sha: "commit-sha",
      type: "commit",
    });
    expect(buildGitDiffTarget("uncommitted", "main")).toEqual({
      type: "uncommitted",
    });
    expect(buildGitDiffTarget("uncommitted", undefined)).toEqual({
      type: "uncommitted",
    });
    expect(buildGitDiffTarget(null, "main")).toEqual({
      mergeBaseBranch: "main",
      type: "all",
    });
    expect(buildGitDiffTarget(null, undefined)).toBeUndefined();
  });

  it("builds selection options and resets stale selections", () => {
    const commits = [
      makeCommit({
        sha: "abc123",
        shortSha: "abc123",
        subject: "Initial change",
      }),
      makeCommit({
        sha: "def456",
        shortSha: "def456",
        subject: "Follow-up",
      }),
    ];

    expect(buildGitDiffSelectionOptions(commits)).toEqual([
      { value: "all", label: "All changes" },
      { value: "abc123", label: "Initial change", monoPrefix: "abc123" },
      { value: "def456", label: "Follow-up", monoPrefix: "def456" },
    ]);
    expect(
      buildGitDiffSelectionOptions(commits, { hasUncommittedChanges: true }),
    ).toEqual([
      { value: "all", label: "All changes" },
      { value: "uncommitted", label: "Uncommitted changes" },
      { value: "abc123", label: "Initial change", monoPrefix: "abc123" },
      { value: "def456", label: "Follow-up", monoPrefix: "def456" },
    ]);
    expect(
      buildGitDiffSelectionOptions([], { hasUncommittedChanges: true }),
    ).toEqual([
      { value: "all", label: "All changes" },
      { value: "uncommitted", label: "Uncommitted changes" },
    ]);
    expect(shouldResetSelectedGitDiffCommit("missing", commits)).toBe(true);
    expect(shouldResetSelectedGitDiffCommit("abc123", commits)).toBe(false);
    expect(shouldResetSelectedGitDiffCommit(null, commits)).toBe(false);
    expect(
      shouldResetSelectedGitDiffCommit("uncommitted", [], {
        hasUncommittedChanges: true,
      }),
    ).toBe(false);
    expect(
      shouldResetSelectedGitDiffCommit("uncommitted", [], {
        hasUncommittedChanges: false,
      }),
    ).toBe(true);
  });
});
