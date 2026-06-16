import { useCallback, useMemo, type ReactNode } from "react";
import { ThreadStorageBrowser } from "./ThreadStorageBrowser";
import type { ThreadStorageBrowserController } from "./useThreadStorageBrowser";
import { Link } from "react-router-dom";
import type {
  Environment,
  GitBranchRefClassification,
  PullRequestState,
  Thread,
  ThreadListEntry,
  ThreadPullRequest,
  WorkspaceCommitSummary,
  WorkspaceStatus,
} from "@bb/domain";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { cn } from "@/lib/utils";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { Button } from "@/components/ui/button.js";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { CopyableInlineLabel } from "@/components/ui/copy-button.js";
import { TruncatedList } from "@/components/ui/truncated-list.js";
import {
  DetailCard,
  DetailRow,
  DetailRowIconLabel,
} from "@/components/ui/detail-card.js";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chromeStyleTokens.js";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import { ChangedFilesDetailRow } from "@/components/workspace/ChangedFilesDetailRow";
import {
  selectWorkspaceAheadCommits,
  selectWorkspaceChangedFilesSections,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import { getGitStatusDisplay } from "@/components/workspace/workspace-status";
import { useUnarchiveThread } from "../../hooks/mutations/thread-state-mutations";
import { buildParentSelectorOptions } from "@/views/thread-detail/threadParentSelectorOptions";
import { getThreadRoutePath } from "@/lib/route-paths";

// ---------------------------------------------------------------------------
// Each row of the Info tab is a function component that owns its own raw
// inputs and derivation. ThreadMetadataContent is just a DetailCard wrapper
// that composes them. This shape lets per-row stories render exactly one row
// without bypassing the production rendering path.
// ---------------------------------------------------------------------------

export interface ParentSelectorRowProps {
  thread: Thread;
  projectId: string;
  parentThreadDisplayName: string | null;
  parentThreads: readonly ThreadListEntry[];
  canAssignToParent: boolean;
  canTakeOverThread: boolean;
  updateThreadPending: boolean;
  onAssignParent: (parentThreadId: string | null) => void;
  /** Force the assignment dropdown open on first render. Used by stories. */
  defaultOpen?: boolean;
}

export function ParentSelectorRow({
  thread,
  projectId,
  parentThreadDisplayName,
  parentThreads,
  canAssignToParent,
  canTakeOverThread,
  updateThreadPending,
  onAssignParent,
  defaultOpen,
}: ParentSelectorRowProps) {
  const parentThreadId = thread.parentThreadId ?? undefined;
  const parentSelectorOptions = useMemo(
    () =>
      buildParentSelectorOptions({
        currentThreadId: thread.id,
        parentThreads,
        parentThreadDisplayName,
        parentThreadId,
      }),
    [parentThreads, parentThreadDisplayName, parentThreadId, thread.id],
  );
  const parentSelectorValue = parentThreadId ?? "none";
  const selectedParentOptionLabel = parentSelectorOptions.find(
    (option) => option.value === parentSelectorValue,
  )?.label;

  if (!parentThreadId && !canAssignToParent && !canTakeOverThread) {
    return null;
  }

  return (
    <DetailRow
      label={<DetailRowIconLabel icon="UserRound">Parent</DetailRowIconLabel>}
      valueClassName="min-w-0"
    >
      {parentThreadId ? (
        <div
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-1 text-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <Link
            to={getThreadRoutePath({ projectId, threadId: parentThreadId })}
            className={cn(
              "min-w-0 truncate text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            {selectedParentOptionLabel ?? "Parent thread"}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_svg]:size-5"
            disabled={updateThreadPending}
            onClick={() => {
              onAssignParent(null);
            }}
            aria-label="Clear parent thread"
          >
            <Icon name="X" />
          </Button>
        </div>
      ) : (
        <DropdownMenu defaultOpen={defaultOpen}>
          <DropdownMenuTrigger asChild>
            <div
              role="button"
              tabIndex={
                updateThreadPending ||
                (parentSelectorOptions.length <= 1 &&
                  parentSelectorValue === "none")
                  ? -1
                  : 0
              }
              className={cn(
                "-mx-1 inline-flex h-5 w-fit max-w-full min-w-0 items-center gap-1 rounded-sm px-1 leading-tight text-foreground outline-none ring-sidebar-ring transition-colors hover:bg-state-hover data-[state=open]:bg-state-hover focus-visible:ring-2",
                COARSE_POINTER_TEXT_SM_CLASS,
              )}
            >
              <span
                className={cn(
                  "min-w-0 truncate text-foreground",
                  COARSE_POINTER_TEXT_SM_CLASS,
                )}
              >
                {selectedParentOptionLabel ?? "None"}
              </span>
              <Icon
                name="ChevronDown"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
                  "text-muted-foreground",
                )}
              />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40 max-w-72">
            <DropdownMenuLabel>Assign parent thread</DropdownMenuLabel>
            {parentSelectorOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => {
                  onAssignParent(option.value === "none" ? null : option.value);
                }}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate" title={option.label}>
                  {option.label}
                </span>
                <Icon
                  name="Check"
                  className={
                    parentSelectorValue === option.value
                      ? cn("opacity-100", COARSE_POINTER_ICON_SIZE_CLASS)
                      : cn("opacity-0", COARSE_POINTER_ICON_SIZE_CLASS)
                  }
                />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </DetailRow>
  );
}

export interface EnvironmentRowProps {
  thread: Thread;
  environment: Environment | null;
  environmentDisplayHost: EnvironmentDisplayHostContext;
}

// Reflect the actual environment: a managed (cloud) worktree, a local git
// worktree, or working directly in the local checkout.
function environmentRowIcon(environment: Environment): IconName {
  if (environment.workspaceProvisionType === "managed-worktree") {
    return "Container";
  }
  if (environment.isWorktree) {
    return "FolderOpen";
  }
  return "Laptop";
}

export function EnvironmentRow({
  thread,
  environment,
  environmentDisplayHost,
}: EnvironmentRowProps) {
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId: thread.projectId,
    environmentId: environment?.id ?? "",
  });
  if (!environment) return null;
  const display = formatEnvironmentDisplay({
    environment,
    host: environmentDisplayHost,
  });
  const showCreateThreadButton =
    isProvisionedWorktreeEnvironment(environment);
  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon={environmentRowIcon(environment)}>
          Environment
        </DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate">{display.modeLabel}</span>
        {showCreateThreadButton ? (
          <button
            type="button"
            aria-label="Create new thread in this worktree"
            title="New thread in this worktree"
            onClick={createThreadInWorktree}
            className="inline-flex shrink-0 items-center justify-center rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="MessageSquarePlus" className="size-4" />
          </button>
        ) : null}
      </span>
    </DetailRow>
  );
}

export interface WorkspacePathRowProps {
  thread: Thread;
  environment: Environment | null;
}

interface WorkspacePathRowDisplay {
  rowLabel: string;
  copyLabel: string;
  successMessage: string;
  errorMessage: string;
}

function isWorktreeEnvironment(environment: Environment): boolean {
  return (
    environment.isWorktree ||
    environment.workspaceProvisionType === "managed-worktree"
  );
}

function isProvisionedWorktreeEnvironment(environment: Environment): boolean {
  return (
    environment.status === "ready" &&
    environment.path !== null &&
    isWorktreeEnvironment(environment)
  );
}

function getWorkspacePathRowDisplay(
  environment: Environment,
): WorkspacePathRowDisplay | null {
  if (environment.workspaceProvisionType === "personal") {
    return {
      rowLabel: "Workspace path",
      copyLabel: "Copy workspace path",
      successMessage: "Workspace path copied",
      errorMessage: "Failed to copy workspace path",
    };
  }

  if (isWorktreeEnvironment(environment)) {
    return {
      rowLabel: "Worktree path",
      copyLabel: "Copy worktree path",
      successMessage: "Worktree path copied",
      errorMessage: "Failed to copy worktree path",
    };
  }

  return null;
}

export function WorkspacePathRow({
  thread,
  environment,
}: WorkspacePathRowProps) {
  if (!environment?.path) return null;
  const display = getWorkspacePathRowDisplay(environment);
  if (!display) return null;

  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="FolderGit">
          {display.rowLabel}
        </DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
      <CopyableInlineLabel
        text={environment.path}
        label={display.copyLabel}
        title={environment.path}
        successMessage={display.successMessage}
        errorMessage={display.errorMessage}
      />
    </DetailRow>
  );
}

export interface BranchRowProps {
  thread: Thread;
  workspaceStatus: WorkspaceStatus | undefined;
}

export function BranchRow({ thread, workspaceStatus }: BranchRowProps) {
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
        <CopyableInlineLabel
          text={checkoutDisplay.copyValue}
          label={checkoutDisplay.copyLabel ?? "Copy checkout value"}
          title={checkoutDisplay.title}
          successMessage={checkoutDisplay.copySuccessMessage ?? "Value copied"}
          errorMessage={
            checkoutDisplay.copyErrorMessage ?? "Failed to copy value"
          }
        >
          {checkoutDisplay.label}
        </CopyableInlineLabel>
      ) : (
        <span className="block truncate" title={checkoutDisplay.title}>
          {checkoutDisplay.label}
        </span>
      )}
    </DetailRow>
  );
}

interface PullRequestStateDisplay {
  label: string;
  /** Background utility for the leading state dot. */
  dotClass: string;
}

const PULL_REQUEST_STATE_DISPLAY: Record<
  PullRequestState,
  PullRequestStateDisplay
> = {
  open: { label: "Open", dotClass: "bg-success" },
  draft: { label: "Draft", dotClass: "bg-muted-foreground" },
  merged: { label: "Merged", dotClass: "bg-pr-merged" },
  closed: { label: "Closed", dotClass: "bg-destructive" },
};

export interface PullRequestRowProps {
  pullRequest: ThreadPullRequest | null;
}

export function PullRequestRow({ pullRequest }: PullRequestRowProps) {
  if (!pullRequest) return null;
  const stateDisplay = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="GitMerge">Pull request</DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noopener noreferrer"
        title={pullRequest.title}
        className="inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2"
      >
        <span className="shrink-0">PR #{pullRequest.number}</span>
        <span className="shrink-0 text-muted-foreground">·</span>
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            stateDisplay.dotClass,
          )}
        />
        <span className="min-w-0 truncate">{stateDisplay.label}</span>
        <Icon
          name="ExternalLink"
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground"
        />
      </a>
    </DetailRow>
  );
}

export interface MergeBaseRowProps {
  thread: Thread;
  workspaceStatus: WorkspaceStatus | undefined;
  selectedMergeBaseBranch: string | undefined;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions: readonly string[] | undefined;
  mergeBaseRemoteBranchOptions?: readonly string[];
  isLoadingMergeBaseBranchOptions: boolean;
  onMergeBaseBranchChange: (branch: string) => void;
  onMergeBasePickerOpenChange?: (open: boolean) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  /** Force the BranchPicker popover open on first render. Used by stories. */
  defaultOpen?: boolean;
}

export function MergeBaseRow({
  thread,
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
  const effectiveMergeBaseBranch =
    selectedMergeBaseBranch ??
    workspaceStatus?.mergeBase?.mergeBaseBranch ??
    workspaceStatus?.branch.defaultBranch;
  const mergeBaseBranch = effectiveMergeBaseBranch;
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
  const showBranchComparisonUi = Boolean(
    effectiveMergeBaseBranch || workspaceStatus?.branch.defaultBranch,
  );
  const isOnDefaultBranch =
    workspaceStatus?.branch.currentBranch != null &&
    workspaceStatus.branch.currentBranch ===
      workspaceStatus.branch.defaultBranch;
  const showMergeBase =
    showBranchComparisonUi && Boolean(mergeBaseBranch) && !isOnDefaultBranch;
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
          selectedOptionKind={mergeBaseCandidateGroups.selectedOptionKind}
          variant="minimal"
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
        mergeBaseBranch
      )}
    </DetailRow>
  );
}

export interface GitStatusRowProps {
  thread: Thread;
  environment: Environment | null;
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceStatusError: Error | null;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  selectedMergeBaseBranch: string | undefined;
}

export function GitStatusRow({
  thread,
  environment,
  workspaceStatus,
  workspaceStatusError,
  workspaceUnavailable,
  selectedMergeBaseBranch,
}: GitStatusRowProps) {
  const isWorkspaceDeleted = environment?.status === "destroyed";
  const showWorkspaceStatus =
    (Boolean(workspaceStatus) ||
      Boolean(workspaceStatusError) ||
      Boolean(workspaceUnavailable) ||
      isWorkspaceDeleted) &&
    !(thread.archivedAt != null && environment?.managed !== true);
  if (!showWorkspaceStatus) return null;

  const effectiveMergeBaseBranch =
    selectedMergeBaseBranch ??
    workspaceStatus?.mergeBase?.mergeBaseBranch ??
    workspaceStatus?.branch.defaultBranch;
  const showBranchComparisonUi = Boolean(
    effectiveMergeBaseBranch || workspaceStatus?.branch.defaultBranch,
  );
  const display = getGitStatusDisplay(workspaceStatus, {
    mergeBaseBranch: effectiveMergeBaseBranch,
    showBranchComparison: showBranchComparisonUi,
    error: workspaceStatusError,
    workspaceUnavailable,
    workspaceDeleted: isWorkspaceDeleted,
  });
  // Dirty reads as the timeline error color — the one actionable state. Every
  // other status, including a clean "Up to date" tree, stays neutral: the
  // expected state shouldn't spend color drawing the eye.
  const labelClass =
    display.label === "Dirty" ? "text-destructive" : "text-foreground";

  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="FileDiff">Git status</DetailRowIconLabel>
      }
      align="start"
      valueClassName="min-w-0"
    >
      <div
        className="flex min-w-0 items-end gap-2 whitespace-nowrap"
        title={`${display.label} ${display.summary}`}
      >
        <span className={cn("shrink-0 font-medium", labelClass)}>
          {display.label}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">
          {display.summaryContent}
        </span>
      </div>
    </DetailRow>
  );
}

export interface ArchivedRowProps {
  thread: Thread;
}

export function ArchivedRow({ thread }: ArchivedRowProps) {
  const unarchiveThread = useUnarchiveThread();
  const isPending =
    unarchiveThread.isPending && unarchiveThread.variables?.id === thread.id;
  const onUnarchive = useCallback(() => {
    unarchiveThread.mutate({ id: thread.id });
  }, [thread.id, unarchiveThread]);
  if (thread.archivedAt == null) return null;
  return (
    <DetailRow label="Archived" valueClassName="min-w-0 truncate">
      <ThreadUnarchiveButton isPending={isPending} onUnarchive={onUnarchive} />
    </DetailRow>
  );
}

export interface ThreadCommitsRowProps {
  workspaceStatus: WorkspaceStatus | undefined;
  /** When provided, each commit becomes a button that opens its diff. */
  onCommitClick?: (sha: string) => void;
}

interface ThreadCommitListItemProps {
  commit: WorkspaceCommitSummary;
  onCommitClick?: (sha: string) => void;
}

function ThreadCommitListItem({
  commit,
  onCommitClick,
}: ThreadCommitListItemProps) {
  const detail = (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-readback-foreground underline-offset-2 group-hover:underline">
        {commit.subject}
      </span>
      <span className="shrink-0 font-mono text-subtle-foreground">
        {commit.shortSha}
      </span>
    </div>
  );
  if (!onCommitClick) {
    return detail;
  }
  return (
    <button
      type="button"
      onClick={() => onCommitClick(commit.sha)}
      title={commit.subject}
      className="group block w-full text-left"
    >
      {detail}
    </button>
  );
}

export function ThreadCommitsRow({
  workspaceStatus,
  onCommitClick,
}: ThreadCommitsRowProps) {
  const commits = selectWorkspaceAheadCommits(workspaceStatus);
  if (commits.length === 0) return null;
  return (
    <>
      {/* Divider separating the key/value metadata above from the Commits
          section. Lives inside this row so it only renders when there are
          commits to show. */}
      <div className="mb-1 mt-3 border-t border-border" aria-hidden />
      <DetailRow
        label="Commits"
        orientation="vertical"
        labelClassName={CHROME_SECTION_LABEL_CLASS}
        valueClassName="min-w-0"
      >
        <TruncatedList
          items={commits}
          getKey={(commit) => commit.sha}
          renderItem={(commit) => (
            <ThreadCommitListItem
              commit={commit}
              onCommitClick={onCommitClick}
            />
          )}
        />
      </DetailRow>
    </>
  );
}

export interface ChangedFilesRowProps {
  thread: Thread;
  workspaceStatus: WorkspaceStatus | undefined;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
}

export function ChangedFilesRow({
  thread,
  workspaceStatus,
  onChangedFileClick,
}: ChangedFilesRowProps) {
  return (
    <ChangedFilesDetailRow
      sections={selectWorkspaceChangedFilesSections(workspaceStatus)}
      onFileClick={onChangedFileClick}
      labelClassName={CHROME_SECTION_LABEL_CLASS}
      rowClassName="mt-3"
      limit={5}
    />
  );
}

export interface ThreadStorageRowProps {
  controller: ThreadStorageBrowserController;
  filesError?: Error | null;
  isFilesLoading: boolean;
}

export function ThreadStorageRow({
  controller,
  filesError,
  isFilesLoading,
}: ThreadStorageRowProps) {
  const { isSearchOpen, openSearch } = controller;
  // Render nothing when there is no content to show. With no files there is
  // nothing to browse, so the row would otherwise sit as an empty "No files yet."
  // box competing for panel height. Stay visible on error so load failures still
  // surface.
  if (controller.loadedFiles.length === 0 && filesError == null) {
    return null;
  }
  return (
    <DetailRow
      orientation="vertical"
      className="mt-3 min-h-32 flex-1"
      valueClassName="min-h-0 flex-1 overflow-hidden"
      labelClassName="flex items-center justify-between gap-2"
      label={
        <>
          <span>Thread storage</span>
          {isSearchOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "shrink-0 text-muted-foreground",
              )}
              aria-label="Search files"
              onClick={openSearch}
            >
              <Icon name="Search" />
            </Button>
          )}
        </>
      }
    >
      <ThreadStorageBrowser
        controller={controller}
        filesError={filesError}
        isFilesLoading={isFilesLoading}
      />
    </DetailRow>
  );
}

// ---------------------------------------------------------------------------
// Composition + helper
// ---------------------------------------------------------------------------

export interface ThreadMetadataContentProps {
  thread: Thread;
  projectId: string;
  parentThreadDisplayName: string | null;
  parentThreads: readonly ThreadListEntry[];
  canAssignToParent: boolean;
  canTakeOverThread: boolean;
  environment: Environment | null;
  environmentDisplayHost: EnvironmentDisplayHostContext;
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceStatusError: Error | null;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  pullRequest: ThreadPullRequest | null;
  selectedMergeBaseBranch: string | undefined;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions: readonly string[] | undefined;
  mergeBaseRemoteBranchOptions?: readonly string[];
  isLoadingMergeBaseBranchOptions: boolean;
  updateThreadPending: boolean;
  storage?: ThreadStorageRowProps;
  onAssignParent: (parentThreadId: string | null) => void;
  onMergeBaseBranchChange: (branch: string) => void;
  onMergeBasePickerOpenChange?: (open: boolean) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onCommitClick?: (sha: string) => void;
}

/**
 * Returns true when the rendered card would have at least one row to show.
 * The caller can use this to decide between rendering the card and rendering
 * its "no thread details available" fallback.
 */
export function hasAnyThreadMetadata({
  thread,
  parentThreadDisplayName,
  environment,
  workspaceStatus,
  workspaceStatusError,
  workspaceUnavailable,
  pullRequest,
}: Pick<
  ThreadMetadataContentProps,
  | "thread"
  | "parentThreadDisplayName"
  | "environment"
  | "workspaceStatus"
  | "workspaceStatusError"
  | "workspaceUnavailable"
  | "pullRequest"
>): boolean {
  const parentThreadId = thread.parentThreadId ?? undefined;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  const showWorkspaceStatus =
    (Boolean(workspaceStatus) ||
      Boolean(workspaceStatusError) ||
      Boolean(workspaceUnavailable) ||
      isWorkspaceDeleted) &&
    !(thread.archivedAt != null && environment?.managed !== true);
  const branchName = workspaceStatus?.branch.currentBranch ?? null;
  const workspaceChangedFilesSections =
    selectWorkspaceChangedFilesSections(workspaceStatus);
  const showThreadChangedFiles = workspaceChangedFilesSections.length > 0;

  return Boolean(
    parentThreadId ||
    environment ||
    branchName ||
    pullRequest ||
    showWorkspaceStatus ||
    showThreadChangedFiles ||
    thread.archivedAt != null ||
    (parentThreadDisplayName && parentThreadId),
  );
}

interface DetailCardWrapperProps {
  children: ReactNode;
}

/**
 * Shared DetailCard styling used by ThreadMetadataContent and the per-row
 * stories so a single row in isolation looks the same as it does inside the
 * full panel. Owns the info tab's vertical scroll as a last resort: when
 * everything fits there is no scrolling at all. Changed files sizes to its
 * content; thread storage fills the leftover space (its virtualized tree has no
 * intrinsic height to size to). When the two together run out of room they
 * shrink and scroll internally — storage down to a usable min-height — so the
 * card itself only scrolls once those minimums no longer fit.
 */
export function ThreadMetadataCard({ children }: DetailCardWrapperProps) {
  return (
    <DetailCard
      appearance="flat"
      className="min-h-0 flex-1 gap-1.5 overflow-x-hidden overflow-y-auto bg-surface-raised px-4 py-3"
    >
      {children}
    </DetailCard>
  );
}

export function ThreadMetadataContent(props: ThreadMetadataContentProps) {
  const {
    thread,
    projectId,
    parentThreadDisplayName,
    parentThreads,
    canAssignToParent,
    canTakeOverThread,
    environment,
    environmentDisplayHost,
    workspaceStatus,
    workspaceStatusError,
    workspaceUnavailable,
    pullRequest,
    selectedMergeBaseBranch,
    mergeBaseBranchRef,
    mergeBaseBranchOptions,
    mergeBaseRemoteBranchOptions,
    isLoadingMergeBaseBranchOptions,
    updateThreadPending,
    storage,
    onAssignParent,
    onMergeBaseBranchChange,
    onMergeBasePickerOpenChange,
    onMergeBaseBranchSearchQueryChange,
    onChangedFileClick,
    onCommitClick,
  } = props;

  return (
    <ThreadMetadataCard>
      <ParentSelectorRow
        thread={thread}
        projectId={projectId}
        parentThreadDisplayName={parentThreadDisplayName}
        parentThreads={parentThreads}
        canAssignToParent={canAssignToParent}
        canTakeOverThread={canTakeOverThread}
        updateThreadPending={updateThreadPending}
        onAssignParent={onAssignParent}
      />
      <EnvironmentRow
        thread={thread}
        environment={environment}
        environmentDisplayHost={environmentDisplayHost}
      />
      <WorkspacePathRow thread={thread} environment={environment} />
      <BranchRow thread={thread} workspaceStatus={workspaceStatus} />
      <MergeBaseRow
        thread={thread}
        workspaceStatus={workspaceStatus}
        selectedMergeBaseBranch={selectedMergeBaseBranch}
        mergeBaseBranchRef={mergeBaseBranchRef}
        mergeBaseBranchOptions={mergeBaseBranchOptions}
        mergeBaseRemoteBranchOptions={mergeBaseRemoteBranchOptions}
        isLoadingMergeBaseBranchOptions={isLoadingMergeBaseBranchOptions}
        onMergeBaseBranchChange={onMergeBaseBranchChange}
        onMergeBasePickerOpenChange={onMergeBasePickerOpenChange}
        onMergeBaseBranchSearchQueryChange={onMergeBaseBranchSearchQueryChange}
      />
      <GitStatusRow
        thread={thread}
        environment={environment}
        workspaceStatus={workspaceStatus}
        workspaceStatusError={workspaceStatusError}
        workspaceUnavailable={workspaceUnavailable}
        selectedMergeBaseBranch={selectedMergeBaseBranch}
      />
      <PullRequestRow pullRequest={pullRequest} />
      <ArchivedRow thread={thread} />
      <ThreadCommitsRow
        workspaceStatus={workspaceStatus}
        onCommitClick={onCommitClick}
      />
      <ChangedFilesRow
        thread={thread}
        workspaceStatus={workspaceStatus}
        onChangedFileClick={onChangedFileClick}
      />
      {storage ? <ThreadStorageRow {...storage} /> : null}
    </ThreadMetadataCard>
  );
}
