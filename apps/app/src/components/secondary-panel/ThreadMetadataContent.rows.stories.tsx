import type { ReactNode } from "react";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  ParentSelectorRow,
  ParentNotificationsRow,
  EnvironmentRow,
  WorkspacePathRow,
  BranchRow,
  MergeBaseRow,
  GitStatusRow,
  ArchivedRow,
  ThreadMetadataCard,
} from "./ThreadMetadataContent";
import { UncommittedChangesSection } from "./info/ChangesSection";
import { CommitsSection } from "./info/CommitsSection";
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
          <BranchRow workspaceStatus={makeWorkspaceStatus()} />
        </RowStage>
      </StoryRow>
      <StoryRow label="long branch">
        <RowStage>
          <BranchRow
            workspaceStatus={makeWorkspaceStatus({
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
          <BranchRow
            workspaceStatus={makeWorkspaceStatus({
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
          <MergeBaseRow
            workspaceStatus={makeWorkspaceStatus()}
            selectedMergeBaseBranch={undefined}
            mergeBaseBranchOptions={["main", "develop", "release/2026-04"]}
            isLoadingMergeBaseBranchOptions={false}
            onMergeBaseBranchChange={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="loading candidates">
        <RowStage>
          <MergeBaseRow
            workspaceStatus={makeWorkspaceStatus()}
            selectedMergeBaseBranch={undefined}
            mergeBaseBranchOptions={undefined}
            isLoadingMergeBaseBranchOptions
            onMergeBaseBranchChange={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="picker open">
        <RowStage>
          <MergeBaseRow
            workspaceStatus={makeWorkspaceStatus()}
            selectedMergeBaseBranch={undefined}
            mergeBaseBranchOptions={["main", "develop", "release/2026-04"]}
            isLoadingMergeBaseBranchOptions={false}
            onMergeBaseBranchChange={noop}
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
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus()}
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="dirty (uncommitted)">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_uncommitted",
              },
            })}
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="ahead">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus({
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
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="behind">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus({
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
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="diverged">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus({
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
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="untracked">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={makeWorkspaceStatus({
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
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="workspace not found">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment({ status: "destroyed" })}
            workspaceStatus={undefined}
            workspaceStatusError={null}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="error">
        <RowStage>
          <GitStatusRow
            thread={makeThread()}
            environment={makeEnvironment()}
            workspaceStatus={undefined}
            workspaceStatusError={new Error("git status failed: ENOENT")}
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
          <CommitsSection
            workspaceStatus={makeWorkspaceStatus({
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
            onCommitClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="nothing ahead (hidden)">
        <RowStage>
          <CommitsSection
            workspaceStatus={makeWorkspaceStatus()}
            onCommitClick={noop}
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
          <UncommittedChangesSection
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_uncommitted",
              },
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="committed, not merged">
        <RowStage>
          <CommitsSection
            workspaceStatus={makeWorkspaceStatus({
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="uncommitted + committed">
        <RowStage>
          <UncommittedChangesSection
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_and_committed_unmerged",
              },
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            onChangedFileClick={noop}
          />
          <CommitsSection
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                ...STORY_DIRTY_WORKING_TREE,
                state: "dirty_and_committed_unmerged",
              },
              mergeBase: STORY_COMMITTED_MERGE_BASE,
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}
