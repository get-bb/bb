import type {
  WorkspaceMergeBase,
  WorkspaceStatus,
  WorkspaceWorkingTree,
} from "./contract.js";

export function makeWorkspaceWorkingTree(
  overrides: Partial<WorkspaceWorkingTree> = {},
): WorkspaceWorkingTree {
  return {
    hasUncommittedChanges: false,
    state: "clean",
    insertions: 0,
    deletions: 0,
    lineStatsComplete: true,
    files: [],
    fileCount: overrides.files?.length ?? 0,
    ...overrides,
  };
}

export function makeWorkspaceMergeBase(
  overrides: Partial<WorkspaceMergeBase> = {},
): WorkspaceMergeBase {
  return {
    mergeBaseBranch: "main",
    baseRef: "main",
    aheadCount: 0,
    behindCount: 0,
    squashMergeCheckComplete: true,
    hasCommittedUnmergedChanges: false,
    commits: [],
    files: [],
    fileCount: overrides.files?.length ?? 0,
    insertions: 0,
    deletions: 0,
    lineStatsComplete: true,
    ...overrides,
  };
}

export function makeWorkspaceStatus(
  overrides: Partial<WorkspaceStatus> = {},
): WorkspaceStatus {
  const workingTree = overrides.workingTree ?? makeWorkspaceWorkingTree();
  const committed = overrides.mergeBase?.hasCommittedUnmergedChanges
    ? overrides.mergeBase
    : null;
  return {
    workingTree,
    checkout: { kind: "branch", branchName: "main", headSha: null },
    branch: { currentBranch: "main", defaultBranch: "main" },
    mergeBase: null,
    allChanges: {
      insertions: workingTree.insertions + (committed?.insertions ?? 0),
      deletions: workingTree.deletions + (committed?.deletions ?? 0),
      lineStatsComplete:
        workingTree.lineStatsComplete && (committed?.lineStatsComplete ?? true),
      fileCount: workingTree.fileCount + (committed?.fileCount ?? 0),
    },
    ...overrides,
  };
}
