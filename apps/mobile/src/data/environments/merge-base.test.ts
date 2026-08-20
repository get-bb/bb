import type { WorkspaceStatus } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  getMergeBaseBranchCandidateGroups,
  resolveEffectiveMergeBaseBranch,
  resolveMergeBaseVisibility,
  resolvePersistedMergeBaseBranch,
} from "./merge-base";

const environment = {
  baseBranch: "develop",
  defaultBranch: "main",
  mergeBaseBranch: null,
};

function status(currentBranch: string | null): WorkspaceStatus {
  return {
    workingTree: {
      state: "clean",
      hasUncommittedChanges: false,
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      files: [],
    },
    checkout: { kind: "detached", headSha: null },
    branch: { currentBranch, defaultBranch: "main" },
    mergeBase: null,
  };
}

describe("merge base resolution", () => {
  it("lets the selection win, then the persisted override, then the base branch", () => {
    expect(
      resolveEffectiveMergeBaseBranch({
        environment,
        selectedMergeBaseBranch: "release",
        workspaceStatus: undefined,
      }),
    ).toBe("release");
    expect(
      resolveEffectiveMergeBaseBranch({
        environment: { ...environment, mergeBaseBranch: "staging" },
        selectedMergeBaseBranch: undefined,
        workspaceStatus: undefined,
      }),
    ).toBe("staging");
    expect(
      resolveEffectiveMergeBaseBranch({
        environment,
        selectedMergeBaseBranch: undefined,
        workspaceStatus: undefined,
      }),
    ).toBe("develop");
  });

  it("persists the implicit default as null so the override is cleared", () => {
    expect(
      resolvePersistedMergeBaseBranch({
        branch: "develop",
        environment,
        workspaceStatus: undefined,
      }),
    ).toBeNull();
    expect(
      resolvePersistedMergeBaseBranch({
        branch: " release ",
        environment,
        workspaceStatus: undefined,
      }),
    ).toBe("release");
    expect(
      resolvePersistedMergeBaseBranch({
        branch: "",
        environment,
        workspaceStatus: undefined,
      }),
    ).toBeNull();
  });

  it("hides the merge-base picker on the default branch", () => {
    expect(
      resolveMergeBaseVisibility({
        effectiveMergeBaseBranch: "main",
        workspaceStatus: status("feature"),
      }),
    ).toEqual({ showBranchComparison: true, showMergeBase: true });
    expect(
      resolveMergeBaseVisibility({
        effectiveMergeBaseBranch: "main",
        workspaceStatus: status("main"),
      }),
    ).toEqual({ showBranchComparison: true, showMergeBase: false });
    expect(
      resolveMergeBaseVisibility({
        effectiveMergeBaseBranch: undefined,
        workspaceStatus: undefined,
      }),
    ).toEqual({ showBranchComparison: false, showMergeBase: false });
  });

  it("pins the current merge base into the group its ref classification names", () => {
    const base = {
      mergeBaseBranchOptions: ["main", "develop"],
      remoteMergeBaseBranchOptions: ["origin/main"],
    };
    expect(
      getMergeBaseBranchCandidateGroups({
        ...base,
        mergeBaseBranch: "main",
        mergeBaseBranchRef: { name: "main", kind: "local" },
      }),
    ).toEqual({ options: ["main", "develop"], remoteOptions: ["origin/main"] });
    expect(
      getMergeBaseBranchCandidateGroups({
        ...base,
        mergeBaseBranch: "origin/release",
        mergeBaseBranchRef: { name: "origin/release", kind: "remote" },
      }),
    ).toEqual({
      options: ["main", "develop"],
      remoteOptions: ["origin/release", "origin/main"],
    });
    expect(
      getMergeBaseBranchCandidateGroups({
        ...base,
        mergeBaseBranch: "release",
        mergeBaseBranchRef: null,
      }),
    ).toEqual({
      options: ["release", "main", "develop"],
      remoteOptions: ["origin/main"],
    });
    expect(
      getMergeBaseBranchCandidateGroups({
        ...base,
        mergeBaseBranch: "gone",
        mergeBaseBranchRef: { name: "gone", kind: "missing" },
      }),
    ).toEqual({ options: ["main", "develop"], remoteOptions: ["origin/main"] });
  });
});
