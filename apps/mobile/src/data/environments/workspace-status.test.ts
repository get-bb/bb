import type { WorkspaceStatus } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import { describe, expect, it } from "vitest";
import {
  formatChangedFilesSectionLabel,
  formatChangeSummary,
  getGitStatusDisplay,
  getWorkspaceStatusFromResponse,
  selectWorkspaceChangedFilesSection,
  selectWorkspaceChangedFilesSections,
  toChangeTally,
} from "./workspace-status";

function workspaceStatus(
  overrides: {
    workingTree?: Partial<WorkspaceStatus["workingTree"]>;
    mergeBase?: Partial<NonNullable<WorkspaceStatus["mergeBase"]>> | null;
    branch?: Partial<WorkspaceStatus["branch"]>;
  } = {},
): WorkspaceStatus {
  const mergeBase =
    overrides.mergeBase === null
      ? null
      : {
          mergeBaseBranch: "main",
          baseRef: "abc123",
          aheadCount: 0,
          behindCount: 0,
          hasCommittedUnmergedChanges: false,
          commits: [],
          insertions: 0,
          deletions: 0,
          lineStatsComplete: true,
          files: [],
          ...overrides.mergeBase,
        };
  return {
    workingTree: {
      state: "clean",
      hasUncommittedChanges: false,
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
      ...overrides.workingTree,
    },
    checkout: { kind: "branch", branchName: "feature", headSha: "abc123" },
    branch: {
      currentBranch: "feature",
      defaultBranch: "main",
      ...overrides.branch,
    },
    mergeBase,
  };
}

describe("formatChangeSummary", () => {
  it("reads files and line stats, and degrades when stats are incomplete", () => {
    expect(
      formatChangeSummary({
        filesCount: 3,
        insertions: 12,
        deletions: 4,
        lineStatsComplete: true,
      }),
    ).toBe("3 files, +12 -4");
    expect(
      formatChangeSummary({
        filesCount: 1,
        insertions: 12,
        deletions: 4,
        lineStatsComplete: false,
      }),
    ).toBe("1 file");
    expect(
      formatChangeSummary({
        filesCount: 2,
        insertions: 0,
        deletions: 0,
        lineStatsComplete: true,
      }),
    ).toBe("2 files");
    expect(
      formatChangeSummary({
        filesCount: 0,
        insertions: 0,
        deletions: 0,
        lineStatsComplete: true,
      }),
    ).toBe("No changes");
  });
});

describe("selectWorkspaceChangedFilesSections", () => {
  const dirtyFile = {
    path: "src/a.ts",
    status: "M" as const,
    insertions: 3,
    deletions: 1,
  };
  const committedFile = {
    path: "src/b.ts",
    status: "A" as const,
    insertions: 10,
    deletions: 0,
  };

  it("orders the working tree before committed-unmerged changes and keeps per-section stats", () => {
    const sections = selectWorkspaceChangedFilesSections(
      workspaceStatus({
        workingTree: {
          state: "dirty_and_committed_unmerged",
          hasUncommittedChanges: true,
          files: [dirtyFile],
          insertions: 3,
          deletions: 1,
        },
        mergeBase: {
          files: [committedFile],
          insertions: 10,
          deletions: 0,
          hasCommittedUnmergedChanges: true,
          baseRef: "base",
        },
      }),
    );
    expect(sections.map((section) => section.kind)).toEqual([
      "uncommitted",
      "committed",
    ]);
    expect(sections[1]?.mergeBaseRef).toBe("base");
    expect(toChangeTally(sections[0]!.stats)).toEqual({
      filesCount: 1,
      insertions: 3,
      deletions: 1,
      lineStatsComplete: true,
    });
    expect(formatChangedFilesSectionLabel(sections[1]!)).toBe(
      "Committed · 1 file, +10 -0",
    );
  });

  it("labels an untracked-only working tree as untracked and hides empty buckets", () => {
    const untracked = selectWorkspaceChangedFilesSection(
      workspaceStatus({
        workingTree: {
          state: "untracked",
          files: [
            {
              path: "new.txt",
              status: "??",
              insertions: null,
              deletions: null,
            },
          ],
          lineStatsComplete: false,
        },
      }),
    );
    expect(untracked?.kind).toBe("untracked");
    expect(formatChangedFilesSectionLabel(untracked!)).toBe(
      "Untracked · 1 file",
    );
    expect(selectWorkspaceChangedFilesSection(workspaceStatus())).toBeNull();
    expect(selectWorkspaceChangedFilesSection(undefined)).toBeNull();
  });
});

describe("getGitStatusDisplay", () => {
  it("describes the merge-base comparison when asked, else the working-tree state", () => {
    const ahead = workspaceStatus({ mergeBase: { aheadCount: 2 } });
    expect(
      getGitStatusDisplay(ahead, {
        mergeBaseBranch: "main",
        showBranchComparison: true,
      }),
    ).toEqual({ label: "Ahead", summary: "2 ahead of main" });
    expect(getGitStatusDisplay(ahead)).toEqual({
      label: "Ahead",
      summary: "Local commits pending merge.",
    });
    expect(
      getGitStatusDisplay(
        workspaceStatus({ mergeBase: { aheadCount: 1, behindCount: 3 } }),
        { showBranchComparison: true },
      ),
    ).toEqual({
      label: "Diverged",
      summary: "1 ahead, 3 behind relative to main",
    });
    expect(
      getGitStatusDisplay(workspaceStatus(), { showBranchComparison: true }),
    ).toEqual({
      label: "Up to date",
      summary: "No local changes relative to main.",
    });
    expect(getGitStatusDisplay(workspaceStatus({ mergeBase: null }))).toEqual({
      label: "Clean",
      summary: "No local changes.",
    });
    expect(
      getGitStatusDisplay(
        workspaceStatus({
          workingTree: {
            state: "dirty_uncommitted",
            hasUncommittedChanges: true,
          },
        }),
      ),
    ).toEqual({ label: "Dirty", summary: "" });
  });

  it("explains a missing status from the failure, the error, or deletion", () => {
    expect(
      getGitStatusDisplay(undefined, {
        workspaceUnavailable: {
          code: "path_not_found",
          message: "gone",
          workspacePath: "/x",
        },
      }).summary,
    ).toBe("Workspace not found.");
    expect(
      getGitStatusDisplay(undefined, {
        error: new BbHttpError({
          status: 404,
          code: "path_not_found",
          message: "missing",
          body: null,
        }),
      }).summary,
    ).toBe("Workspace not found.");
    expect(
      getGitStatusDisplay(undefined, { workspaceDeleted: true }).summary,
    ).toBe("Workspace not found.");
    expect(getGitStatusDisplay(undefined).summary).toBe(
      "Workspace status unavailable.",
    );
  });

  it("unwraps only the available outcome of a status response", () => {
    const status = workspaceStatus();
    expect(
      getWorkspaceStatusFromResponse({
        outcome: "available",
        workspace: status,
      }),
    ).toBe(status);
    expect(
      getWorkspaceStatusFromResponse({
        outcome: "not_applicable",
        reason: "non_git_environment",
        message: "not git",
      }),
    ).toBeUndefined();
  });
});
