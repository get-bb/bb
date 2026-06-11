import type { WorkspaceFileStatus } from "@bb/domain";
import {
  ThreadGitActionDialogContent,
  type ThreadGitActionDialogTarget,
} from "./ThreadGitActionDialog";
import type { ThreadGitStatusDisplay } from "@/components/workspace/workspace-status";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { BRANCH_NAMES } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Thread Git Action",
};

const noop = () => {};
const asyncNoop = async () => {};

// Matches the dialog's custom DialogContent className: p-0 + tight border +
// 34rem width, leaving the form to own its own padding.
const stageClassName =
  "max-w-[34rem] gap-0 overflow-hidden border-border p-0 shadow-xl";

const commitTarget: ThreadGitActionDialogTarget = { kind: "commit" };
const commitAndSquashTarget: ThreadGitActionDialogTarget = {
  kind: "commit_and_squash_merge",
};
const squashTarget: ThreadGitActionDialogTarget = { kind: "squash_merge" };

const changedFiles: WorkspaceFileStatus[] = [
  {
    path: "apps/app/src/components/thread/dialogs/ThreadRenameDialog.tsx",
    status: "M",
    insertions: 28,
    deletions: 11,
  },
  {
    path: "apps/app/src/components/thread/dialogs/ThreadRenameDialog.stories.tsx",
    status: "A",
    insertions: 64,
    deletions: 0,
  },
  {
    path: "apps/app/src/components/thread/dialogs/ThreadGitActionDialog.tsx",
    status: "M",
    insertions: 14,
    deletions: 6,
  },
];

const changedFilesSection: WorkspaceChangedFilesSection = {
  kind: "uncommitted",
  label: "Uncommitted",
  files: changedFiles,
  mergeBaseRef: null,
  stats: {
    files: changedFiles,
    insertions: 106,
    deletions: 17,
  },
};

const dirtyGitStatus: ThreadGitStatusDisplay = {
  label: "Dirty",
  summary: "",
  summaryContent: "",
};

const aheadGitStatus: ThreadGitStatusDisplay = {
  label: "Ahead",
  summary: "3 ahead of origin/main",
  summaryContent: "3 ahead of origin/main",
};

const mergeBaseOptions = ["main", "develop", "staging"];
const mergeBaseRemoteOptions = ["origin/main", "origin/develop"];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="commit"
        hint='kind="commit" — branch + git status + changed files only, no merge base'
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={commitTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={dirtyGitStatus}
            changedFilesSection={changedFilesSection}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="commit + squash merge"
        hint="commit then squash — adds the Merge base picker"
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={commitAndSquashTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={dirtyGitStatus}
            changedFilesSection={changedFilesSection}
            showMergeBaseDetails
            mergeBaseBranch="main"
            mergeBaseBranchRef={{ name: "main", kind: "local" }}
            mergeBaseBranchOptions={mergeBaseOptions}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteOptions}
            onMergeBaseBranchChange={noop}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="squash merge"
        hint='kind="squash_merge" — no changed-files row, just branch + merge base'
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={squashTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={aheadGitStatus}
            showMergeBaseDetails
            mergeBaseBranch="main"
            mergeBaseBranchRef={{ name: "main", kind: "local" }}
            mergeBaseBranchOptions={mergeBaseOptions}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteOptions}
            onMergeBaseBranchChange={noop}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="squash merge, no picker"
        hint="merge base shown as plain text — no onMergeBaseBranchChange handler"
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={squashTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={aheadGitStatus}
            showMergeBaseDetails
            mergeBaseBranch="main"
            mergeBaseBranchRef={{ name: "main", kind: "local" }}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="checking target branch"
        hint="selected merge base is still being classified — inline footer status, submit disabled"
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={commitAndSquashTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={dirtyGitStatus}
            changedFilesSection={changedFilesSection}
            showMergeBaseDetails
            mergeBaseBranch="main"
            mergeBaseBranchOptions={["main"]}
            mergeBaseBranchOptionsLoading
            onMergeBaseBranchChange={noop}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="remote target blocked"
        hint="selected merge base is remote-only — inline footer validation stays visible"
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={squashTarget}
            branchName={BRANCH_NAMES.feature}
            gitStatusDisplay={aheadGitStatus}
            showMergeBaseDetails
            mergeBaseBranch="origin/main"
            mergeBaseBranchRef={{ name: "origin/main", kind: "remote" }}
            mergeBaseBranchOptions={mergeBaseOptions}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteOptions}
            onMergeBaseBranchChange={noop}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="minimal"
        hint="no detail card — commit dialog with everything unknown"
      >
        <DialogStage className={stageClassName}>
          <ThreadGitActionDialogContent
            target={commitTarget}
            onOpenChange={noop}
            onCommit={asyncNoop}
            onSquashMerge={asyncNoop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
