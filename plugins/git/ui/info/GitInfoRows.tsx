import { useMemo } from "react";
import {
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { BranchPicker } from "@bb/shared-ui/branch-picker";
import { CopyableInlineLabelView } from "@bb/shared-ui/copy-button";
import { useSdkClipboardCopy } from "@bb/shared-ui/sdk-clipboard-copy";
import {
  getGitStatusDisplay,
  SquashMergeInfo,
} from "@bb/shared-ui/git-status-display";
import { Icon } from "@bb/shared-ui/icon";
import {
  getMergeBaseBranchCandidateGroups,
} from "../merge-base-branch-candidates";
import {
  formatWorkspaceCheckoutDisplay,
} from "@bb/shared-ui/lib/workspace-checkout-display";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  useMergeBase,
  type MergeBaseState,
} from "../merge-base.js";
import { useGitStatus } from "../queries.js";
import type {
  WorkspaceResolutionFailure,
} from "bb-environment-provider-host/git-types";
import type { WorkspaceStatus } from "../../contract.js";

function CopyableValue({
  text,
  label,
  title,
  successMessage,
  errorMessage,
  children,
}: {
  text: string;
  label: string;
  title: string;
  successMessage: string;
  errorMessage: string;
  children: string;
}) {
  const { copied, copy } = useSdkClipboardCopy({
    text,
    successMessage,
    errorMessage,
  });
  return (
    <CopyableInlineLabelView
      text={text}
      label={label}
      title={title}
      copied={copied}
      onCopy={() => void copy()}
    >
      {children}
    </CopyableInlineLabelView>
  );
}

export function BranchInfoRow({ environment }: ExperimentalThreadInfoProps) {
  const { workspace } = useGitStatus(environment?.id ?? null);
  return workspace === undefined ? null : <BranchRowView workspace={workspace} />;
}

export function BranchRowView({ workspace }: { workspace: WorkspaceStatus }) {
  const display = formatWorkspaceCheckoutDisplay({
    checkout: workspace.checkout,
  });
  return (
    <DetailRow icon="GitBranch" label={display.rowLabel}>
      {display.copyValue !== null ? (
        <span className="block truncate">
          <CopyableValue
            text={display.copyValue}
            label={display.copyLabel ?? "Copy checkout value"}
            title={display.title}
            successMessage={display.copySuccessMessage ?? "Value copied"}
            errorMessage={display.copyErrorMessage ?? "Failed to copy value"}
          >
            {display.label}
          </CopyableValue>
        </span>
      ) : (
        <span className="block truncate" title={display.title}>
          {display.label}
        </span>
      )}
    </DetailRow>
  );
}

export function MergeBaseInfoRow({ environment }: ExperimentalThreadInfoProps) {
  const environmentId = environment?.id ?? null;
  const { workspace } = useGitStatus(environmentId);
  const mergeBase = useMergeBase(environmentId, workspace);
  return <MergeBaseRowView workspace={workspace} mergeBase={mergeBase} />;
}

export function MergeBaseRowView({
  workspace,
  mergeBase,
  defaultOpen,
}: {
  workspace: WorkspaceStatus | undefined;
  mergeBase: MergeBaseState;
  defaultOpen?: boolean;
}) {
  const displayedBranch =
    mergeBase.effectiveMergeBaseBranch ?? workspace?.branch.defaultBranch;
  const candidates = useMemo(
    () =>
      getMergeBaseBranchCandidateGroups({
        mergeBaseBranch: displayedBranch,
        mergeBaseBranchRef: mergeBase.selectedBranchRef,
        mergeBaseBranchOptions: mergeBase.options,
        remoteMergeBaseBranchOptions: mergeBase.remoteOptions,
      }),
    [
      displayedBranch,
      mergeBase.options,
      mergeBase.remoteOptions,
      mergeBase.selectedBranchRef,
    ],
  );
  const isOnDefaultBranch =
    workspace?.branch.currentBranch != null &&
    workspace.branch.currentBranch === workspace.branch.defaultBranch;
  if (!displayedBranch || isOnDefaultBranch) return null;
  const canRequestOptions = !mergeBase.optionsLoaded;
  const canSelect =
    canRequestOptions ||
    mergeBase.optionsLoading ||
    candidates.options.length > 0 ||
    candidates.remoteOptions.length > 0;
  return (
    <DetailRow icon="GitMerge" label="Merge base">
      {canSelect ? (
        <BranchPicker
          value={displayedBranch}
          options={candidates.options}
          remoteOptions={candidates.remoteOptions}
          variant="minimal"
          emphasizeTriggerValue={false}
          loading={mergeBase.optionsLoading || canRequestOptions}
          onChange={mergeBase.onChange}
          onOpenChange={mergeBase.onPickerOpenChange}
          onSearchQueryChange={mergeBase.onSearchQueryChange}
          defaultOpen={defaultOpen}
          className="max-w-full"
        />
      ) : (
        <span className="min-w-0 truncate">{displayedBranch}</span>
      )}
    </DetailRow>
  );
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

export function GitStatusInfoRow(props: ExperimentalThreadInfoProps) {
  const { workspace, failure, errorMessage } = useGitStatus(
    props.environment?.id ?? null,
  );
  return (
    <GitStatusRowView
      workspace={workspace}
      failure={failure}
      errorMessage={errorMessage}
    />
  );
}

export function GitStatusRowView({
  workspace,
  failure,
  errorMessage,
}: {
  workspace: WorkspaceStatus | undefined;
  failure: WorkspaceResolutionFailure | undefined;
  errorMessage: string | null;
}) {
  if (
    workspace === undefined &&
    failure === undefined &&
    errorMessage === null
  ) {
    return null;
  }
  if (workspace !== undefined) {
    const mergeBase = workspace.mergeBase;
    if (!mergeBase?.mergeBaseBranch) return null;
    const refreshFailure = errorMessage
      ? `Couldn't refresh: ${getGitStatusDisplay(undefined, {
          errorMessage,
        }).summary.replace(/\.$/, "")}. Showing the last known status.`
      : null;
    return (
      <DetailRow icon="FileDiff" label="Git status">
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
          {!mergeBase.squashMergeCheckComplete ? <SquashMergeInfo /> : null}
        </span>
      </DetailRow>
    );
  }
  const display = getGitStatusDisplay(undefined, {
    errorMessage,
    ...(failure === undefined ? {} : { workspaceUnavailable: failure }),
  });
  return (
    <DetailRow icon="FileDiff" label="Git status" align="start">
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
