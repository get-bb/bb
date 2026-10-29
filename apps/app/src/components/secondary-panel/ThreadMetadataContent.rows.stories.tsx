import type { ReactNode } from "react";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  ParentSelectorRow,
  ParentNotificationsRow,
  EnvironmentRow,
  WorkspacePathRow,
  ArchivedRow,
  ThreadMetadataCard,
} from "./ThreadMetadataContent";
import type {
  ChangedFileActions,
} from "../../../../../plugins/git/ui/changed-files";
import {
  BranchRowView,
  GitStatusRowView,
  MergeBaseRowView,
} from "../../../../../plugins/git/ui/info/GitInfoRows";
import {
  CommitsSectionView,
} from "../../../../../plugins/git/ui/info/CommitsInfoSection";
import {
  UncommittedChangesSectionView,
} from "../../../../../plugins/git/ui/info/UncommittedChangesInfoSection";
import type { MergeBaseState } from "../../../../../plugins/git/ui/merge-base";
import {
  PanelStage,
  baseProps,
  localEnvironmentDisplayHost,
  parentThreads,
  STORY_AHEAD_COMMITS,
  STORY_COMMITTED_MERGE_BASE,
  STORY_DIRTY_WORKING_TREE,
  makeEnvironment,
  makeThread,
  makeWorkspaceStatus,
} from "./ThreadMetadataContent.fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "right-panel/Info/Row",
};

const noop = () => {};

const noopChangedFileActions: ChangedFileActions = {
  onChangedFileClick: noop,
  onOpenChangedFile: noop,
  onCommitClick: noop,
};

function storyMergeBase(overrides: Partial<MergeBaseState>): MergeBaseState {
  return {
    effectiveMergeBaseBranch: undefined,
    showMergeBase: true,
    showBranchComparison: true,
    selectedBranchRef: null,
    options: [],
    remoteOptions: [],
    optionsLoading: false,
    optionsLoaded: true,
    onChange: noop,
    onPickerOpenChange: noop,
    onSearchQueryChange: noop,
    ...overrides,
  };
}

const ambiguousEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "local",
  identity: { name: "Build Mac mini", connected: true },
};

const offlineEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "remote",
  identity: { name: "Build Mac mini", connected: false },
};

function RowStage({ children }: { children: ReactNode }) {
  return (
    <PanelStage>
      <ThreadMetadataCard>{children}</ThreadMetadataCard>
    </PanelStage>
  );
}

export function ParentSelector() {
  return (
    <StoryCard>
      <StoryRow label="unassigned">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadProjectId={null}
            parentThreadDisplayName={null}
            parentThreads={parentThreads}
            canAssignToParent
            canTakeOverThread={false}
            isLoadingParentThreads={false}
            isParentThreadsError={false}
            updateThreadPending={false}
            onAssignParent={noop}
            onParentSelectorOpenChange={noop}
            onRetryParentThreads={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="unassigned, no candidates">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadProjectId={null}
            parentThreadDisplayName={null}
            parentThreads={[]}
            canAssignToParent={false}
            canTakeOverThread={false}
            isLoadingParentThreads={false}
            isParentThreadsError={false}
            updateThreadPending={false}
            onAssignParent={noop}
            onParentSelectorOpenChange={noop}
            onRetryParentThreads={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="assigned">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread({ parentThreadId: "thr_codex_parent" })}
            projectId={baseProps.projectId}
            parentThreadProjectId={null}
            parentThreadDisplayName="Codex Parent"
            parentThreads={parentThreads}
            canAssignToParent={false}
            canTakeOverThread
            isLoadingParentThreads={false}
            isParentThreadsError={false}
            updateThreadPending={false}
            onAssignParent={noop}
            onParentSelectorOpenChange={noop}
            onRetryParentThreads={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="dropdown open">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadProjectId={null}
            parentThreadDisplayName={null}
            parentThreads={parentThreads}
            canAssignToParent
            canTakeOverThread={false}
            isLoadingParentThreads={false}
            isParentThreadsError={false}
            updateThreadPending={false}
            onAssignParent={noop}
            onParentSelectorOpenChange={noop}
            onRetryParentThreads={noop}
            defaultOpen
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ParentNotifications() {
  const thread = makeThread({
    parentThreadId: "thr_codex_parent",
    parentNotifications: "stuck",
  });
  return (
    <StoryCard>
      <StoryRow label="child, stuck">
        <RowStage>
          <ParentSelectorRow
            thread={thread}
            projectId={baseProps.projectId}
            parentThreadProjectId={null}
            parentThreadDisplayName="Codex Parent"
            parentThreads={parentThreads}
            canAssignToParent={false}
            canTakeOverThread
            isLoadingParentThreads={false}
            isParentThreadsError={false}
            updateThreadPending={false}
            onAssignParent={noop}
            onParentSelectorOpenChange={noop}
            onRetryParentThreads={noop}
          />
          <ParentNotificationsRow thread={thread} />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Environment() {
  return (
    <StoryCard>
      <StoryRow label="worktree">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment()}
            environmentDisplayHost={localEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="named">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({ name: "Linked review tree" })}
            environmentDisplayHost={localEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="ambiguous host">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment()}
            environmentDisplayHost={ambiguousEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="ambiguous host offline">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment()}
            environmentDisplayHost={offlineEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="provisioning">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({
              status: "provisioning",
            })}
            environmentDisplayHost={localEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function WorkspacePath() {
  return (
    <StoryCard>
      <StoryRow label="managed worktree">
        <RowStage>
          <WorkspacePathRow
            environment={makeEnvironment({
              path: "/Users/michael/.bb-dev/worktrees/env_demo/bb",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="long path">
        <RowStage>
          <WorkspacePathRow
            environment={makeEnvironment({
              path: "/Users/michael/.bb-dev/worktrees/env_7m3cieyz6q/bb/apps/app/src/components/right-panel",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="unmanaged worktree">
        <RowStage>
          <WorkspacePathRow
            environment={makeEnvironment({
              path: "/srv/repos/bb-linked-worktree",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="projectless workspace">
        <RowStage>
          <WorkspacePathRow
            environment={makeEnvironment({
              path: "/Users/michael/Projects/bb",
            })}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Branch() {
  return (
    <StoryCard>
      <StoryRow label="feature branch">
        <RowStage>
          <BranchRowView workspace={makeWorkspaceStatus()} />
        </RowStage>
      </StoryRow>
      <StoryRow label="long branch">
        <RowStage>
          <BranchRowView
            workspace={makeWorkspaceStatus({
              checkout: {
                kind: "branch",
                branchName:
                  "feat/sidebar-rail/extract-row-components-and-add-info-row-stories",
                headSha: null,
              },
              branch: {
                currentBranch:
                  "feat/sidebar-rail/extract-row-components-and-add-info-row-stories",
                defaultBranch: "main",
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="detached checkout">
        <RowStage>
          <BranchRowView
            workspace={makeWorkspaceStatus({
              checkout: {
                kind: "detached",
                headSha: "abcdef1234567890",
              },
              branch: {
                currentBranch: null,
                defaultBranch: "main",
              },
            })}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function MergeBase() {
  return (
    <StoryCard>
      <StoryRow label="feature branch">
        <RowStage>
          <MergeBaseRowView
            workspace={makeWorkspaceStatus()}
            mergeBase={storyMergeBase({
              options: ["main", "develop", "release/2026-04"],
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="loading candidates">
        <RowStage>
          <MergeBaseRowView
            workspace={makeWorkspaceStatus()}
            mergeBase={storyMergeBase({
              optionsLoading: true,
              optionsLoaded: false,
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="picker open">
        <RowStage>
          <MergeBaseRowView
            workspace={makeWorkspaceStatus()}
            mergeBase={storyMergeBase({
              options: ["main", "develop", "release/2026-04"],
            })}
            defaultOpen
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function GitStatus() {
  return (
    <StoryCard>
      <StoryRow label="clean">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus()}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="dirty (uncommitted)">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_uncommitted",
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="ahead">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: 5,
                behindCount: 0,
                squashMergeCheckComplete: true,
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 0,
                deletions: 0,
                lineStatsComplete: true,
                fileCount: 0,
                files: [],
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="behind">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: 0,
                behindCount: 3,
                squashMergeCheckComplete: true,
                hasCommittedUnmergedChanges: false,
                commits: [],
                insertions: 0,
                deletions: 0,
                lineStatsComplete: true,
                fileCount: 0,
                files: [],
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="diverged">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: 4,
                behindCount: 2,
                squashMergeCheckComplete: true,
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 0,
                deletions: 0,
                lineStatsComplete: true,
                fileCount: 0,
                files: [],
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="untracked">
        <RowStage>
          <GitStatusRowView
            failure={undefined}
            errorMessage={null}
            workspace={makeWorkspaceStatus({
              workingTree: {
                hasUncommittedChanges: false,
                state: "untracked",
                insertions: 0,
                deletions: 0,
                lineStatsComplete: false,
                fileCount: 3,
                files: [
                  {
                    path: "scratch.md",
                    status: "??",
                    insertions: null,
                    deletions: null,
                  },
                  {
                    path: "notes/scratch.md",
                    status: "??",
                    insertions: null,
                    deletions: null,
                  },
                  {
                    path: "tmp/output.json",
                    status: "??",
                    insertions: null,
                    deletions: null,
                  },
                ],
              },
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="workspace not found">
        <RowStage>
          <GitStatusRowView
            workspace={undefined}
            failure={{
              code: "path_not_found",
              workspacePath: "/Users/michael/Projects/bb",
              message: "Workspace not found.",
            }}
            errorMessage={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="error">
        <RowStage>
          <GitStatusRowView
            workspace={undefined}
            failure={undefined}
            errorMessage="git status failed: ENOENT"
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Archived() {
  return (
    <StoryCard>
      <StoryRow label="archived">
        <RowStage>
          <ArchivedRow thread={makeThread({ archivedAt: 1_700_000_000_000 })} />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function Commits() {
  return (
    <StoryCard>
      <StoryRow label="ahead of merge base (clickable, truncates at 5)">
        <RowStage>
          <CommitsSectionView
            workspace={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: STORY_AHEAD_COMMITS.length,
                behindCount: 0,
                squashMergeCheckComplete: true,
                hasCommittedUnmergedChanges: true,
                commits: STORY_AHEAD_COMMITS,
                insertions: 0,
                deletions: 0,
                lineStatsComplete: true,
                fileCount: 0,
                files: [],
              },
            })}
            actions={noopChangedFileActions}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="nothing ahead (hidden)">
        <RowStage>
          <CommitsSectionView
            workspace={makeWorkspaceStatus()}
            actions={noopChangedFileActions}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ChangedFiles() {
  return (
    <StoryCard>
      <StoryRow label="uncommitted">
        <RowStage>
          <UncommittedChangesSectionView
            workspace={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_uncommitted",
              },
            })}
            actions={noopChangedFileActions}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="committed, not merged">
        <RowStage>
          <CommitsSectionView
            workspace={makeWorkspaceStatus({
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            actions={noopChangedFileActions}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="uncommitted + committed">
        <RowStage>
          <UncommittedChangesSectionView
            workspace={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_and_committed_unmerged",
              },
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            actions={noopChangedFileActions}
          />
          <CommitsSectionView
            workspace={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_and_committed_unmerged",
              },
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            actions={noopChangedFileActions}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}
