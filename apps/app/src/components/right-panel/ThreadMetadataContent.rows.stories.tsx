import type { ReactNode } from "react";
import type { EnvironmentDisplayHostContext } from "@bb/core-ui";
import {
  ParentSelectorRow,
  EnvironmentRow,
  WorkspacePathRow,
  BranchRow,
  MergeBaseRow,
  GitStatusRow,
  ArchivedRow,
  ThreadSchedulesRow,
  ThreadCommitsRow,
  ChangedFilesRow,
  ThreadMetadataCard,
} from "../secondary-panel/ThreadMetadataContent";
import {
  PanelStage,
  baseProps,
  localEnvironmentDisplayHost,
  parentThreads,
  makeEnvironment,
  makeThread,
  makeThreadSchedule,
  makeWorkspaceStatus,
} from "../secondary-panel/ThreadMetadataContent.fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "right-panel/Info/Row",
};

const noop = () => {};

const remoteEnvironmentDisplayHost: EnvironmentDisplayHostContext = {
  locality: "remote",
};

function RowStage({ children }: { children: ReactNode }) {
  return (
    <PanelStage>
      <ThreadMetadataCard>{children}</ThreadMetadataCard>
    </PanelStage>
  );
}

// ---------------------------------------------------------------------------
// Parent selector row.
// ---------------------------------------------------------------------------

export function ParentSelector() {
  return (
    <StoryCard>
      <StoryRow label="unassigned">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadDisplayName={null}
            parentThreads={parentThreads}
            canAssignToParent
            canTakeOverThread={false}
            updateThreadPending={false}
            onAssignParent={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="unassigned, no candidates">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadDisplayName={null}
            parentThreads={[]}
            canAssignToParent={false}
            canTakeOverThread={false}
            updateThreadPending={false}
            onAssignParent={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="assigned">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread({ parentThreadId: "thr_codex_parent" })}
            projectId={baseProps.projectId}
            parentThreadDisplayName="Codex Parent"
            parentThreads={parentThreads}
            canAssignToParent={false}
            canTakeOverThread
            updateThreadPending={false}
            onAssignParent={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="dropdown open">
        <RowStage>
          <ParentSelectorRow
            thread={makeThread()}
            projectId={baseProps.projectId}
            parentThreadDisplayName={null}
            parentThreads={parentThreads}
            canAssignToParent
            canTakeOverThread={false}
            updateThreadPending={false}
            onAssignParent={noop}
            defaultOpen
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Environment — the "Environment" row.
// ---------------------------------------------------------------------------

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
      <StoryRow label="direct">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({
              isWorktree: false,
              workspaceProvisionType: "unmanaged",
            })}
            environmentDisplayHost={localEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="remote direct">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({
              isWorktree: false,
              workspaceProvisionType: "unmanaged",
            })}
            environmentDisplayHost={remoteEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="provisioning">
        <RowStage>
          <EnvironmentRow
            thread={makeThread()}
            environment={makeEnvironment({
              status: "provisioning",
              isWorktree: false,
              workspaceProvisionType: "managed-worktree",
            })}
            environmentDisplayHost={localEnvironmentDisplayHost}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Workspace path — the "Worktree path" or "Workspace path" row.
// ---------------------------------------------------------------------------

export function WorkspacePath() {
  return (
    <StoryCard>
      <StoryRow label="managed worktree">
        <RowStage>
          <WorkspacePathRow
            thread={makeThread()}
            environment={makeEnvironment({
              path: "/Users/michael/.bb-dev/worktrees/env_demo/bb",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="long path">
        <RowStage>
          <WorkspacePathRow
            thread={makeThread()}
            environment={makeEnvironment({
              path: "/Users/michael/.bb-dev/worktrees/env_7m3cieyz6q/bb/apps/app/src/components/right-panel",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="unmanaged worktree">
        <RowStage>
          <WorkspacePathRow
            thread={makeThread()}
            environment={makeEnvironment({
              path: "/srv/repos/bb-linked-worktree",
              managed: false,
              workspaceProvisionType: "unmanaged",
            })}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="projectless workspace">
        <RowStage>
          <WorkspacePathRow
            thread={makeThread()}
            environment={makeEnvironment({
              path: "/Users/michael/Projects/bb",
              isWorktree: false,
              workspaceProvisionType: "personal",
            })}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Branch + merge base.
// ---------------------------------------------------------------------------

export function Branch() {
  return (
    <StoryCard>
      <StoryRow label="feature branch">
        <RowStage>
          <BranchRow
            thread={makeThread()}
            workspaceStatus={makeWorkspaceStatus()}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="long branch">
        <RowStage>
          <BranchRow
            thread={makeThread()}
            workspaceStatus={makeWorkspaceStatus({
              branch: {
                currentBranch:
                  "feat/sidebar-rail/extract-row-components-and-add-info-row-stories",
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
            thread={makeThread()}
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
            thread={makeThread()}
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
            thread={makeThread()}
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

// ---------------------------------------------------------------------------
// Git status — permutations of the "Git status" row.
// ---------------------------------------------------------------------------

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
            selectedMergeBaseBranch={undefined}
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
                hasUncommittedChanges: true,
                state: "dirty_uncommitted",
                insertions: 47,
                deletions: 21,
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
              },
            })}
            workspaceStatusError={null}
            selectedMergeBaseBranch={undefined}
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
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 0,
                deletions: 0,
                files: [],
              },
            })}
            workspaceStatusError={null}
            selectedMergeBaseBranch={undefined}
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
                hasCommittedUnmergedChanges: false,
                commits: [],
                insertions: 0,
                deletions: 0,
                files: [],
              },
            })}
            workspaceStatusError={null}
            selectedMergeBaseBranch={undefined}
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
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 0,
                deletions: 0,
                files: [],
              },
            })}
            workspaceStatusError={null}
            selectedMergeBaseBranch={undefined}
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
            selectedMergeBaseBranch={undefined}
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
            selectedMergeBaseBranch={undefined}
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
            selectedMergeBaseBranch={undefined}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Archived + Changed files — small lifecycle/diff rows.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Thread schedules — the "Schedules" row. Hidden entirely when there are none.
// ---------------------------------------------------------------------------

export function ThreadSchedules() {
  return (
    <StoryCard>
      <StoryRow label="single, enabled">
        <RowStage>
          <ThreadSchedulesRow schedules={[makeThreadSchedule()]} />
        </RowStage>
      </StoryRow>
      <StoryRow label="single, disabled" hint='reads "Not running" + Disabled pill'>
        <RowStage>
          <ThreadSchedulesRow
            schedules={[
              makeThreadSchedule({
                id: "sched_cleanup",
                name: "Weekly cleanup",
                enabled: false,
                cron: "0 18 * * 5",
                prompt: "Close stale follow-ups and archive merged threads.",
              }),
            ]}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="multiple">
        <RowStage>
          <ThreadSchedulesRow
            schedules={[
              makeThreadSchedule(),
              makeThreadSchedule({
                id: "sched_cleanup",
                name: "Weekly cleanup",
                enabled: false,
                cron: "0 18 * * 5",
                prompt: "Close stale follow-ups and archive merged threads.",
              }),
            ]}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}

// ---------------------------------------------------------------------------
// Commits ahead of the merge base. Hidden entirely when nothing is ahead;
// truncates with "Show N more" like the schedules row.
// ---------------------------------------------------------------------------

const aheadCommits = Array.from({ length: 7 }, (_, index) => ({
  sha: `${index}`.padEnd(40, "0"),
  shortSha: `a1b2c3${index}`,
  subject:
    index === 0
      ? "Render system thread references as rich mentions in the composer and timeline"
      : `Commit subject number ${index}`,
  authorName: "Ada Lovelace",
  authoredAt: 1_700_000_000_000,
}));

export function Commits() {
  return (
    <StoryCard>
      <StoryRow label="ahead of merge base (clickable, truncates at 5)">
        <RowStage>
          <ThreadCommitsRow
            workspaceStatus={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: aheadCommits.length,
                behindCount: 0,
                hasCommittedUnmergedChanges: true,
                commits: aheadCommits,
                insertions: 0,
                deletions: 0,
                files: [],
              },
            })}
            onCommitClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="nothing ahead (hidden)">
        <RowStage>
          <ThreadCommitsRow
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
          <ChangedFilesRow
            thread={makeThread()}
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                hasUncommittedChanges: true,
                state: "dirty_uncommitted",
                insertions: 47,
                deletions: 21,
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
              },
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="committed, not merged">
        <RowStage>
          <ChangedFilesRow
            thread={makeThread()}
            workspaceStatus={makeWorkspaceStatus({
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: 2,
                behindCount: 0,
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 110,
                deletions: 24,
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
              },
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
      <StoryRow label="uncommitted + committed">
        <RowStage>
          <ChangedFilesRow
            thread={makeThread()}
            workspaceStatus={makeWorkspaceStatus({
              workingTree: {
                hasUncommittedChanges: true,
                state: "dirty_and_committed_unmerged",
                insertions: 47,
                deletions: 21,
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
              },
              mergeBase: {
                mergeBaseBranch: "main",
                baseRef: "main",
                aheadCount: 2,
                behindCount: 0,
                hasCommittedUnmergedChanges: true,
                commits: [],
                insertions: 110,
                deletions: 24,
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
              },
            })}
            onChangedFileClick={noop}
          />
        </RowStage>
      </StoryRow>
    </StoryCard>
  );
}
