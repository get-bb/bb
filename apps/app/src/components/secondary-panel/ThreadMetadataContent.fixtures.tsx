import type { ReactNode } from "react";
import type {
  ThreadListEntry,
  ThreadPullRequest,
  WorkspaceMergeBase,
  WorkspaceWorkingTree,
} from "@bb/domain";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  makeEnvironment,
  makeThread,
  makeThreadListEntry,
  makeWorkspaceStatus,
} from "../../../.ladle/story-fixtures";
import type { ThreadMetadataContentProps } from "./ThreadMetadataContent";

export { makeEnvironment, makeThread, makeWorkspaceStatus };

const noop = () => {};

export const localEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: null,
};

export function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[480px] min-w-0 rounded-md border border-border bg-background px-4 py-3">
      {children}
    </div>
  );
}

export const parentThreads: ThreadListEntry[] = [
  makeThreadListEntry({
    id: "thr_codex_parent",
    title: "Codex Parent",
    titleFallback: "Codex Parent",
  }),
  makeThreadListEntry({
    id: "thr_frontend_parent",
    title: "Frontend Parent",
    titleFallback: "Frontend Parent",
  }),
];

export function makePullRequest(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  return {
    number: 128,
    title: "Show the branch's GitHub pull request in the Info tab",
    state: "open",
    url: "https://github.com/acme/bb/pull/128",
    baseRefName: "main",
    headRefName: "bb/pr-info-panel",
    updatedAt: "2026-06-16T12:30:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "passing",
      totalCount: 3,
      passedCount: 3,
      failedCount: 0,
      pendingCount: 0,
    },
    review: {
      state: "approved",
      reviewRequestCount: 0,
    },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "ready_to_merge",
    ...overrides,
  };
}

export const baseProps: ThreadMetadataContentProps = {
  thread: makeThread(),
  projectId: "proj_bb",
  parentThreadProjectId: null,
  parentThreadDisplayName: null,
  parentThreads,
  canAssignToParent: true,
  canTakeOverThread: false,
  isLoadingParentThreads: false,
  isParentThreadsError: false,
  environment: makeEnvironment(),
  environmentProvisioningFailure: false,
  environmentDisplayHost: localEnvironmentDisplayHost,
  workspaceStatus: makeWorkspaceStatus(),
  workspaceStatusError: null,
  pullRequest: null,
  selectedMergeBaseBranch: undefined,
  mergeBaseBranchOptions: ["main", "develop", "release/2026-04"],
  isLoadingMergeBaseBranchOptions: false,
  updateThreadPending: false,
  onAssignParent: noop,
  onParentSelectorOpenChange: noop,
  onRetryParentThreads: noop,
  onMergeBaseBranchChange: noop,
  onChangedFileClick: noop,
};

export const STORY_DIRTY_WORKING_TREE: Omit<WorkspaceWorkingTree, "state"> = {
  hasUncommittedChanges: true,
  insertions: 47,
  deletions: 21,
  lineStatsComplete: true,
  files: [
    {
      path: "apps/app/src/components/sidebar/ProjectRow.tsx",
      status: "M",
      insertions: 18,
      deletions: 9,
    },
    {
      path: "apps/app/src/components/sidebar/ThreadRow.tsx",
      status: "M",
      insertions: 5,
      deletions: 12,
    },
    {
      path: "apps/app/src/components/sidebar/ProjectRow.stories.tsx",
      status: "A",
      insertions: 24,
      deletions: 0,
    },
  ],
};

export const STORY_COMMITTED_MERGE_BASE: WorkspaceMergeBase = {
  mergeBaseBranch: "main",
  baseRef: "main",
  aheadCount: 2,
  behindCount: 0,
  hasCommittedUnmergedChanges: true,
  commits: [],
  insertions: 110,
  deletions: 24,
  lineStatsComplete: true,
  files: [
    {
      path: "apps/app/src/components/right-panel/ThreadMetadataContent.stories.tsx",
      status: "M",
      insertions: 38,
      deletions: 12,
    },
    {
      path: "apps/app/src/components/right-panel/ThreadMetadataContent.rows.stories.tsx",
      status: "A",
      insertions: 72,
      deletions: 0,
    },
  ],
};

export const STORY_AHEAD_COMMITS = Array.from({ length: 7 }, (_, index) => ({
  sha: `${index}`.padEnd(40, "0"),
  shortSha: `a1b2c3${index}`,
  subject:
    index === 0
      ? "Render system thread references as rich mentions in the composer and timeline"
      : `Commit subject number ${index}`,
  authorName: "Ada Lovelace",
  authoredAt: 1_700_000_000_000,
}));
