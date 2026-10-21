import { useMemo } from "react";
import type {
  Environment,
  Thread,
  GitBranchRefClassification,
} from "@bb/domain";
import type { WorkspaceStatus } from "bb-git-contract";
import type { WorkspaceResolutionFailure } from "bb-git-contract";
import { experimental_CopyButton as CopyButton } from "@get-bb/plugin-sdk/app";
import { DetailRow, DetailRowIconLabel } from "@bb/shared-ui/detail-card";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@bb/shared-ui/branch-picker";
import { formatWorkspaceCheckoutDisplay } from "./workspace-checkout-display.js";
import { getGitStatusDisplay } from "./workspace-status.js";

interface BranchRowProps {
  workspaceStatus: WorkspaceStatus | undefined;
}

export function BranchRow({ workspaceStatus }: BranchRowProps) {
  const checkoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : null;
  if (checkoutDisplay === null) return null;
  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="GitBranch">
          {checkoutDisplay.rowLabel}
        </DetailRowIconLabel>
      }
      valueClassName="min-w-0 truncate"
    >
      {checkoutDisplay.copyValue !== null ? (
        <CopyButton
          text={checkoutDisplay.copyValue}
          label={checkoutDisplay.copyLabel ?? "Copy checkout value"}
          experimental_inlineLabel={{ title: checkoutDisplay.title }}
          successMessage={checkoutDisplay.copySuccessMessage ?? "Value copied"}
          errorMessage={
            checkoutDisplay.copyErrorMessage ?? "Failed to copy value"
          }
        >
          {checkoutDisplay.label}
        </CopyButton>
      ) : (
        <span className="block truncate" title={checkoutDisplay.title}>
          {checkoutDisplay.label}
        </span>
      )}
    </DetailRow>
  );
}

function resolveDisplayedMergeBaseBranch(
  selectedMergeBaseBranch: string | undefined,
  workspaceStatus: WorkspaceStatus | undefined,
): string | undefined {
  return (
    selectedMergeBaseBranch ??
    workspaceStatus?.mergeBase?.mergeBaseBranch ??
    workspaceStatus?.branch.defaultBranch
  );
}

function shouldShowWorkspaceStatus({
  thread,
  environment,
  workspaceStatus,
  workspaceStatusError,
  workspaceUnavailable,
}: Pick<
  GitStatusRowProps,
  | "thread"
  | "environment"
  | "workspaceStatus"
  | "workspaceStatusError"
  | "workspaceUnavailable"
>): boolean {
  return (
    (Boolean(workspaceStatus) ||
      Boolean(workspaceStatusError) ||
      Boolean(workspaceUnavailable) ||
      environment?.status === "destroyed") &&
    !(thread.archivedAt != null && environment?.managed !== true)
  );
}

interface MergeBaseRowProps {
  workspaceStatus: WorkspaceStatus | undefined;
  selectedMergeBaseBranch: string | undefined;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions: readonly string[] | undefined;
  mergeBaseRemoteBranchOptions?: readonly string[];
  isLoadingMergeBaseBranchOptions: boolean;
  onMergeBaseBranchChange: (branch: string) => void;
  onMergeBasePickerOpenChange?: (open: boolean) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  defaultOpen?: boolean;
}

export function formatBranchComparison({
  aheadCount,
  behindCount,
  baseBranch,
}: {
  aheadCount: number;
  behindCount: number;
  baseBranch: string;
}): string {
  if (aheadCount > 0 && behindCount > 0) {
    return `${aheadCount} ahead, ${behindCount} behind ${baseBranch}`;
  }
  if (aheadCount > 0) return `${aheadCount} ahead of ${baseBranch}`;
  if (behindCount > 0) return `${behindCount} behind ${baseBranch}`;
  return `Even with ${baseBranch}`;
}

export function MergeBaseRow({
  workspaceStatus,
  selectedMergeBaseBranch,
  mergeBaseBranchRef,
  mergeBaseBranchOptions,
  mergeBaseRemoteBranchOptions,
  isLoadingMergeBaseBranchOptions,
  onMergeBaseBranchChange,
  onMergeBasePickerOpenChange,
  onMergeBaseBranchSearchQueryChange,
  defaultOpen,
}: MergeBaseRowProps) {
  const mergeBaseBranch = resolveDisplayedMergeBaseBranch(
    selectedMergeBaseBranch,
    workspaceStatus,
  );
  const mergeBaseCandidateGroups = useMemo(
    () =>
      getMergeBaseBranchCandidateGroups({
        mergeBaseBranch,
        mergeBaseBranchRef,
        mergeBaseBranchOptions,
        remoteMergeBaseBranchOptions: mergeBaseRemoteBranchOptions,
      }),
    [
      mergeBaseBranch,
      mergeBaseBranchOptions,
      mergeBaseBranchRef,
      mergeBaseRemoteBranchOptions,
    ],
  );
  const mergeBaseCandidates = mergeBaseCandidateGroups.options;
  const remoteMergeBaseCandidates = mergeBaseCandidateGroups.remoteOptions;
  const isOnDefaultBranch =
    workspaceStatus?.branch.currentBranch != null &&
    workspaceStatus.branch.currentBranch ===
      workspaceStatus.branch.defaultBranch;
  const showMergeBase = Boolean(mergeBaseBranch) && !isOnDefaultBranch;
  if (!showMergeBase) return null;
  const canRequestMergeBaseOptions =
    mergeBaseBranchOptions === undefined &&
    onMergeBasePickerOpenChange !== undefined;
  const canSelectMergeBase = Boolean(
    mergeBaseBranch &&
    (canRequestMergeBaseOptions ||
      isLoadingMergeBaseBranchOptions ||
      mergeBaseCandidates.length > 0 ||
      remoteMergeBaseCandidates.length > 0),
  );

  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="GitMerge">Merge base</DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
      {canSelectMergeBase && mergeBaseBranch ? (
        <BranchPicker
          value={mergeBaseBranch}
          options={mergeBaseCandidates}
          remoteOptions={remoteMergeBaseCandidates}
          variant="minimal"
          emphasizeTriggerValue={false}
          loading={
            isLoadingMergeBaseBranchOptions || canRequestMergeBaseOptions
          }
          onChange={onMergeBaseBranchChange}
          onOpenChange={onMergeBasePickerOpenChange}
          onSearchQueryChange={onMergeBaseBranchSearchQueryChange}
          className="max-w-full"
          defaultOpen={defaultOpen}
        />
      ) : (
        <span className="min-w-0 truncate">{mergeBaseBranch}</span>
      )}
    </DetailRow>
  );
}

interface GitStatusRowProps {
  thread: Pick<Thread, "archivedAt">;
  environment: Environment | null;
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceStatusError: Error | null;
  workspaceUnavailable?: WorkspaceResolutionFailure;
}

export function GitStatusRow({
  thread,
  environment,
  workspaceStatus,
  workspaceStatusError,
  workspaceUnavailable,
}: GitStatusRowProps) {
  if (
    !shouldShowWorkspaceStatus({
      thread,
      environment,
      workspaceStatus,
      workspaceStatusError,
      workspaceUnavailable,
    })
  ) {
    return null;
  }
  if (workspaceStatus) {
    const mergeBase = workspaceStatus.mergeBase;
    if (!mergeBase?.mergeBaseBranch) return null;
    const refreshFailure = workspaceStatusError
      ? `Couldn't refresh: ${getGitStatusDisplay(undefined, {
          error: workspaceStatusError,
        }).summary.replace(/\.$/, "")}. Showing the last known status.`
      : null;
    return (
      <DetailRow
        label={
          <DetailRowIconLabel icon="FileDiff">Git status</DetailRowIconLabel>
        }
        valueClassName="min-w-0"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 truncate text-foreground">
            {formatBranchComparison({
              aheadCount: mergeBase.aheadCount,
              behindCount: mergeBase.behindCount,
              baseBranch: mergeBase.mergeBaseBranch,
            })}
          </span>
          {refreshFailure ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="img"
                  aria-label={refreshFailure}
                  className="flex shrink-0 items-center"
                >
                  <Icon
                    name="AlertTriangle"
                    className="size-3 text-warning"
                    aria-hidden
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{refreshFailure}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </DetailRow>
    );
  }

  const display = getGitStatusDisplay(undefined, {
    error: workspaceStatusError,
    workspaceUnavailable,
    workspaceDeleted: environment?.status === "destroyed",
  });
  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="FileDiff">Git status</DetailRowIconLabel>
      }
      align="start"
      valueClassName="min-w-0"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Icon
          name="AlertTriangle"
          className="size-3 shrink-0 text-warning"
          aria-hidden
        />
        <span
          className="min-w-0 truncate text-foreground"
          title={display.summary}
        >
          {display.summary.replace(/\.$/, "")}
        </span>
      </span>
    </DetailRow>
  );
}
