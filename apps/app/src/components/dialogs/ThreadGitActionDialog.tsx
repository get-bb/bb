import { useMemo, useState, type FormEvent } from "react";
import { assertNever } from "@bb/core-ui";
import type { GitBranchRefClassification } from "@bb/domain";
import {
  DetailCard,
  DetailRow,
  DetailRowIconLabel,
} from "@/components/ui/detail-card.js";
import type { ThreadGitStatusDisplay } from "@/components/workspace/workspace-status";
import { ChangedFilesDetailRow } from "@/components/workspace/ChangedFilesDetailRow";
import type { WorkspaceChangedFilesSection } from "@/components/workspace/workspace-change-summary";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  getMergeBaseBranchCandidateGroups,
  BranchPicker,
} from "@/components/pickers/BranchPicker";

export type ThreadGitActionDialogTarget =
  | { kind: "commit" }
  | { kind: "commit_and_squash_merge" }
  | { kind: "squash_merge" };

interface ThreadGitActionDialogProps {
  target: ThreadGitActionDialogTarget | null;
  branchName?: string;
  gitStatusDisplay?: ThreadGitStatusDisplay;
  changedFilesSection?: WorkspaceChangedFilesSection | null;
  showMergeBaseDetails?: boolean;
  mergeBaseBranch?: string;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions?: string[];
  mergeBaseRemoteBranchOptions?: readonly string[];
  mergeBaseBranchOptionsLoading?: boolean;
  onMergeBaseBranchChange?: (branch: string) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onCommit: () => Promise<void>;
  onSquashMerge: (args: { mergeBaseBranch: string }) => Promise<void>;
}

function getDialogCopy(target: ThreadGitActionDialogTarget) {
  switch (target.kind) {
    case "commit":
      return {
        title: "Commit changes",
        description: "Create a commit from the current workspace changes.",
        submitLabel: "Commit changes",
        showCommitControls: true,
        showMergeBase: false,
      };
    case "commit_and_squash_merge":
      return {
        title: "Commit and squash merge",
        description:
          "Commit the current workspace changes, then squash merge this branch.",
        submitLabel: "Commit + squash merge",
        showCommitControls: true,
        showMergeBase: true,
      };
    case "squash_merge":
      return {
        title: "Squash merge",
        description: "Squash merge this branch into the selected merge base.",
        submitLabel: "Squash merge",
        showCommitControls: false,
        showMergeBase: true,
      };
    default:
      return assertNever(target);
  }
}

export function ThreadGitActionDialog({
  target,
  branchName,
  gitStatusDisplay,
  changedFilesSection,
  showMergeBaseDetails = false,
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseRemoteBranchOptions,
  mergeBaseBranchOptionsLoading = false,
  onMergeBaseBranchChange,
  onMergeBaseBranchSearchQueryChange,
  onOpenChange,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogProps) {
  const dialogCopy = useMemo(
    () => (target ? getDialogCopy(target) : null),
    [target],
  );

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[34rem] gap-0 overflow-hidden border-border bg-background p-0 shadow-sm">
        {target && dialogCopy ? (
          <ThreadGitActionDialogContent
            key={target.kind}
            target={target}
            branchName={branchName}
            gitStatusDisplay={gitStatusDisplay}
            changedFilesSection={changedFilesSection}
            showMergeBaseDetails={showMergeBaseDetails}
            mergeBaseBranch={mergeBaseBranch}
            mergeBaseBranchRef={mergeBaseBranchRef}
            mergeBaseBranchOptions={mergeBaseBranchOptions}
            mergeBaseRemoteBranchOptions={mergeBaseRemoteBranchOptions}
            mergeBaseBranchOptionsLoading={mergeBaseBranchOptionsLoading}
            onMergeBaseBranchChange={onMergeBaseBranchChange}
            onMergeBaseBranchSearchQueryChange={
              onMergeBaseBranchSearchQueryChange
            }
            onOpenChange={onOpenChange}
            onCommit={onCommit}
            onSquashMerge={onSquashMerge}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type ThreadGitActionDialogContentProps = Omit<
  ThreadGitActionDialogProps,
  "target"
> & {
  target: ThreadGitActionDialogTarget;
};

export function ThreadGitActionDialogContent({
  target,
  branchName,
  gitStatusDisplay,
  changedFilesSection,
  showMergeBaseDetails,
  mergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseRemoteBranchOptions,
  mergeBaseBranchOptionsLoading,
  onMergeBaseBranchChange,
  onMergeBaseBranchSearchQueryChange,
  onOpenChange,
  onCommit,
  onSquashMerge,
}: ThreadGitActionDialogContentProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogCopy = getDialogCopy(target);
  const mergeBaseCandidateGroups = getMergeBaseBranchCandidateGroups({
    mergeBaseBranch,
    mergeBaseBranchRef,
    mergeBaseBranchOptions,
    remoteMergeBaseBranchOptions: mergeBaseRemoteBranchOptions,
  });
  const mergeBaseCandidates = mergeBaseCandidateGroups.options;
  const remoteMergeBaseCandidates = mergeBaseCandidateGroups.remoteOptions;
  const selectedMergeBaseBranch = mergeBaseBranch ?? mergeBaseCandidates[0];
  const selectedMergeBaseBranchRef =
    mergeBaseBranchRef?.name === selectedMergeBaseBranch
      ? mergeBaseBranchRef
      : null;
  const selectedMergeBaseBranchClassificationPending =
    dialogCopy.showMergeBase &&
    Boolean(selectedMergeBaseBranch) &&
    mergeBaseBranchRef === undefined;
  const remoteMergeBaseBranches = useMemo(
    () => new Set(remoteMergeBaseCandidates),
    [remoteMergeBaseCandidates],
  );
  const selectedMergeBaseBranchIsRemote = selectedMergeBaseBranch
    ? selectedMergeBaseBranchRef?.kind === "remote" ||
      (selectedMergeBaseBranchRef === null &&
        remoteMergeBaseBranches.has(selectedMergeBaseBranch))
    : false;
  const selectedMergeBaseBranchMissing =
    selectedMergeBaseBranchRef?.kind === "missing";
  const blocksRemoteMergeBase =
    dialogCopy.showMergeBase && selectedMergeBaseBranchIsRemote;
  const remoteMergeBaseErrorMessage =
    "Squash merge requires a local target branch.";
  const missingMergeBaseErrorMessage =
    "Squash merge requires an existing local target branch.";
  const checkingMergeBaseMessage = "Checking target branch";
  const canSelectMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    Boolean(onMergeBaseBranchChange) &&
    (mergeBaseCandidates.length > 0 || remoteMergeBaseCandidates.length > 0);
  const canShowMergeBase =
    dialogCopy.showMergeBase &&
    showMergeBaseDetails === true &&
    (canSelectMergeBase || Boolean(selectedMergeBaseBranch));
  const shouldShowChangedFilesRow = Boolean(
    changedFilesSection && changedFilesSection.files.length > 0,
  );
  const mergeBaseValidationErrorMessage = !selectedMergeBaseBranch
    ? "A merge base branch is required"
    : blocksRemoteMergeBase
      ? remoteMergeBaseErrorMessage
      : selectedMergeBaseBranchMissing
        ? missingMergeBaseErrorMessage
        : null;
  const mergeBaseSubmitBlockMessage =
    selectedMergeBaseBranchClassificationPending
      ? checkingMergeBaseMessage
      : mergeBaseValidationErrorMessage;
  const visibleMergeBaseStatusMessage =
    !errorMessage && selectedMergeBaseBranchClassificationPending
      ? checkingMergeBaseMessage
      : null;
  const visibleMergeBaseErrorMessage =
    errorMessage ??
    (blocksRemoteMergeBase
      ? remoteMergeBaseErrorMessage
      : selectedMergeBaseBranchMissing
        ? missingMergeBaseErrorMessage
        : null);
  const footerMergeBaseMessage =
    visibleMergeBaseErrorMessage ?? visibleMergeBaseStatusMessage;
  const footerMergeBaseMessageIsError = Boolean(visibleMergeBaseErrorMessage);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    switch (target.kind) {
      case "commit":
        onOpenChange(false);
        void onCommit();
        break;
      case "commit_and_squash_merge":
        if (selectedMergeBaseBranchClassificationPending) {
          return;
        }
        if (mergeBaseValidationErrorMessage || !selectedMergeBaseBranch) {
          setErrorMessage(
            mergeBaseValidationErrorMessage ??
              "A merge base branch is required",
          );
          return;
        }
        onOpenChange(false);
        void onSquashMerge({
          mergeBaseBranch: selectedMergeBaseBranch,
        });
        break;
      case "squash_merge":
        if (selectedMergeBaseBranchClassificationPending) {
          return;
        }
        if (mergeBaseValidationErrorMessage || !selectedMergeBaseBranch) {
          setErrorMessage(
            mergeBaseValidationErrorMessage ??
              "A merge base branch is required",
          );
          return;
        }
        onOpenChange(false);
        void onSquashMerge({
          mergeBaseBranch: selectedMergeBaseBranch,
        });
        break;
      default:
        assertNever(target);
    }
  };

  return (
    <>
      <DialogHeader className="px-6 pt-5 pb-3">
        <DialogTitle>{dialogCopy.title}</DialogTitle>
        <DialogDescription>{dialogCopy.description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4 px-6 pt-1 pb-5" onSubmit={handleSubmit}>
        {branchName ||
        gitStatusDisplay ||
        canShowMergeBase ||
        shouldShowChangedFilesRow ? (
          <DetailCard appearance="flat">
            {branchName ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="GitBranch">
                    Branch
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0 truncate"
              >
                <span className="block truncate" title={branchName}>
                  {branchName}
                </span>
              </DetailRow>
            ) : null}
            {gitStatusDisplay ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="FileDiff">
                    Git status
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0"
              >
                <div
                  className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
                  title={`${gitStatusDisplay.label} ${gitStatusDisplay.summary}`.trim()}
                >
                  <span className="shrink-0 font-medium">
                    {gitStatusDisplay.label}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {gitStatusDisplay.summaryContent}
                  </span>
                </div>
              </DetailRow>
            ) : null}
            {canShowMergeBase && selectedMergeBaseBranch ? (
              <DetailRow
                label={
                  <DetailRowIconLabel icon="GitMerge">
                    Merge base
                  </DetailRowIconLabel>
                }
                valueClassName="min-w-0"
              >
                {canSelectMergeBase ? (
                  <BranchPicker
                    value={selectedMergeBaseBranch}
                    options={mergeBaseCandidates}
                    remoteOptions={remoteMergeBaseCandidates}
                    loading={mergeBaseBranchOptionsLoading}
                    onChange={(branch) => onMergeBaseBranchChange?.(branch)}
                    onSearchQueryChange={onMergeBaseBranchSearchQueryChange}
                    variant="minimal"
                    className="max-w-full"
                  />
                ) : (
                  <span
                    className="block truncate"
                    title={selectedMergeBaseBranch}
                  >
                    {selectedMergeBaseBranch}
                  </span>
                )}
              </DetailRow>
            ) : null}
            {shouldShowChangedFilesRow && changedFilesSection ? (
              <ChangedFilesDetailRow
                sections={[changedFilesSection]}
                rowClassName="mt-3"
                rowValueClassName="pt-0.5"
                listClassName="max-h-40"
              />
            ) : null}
          </DetailCard>
        ) : null}
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:space-x-0">
          {footerMergeBaseMessage ? (
            <p
              className={cn(
                "m-0 flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right text-xs leading-5",
                footerMergeBaseMessageIsError
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
              role={footerMergeBaseMessageIsError ? "alert" : "status"}
              aria-live={footerMergeBaseMessageIsError ? undefined : "polite"}
            >
              {footerMergeBaseMessageIsError ? null : (
                <Icon
                  name="Spinner"
                  className="size-3.5 shrink-0 animate-spin"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0">{footerMergeBaseMessage}</span>
            </p>
          ) : null}
          <Button
            type="submit"
            size="sm"
            className="shrink-0"
            disabled={
              dialogCopy.showMergeBase && mergeBaseSubmitBlockMessage !== null
            }
          >
            {dialogCopy.submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
