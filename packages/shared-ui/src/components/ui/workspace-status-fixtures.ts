import type { GitStatusDisplayStatus } from "./git-status-display";
import type {
  WorkspaceChangedFileStatus,
  WorkspaceChangesStatus,
} from "./workspace-change-summary";

export interface WorkspaceCommitFixture {
  sha: string;
  shortSha: string;
  subject: string;
  authorName: string;
  authoredAt: number;
}

type WorkingTreeFixture = WorkspaceChangesStatus["workingTree"] &
  GitStatusDisplayStatus["workingTree"] & { hasUncommittedChanges: boolean };
type MergeBaseFixture = NonNullable<
  WorkspaceChangesStatus<
    WorkspaceChangedFileStatus,
    WorkspaceCommitFixture
  >["mergeBase"]
> &
  NonNullable<GitStatusDisplayStatus["mergeBase"]> & {
    hasCommittedUnmergedChanges: boolean;
  };

export interface WorkspaceStatusFixture {
  workingTree: WorkingTreeFixture;
  mergeBase: MergeBaseFixture | null;
}

export function makeWorkspaceWorkingTree(
  overrides: Partial<WorkingTreeFixture> = {},
): WorkingTreeFixture {
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
  overrides: Partial<MergeBaseFixture> = {},
): MergeBaseFixture {
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
  overrides: Partial<WorkspaceStatusFixture> = {},
): WorkspaceStatusFixture {
  return {
    workingTree: makeWorkspaceWorkingTree(),
    mergeBase: null,
    ...overrides,
  };
}
