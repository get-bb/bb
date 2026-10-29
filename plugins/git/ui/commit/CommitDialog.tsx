import type { FormEvent } from "react";
import {
  experimental_DetailRow as DetailRow,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getGitStatusDisplay,
  SquashMergeInfo,
  type ThreadGitStatusDisplay,
} from "@bb/shared-ui/git-status-display";
import { cn } from "@bb/shared-ui/lib/utils";
import { WorkspaceChangesList } from "@bb/shared-ui/workspace-changes-list";
import {
  renderChangeSummary,
  selectWorkspaceChangedFilesSection,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "@bb/shared-ui/workspace-change-summary";
import { useGitStatus } from "../queries.js";
import {
  closeCommitDialog,
  commit,
  useCommitDialogTarget,
  type CommitDialogTarget,
} from "./commit-store.js";

export function CommitDialogOverlay() {
  const target = useCommitDialogTarget();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeCommitDialog();
      }}
    >
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        {target !== null ? (
          <CommitDialogTargetContent key={target.threadId} target={target} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CommitDialogTargetContent({ target }: { target: CommitDialogTarget }) {
  const sdk = useSdk();
  const { workspace, failure, errorMessage } = useGitStatus(
    target.environmentId,
  );
  const section = selectWorkspaceChangedFilesSection(workspace);
  const mergeBaseBranch =
    workspace?.mergeBase?.mergeBaseBranch ??
    workspace?.branch.defaultBranch ??
    undefined;
  return (
    <CommitDialogContent
      branchName={workspace?.branch.currentBranch ?? undefined}
      gitStatusDisplay={getGitStatusDisplay(workspace, {
        mergeBaseBranch,
        showBranchComparison: Boolean(mergeBaseBranch),
        errorMessage,
        ...(failure === undefined ? {} : { workspaceUnavailable: failure }),
      })}
      changedFilesSection={
        section === null || section.kind === "committed" ? null : section
      }
      onCommit={() => {
        closeCommitDialog();
        void commit(sdk, target);
      }}
    />
  );
}

const DETAIL_LABEL_CLASS = "m-0 text-xs leading-5 text-muted-foreground";
const DETAIL_VALUE_CLASS = "m-0 min-w-0 text-xs leading-5 text-foreground";

function ChangedFilesRow({
  section,
}: {
  section: WorkspaceChangedFilesSection;
}) {
  return (
    <div className="mt-3 flex flex-col gap-1 py-0.5">
      <dt className={DETAIL_LABEL_CLASS}>
        <span className="flex items-baseline gap-x-3">
          <span className="min-w-[var(--detail-label-width,96px)] truncate">
            {section.label}
          </span>
          <span className="truncate text-muted-foreground">
            {renderChangeSummary(toChangeTally(section.stats))}
          </span>
        </span>
      </dt>
      <dd className={cn(DETAIL_VALUE_CLASS, "pt-0.5")}>
        <WorkspaceChangesList
          files={section.files}
          fileCount={section.stats.fileCount}
          className="max-h-40"
        />
      </dd>
    </div>
  );
}

export function CommitDialogContent({
  branchName,
  gitStatusDisplay,
  changedFilesSection,
  onCommit,
}: {
  branchName?: string;
  gitStatusDisplay?: ThreadGitStatusDisplay;
  changedFilesSection?: WorkspaceChangedFilesSection | null;
  onCommit: () => void;
}) {
  const shouldShowChangedFilesRow = Boolean(
    changedFilesSection && changedFilesSection.files.length > 0,
  );
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onCommit();
  };
  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-3">
        <DialogTitle>Commit changes</DialogTitle>
        <DialogDescription>
          Create a commit from the current workspace changes.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4 px-6 pt-1 pb-5" onSubmit={handleSubmit}>
        {branchName || gitStatusDisplay || shouldShowChangedFilesRow ? (
          <dl className="flex flex-col gap-1">
            {branchName ? (
              <DetailRow icon="GitBranch" label="Branch">
                <span className="block truncate" title={branchName}>
                  {branchName}
                </span>
              </DetailRow>
            ) : null}
            {gitStatusDisplay ? (
              <DetailRow icon="FileDiff" label="Git status">
                <div
                  className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                  title={`${gitStatusDisplay.label} ${gitStatusDisplay.summary}`.trim()}
                >
                  <span className="shrink-0 font-medium">
                    {gitStatusDisplay.label}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {gitStatusDisplay.summary}
                  </span>
                  {gitStatusDisplay.warning ? <SquashMergeInfo /> : null}
                </div>
              </DetailRow>
            ) : null}
            {shouldShowChangedFilesRow && changedFilesSection ? (
              <ChangedFilesRow section={changedFilesSection} />
            ) : null}
          </dl>
        ) : null}
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:space-x-0">
          <Button type="submit" size="sm" className="shrink-0">
            Commit changes
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
