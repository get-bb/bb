import { useCallback, useMemo, type ReactNode } from "react";
import { ManagerThreadStorageBrowser } from "./ManagerThreadStorageBrowser";
import type { ManagerStorageBrowserController } from "./useManagerStorageBrowser";
import { Link } from "react-router-dom";
import type {
  Environment,
  GitBranchRefClassification,
  PullRequestState,
  Thread,
  ThreadListEntry,
  ThreadPullRequest,
  WorkspaceStatus,
} from "@bb/domain";
import type { ThreadSchedule } from "@bb/server-contract";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract";
import { formatEnvironmentDisplay } from "@bb/core-ui";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button.js";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { CopyableInlineLabel } from "@/components/ui/copy-button.js";
import { DetailCard, DetailRow } from "@/components/ui/detail-card.js";
import {
  formatCronCadence,
  formatScheduleStatusLabel,
} from "@/lib/format-schedule";
import { useCreateThreadInWorktree } from "@/hooks/useCreateThreadInWorktree";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import { TruncatedList } from "@/components/ui/truncated-list.js";
import { ChangedFilesDetailRow } from "@/components/workspace/ChangedFilesDetailRow";
import {
  selectWorkspaceChangedFilesSections,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import { getGitStatusDisplay } from "@/components/workspace/workspace-status";
import { useUnarchiveThread } from "../../hooks/mutations/thread-state-mutations";
import { buildManagerSelectorOptions } from "@/views/thread-detail/threadManagerSelectorOptions";
import { getThreadRoutePath } from "@/lib/app-route-paths";

// ---------------------------------------------------------------------------
// Each row of the Info tab is a function component that owns its own raw
// inputs and derivation. ThreadMetadataContent is just a DetailCard wrapper
// that composes them. This shape lets per-row stories render exactly one row
// without bypassing the production rendering path.
// ---------------------------------------------------------------------------

export interface ManagerSelectorRowProps {
  thread: Thread;
  projectId: string;
  parentThreadDisplayName: string | null;
  managerThreads: readonly ThreadListEntry[];
  canAssignToManager: boolean;
  canTakeOverThread: boolean;
  updateThreadPending: boolean;
  onAssignManager: (parentThreadId: string | null) => void;
  /** Force the assignment dropdown open on first render. Used by stories. */
  defaultOpen?: boolean;
}

export function ManagerSelectorRow({
  thread,
  projectId,
  parentThreadDisplayName,
  managerThreads,
  canAssignToManager,
  canTakeOverThread,
  updateThreadPending,
  onAssignManager,
  defaultOpen,
}: ManagerSelectorRowProps) {
  const isManagerThread = thread.type === "manager";
  const parentThreadId = thread.parentThreadId ?? undefined;
  const managerSelectorOptions = useMemo(
    () =>
      buildManagerSelectorOptions({
        currentThreadId: thread.id,
        isManagerThread,
        managerThreads,
        parentThreadDisplayName,
        parentThreadId,
      }),
    [
      isManagerThread,
      managerThreads,
      parentThreadDisplayName,
      parentThreadId,
      thread.id,
    ],
  );
  const managerSelectorValue = parentThreadId ?? "none";
  const selectedManagerOptionLabel = managerSelectorOptions.find(
    (option) => option.value === managerSelectorValue,
  )?.label;

  if (isManagerThread) return null;
  if (!parentThreadId && !canAssignToManager && !canTakeOverThread) {
    return null;
  }

  return (
    <DetailRow label="Manager" valueClassName="min-w-0">
      {parentThreadId ? (
        <div className="inline-flex max-w-full min-w-0 items-center gap-1 text-xs text-foreground">
          <Link
            to={getThreadRoutePath({ projectId, threadId: parentThreadId })}
            className="min-w-0 truncate text-xs text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2"
          >
            {selectedManagerOptionLabel ?? "Manager"}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_svg]:size-3"
            disabled={updateThreadPending}
            onClick={() => {
              onAssignManager(null);
            }}
            aria-label="Unassign manager"
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
                (managerSelectorOptions.length <= 1 &&
                  managerSelectorValue === "none")
                  ? -1
                  : 0
              }
              className="inline-flex w-fit max-w-full min-w-0 items-center gap-1 rounded-md px-0 text-xs leading-tight text-foreground outline-none ring-sidebar-ring transition-colors hover:text-foreground focus-visible:ring-2"
            >
              <span className="min-w-0 truncate text-xs text-foreground">
                {selectedManagerOptionLabel ?? "None"}
              </span>
              <Icon
                name="ChevronDown"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-40 max-w-72">
            <DropdownMenuLabel>Assign to manager</DropdownMenuLabel>
            {managerSelectorOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => {
                  onAssignManager(
                    option.value === "none" ? null : option.value,
                  );
                }}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate" title={option.label}>
                  {option.label}
                </span>
                <Icon
                  name="Check"
                  className={
                    managerSelectorValue === option.value
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

export function KindRow({ thread }: { thread: Thread }) {
  if (thread.type !== "manager") return null;
  return (
    <DetailRow label="Kind" valueClassName="min-w-0 truncate">
      Manager
    </DetailRow>
  );
}

export interface EnvironmentRowProps {
  thread: Thread;
  environment: Environment | null;
}

export function EnvironmentRow({
  thread,
  environment,
}: EnvironmentRowProps) {
  const createThreadInWorktree = useCreateThreadInWorktree({
    projectId: thread.projectId,
    environmentId: environment?.id ?? "",
  });
  if (thread.type === "manager") return null;
  if (!environment) return null;
  const display = formatEnvironmentDisplay({
    environment,
  });
  const showCreateThreadButton = isWorktreeEnvironment(environment);
  return (
    <DetailRow label="Environment" valueClassName="min-w-0">
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
  if (thread.type === "manager") return null;
  if (!environment?.path) return null;
  const display = getWorkspacePathRowDisplay(environment);
  if (!display) return null;

  return (
    <DetailRow label={display.rowLabel} valueClassName="min-w-0">
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
  const branchName = workspaceStatus?.branch.currentBranch ?? null;
  if (thread.type === "manager") return null;
  if (!branchName) return null;
  return (
    <DetailRow label="Branch" valueClassName="min-w-0 truncate">
      <CopyableInlineLabel
        text={branchName}
        label="Copy branch name"
        successMessage="Branch name copied"
        errorMessage="Failed to copy branch name"
      />
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
  merged: { label: "Merged", dotClass: "bg-primary" },
  closed: { label: "Closed", dotClass: "bg-destructive" },
};

export interface PullRequestRowProps {
  thread: Thread;
  pullRequest: ThreadPullRequest | null;
}

export function PullRequestRow({ thread, pullRequest }: PullRequestRowProps) {
  if (thread.type === "manager") return null;
  if (!pullRequest) return null;
  const stateDisplay = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  return (
    <DetailRow
      label={
        <span className="flex items-center gap-1.5">
          <Icon
            name="GitMerge"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          Pull request
        </span>
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
  mergeBaseBranchOptionsTruncated?: boolean;
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
  mergeBaseBranchOptionsTruncated,
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
  if (thread.type === "manager") return null;
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
    <DetailRow label="Merge base" valueClassName="min-w-0 truncate">
      {canSelectMergeBase && mergeBaseBranch ? (
        <BranchPicker
          value={mergeBaseBranch}
          options={mergeBaseCandidates}
          remoteOptions={remoteMergeBaseCandidates}
          selectedOptionKind={mergeBaseCandidateGroups.selectedOptionKind}
          optionsTruncated={mergeBaseBranchOptionsTruncated}
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
  const isManagerThread = thread.type === "manager";
  const canUseGitUi = !isManagerThread;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  const showWorkspaceStatus =
    canUseGitUi &&
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
  const labelClass =
    workspaceStatus?.workingTree.state === "untracked"
      ? "text-muted-foreground"
      : "text-foreground";

  return (
    <DetailRow label="Git status" align="start" valueClassName="min-w-0">
      <div
        className="flex min-w-0 items-baseline gap-2 whitespace-nowrap"
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
      <ThreadUnarchiveButton
        isPending={isPending}
        onUnarchive={onUnarchive}
        threadType={thread.type}
      />
    </DetailRow>
  );
}

export interface ThreadSchedulesRowProps {
  schedules: readonly ThreadSchedule[];
}

export function ThreadSchedulesRow({ schedules }: ThreadSchedulesRowProps) {
  if (schedules.length === 0) return null;

  return (
    <DetailRow label="Schedules" align="start" valueClassName="min-w-0">
      <TruncatedList
        items={schedules}
        getKey={(schedule) => schedule.id}
        renderItem={(schedule) => (
          <div
            className={cn(
              "min-w-0 leading-snug",
              !schedule.enabled && "opacity-60",
            )}
          >
            <div className="truncate font-medium text-foreground">
              {schedule.name}
            </div>
            <div className="truncate text-muted-foreground">
              {`${formatCronCadence(schedule.cron)} · ${formatScheduleStatusLabel(
                {
                  enabled: schedule.enabled,
                  nextRunAt: schedule.nextFireAt,
                },
              )}`}
            </div>
          </div>
        )}
      />
    </DetailRow>
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
  if (thread.type === "manager") return null;
  return (
    <ChangedFilesDetailRow
      sections={selectWorkspaceChangedFilesSections(workspaceStatus)}
      onFileClick={onChangedFileClick}
      rowClassName="min-h-32 flex-1"
      rowValueClassName="min-h-0 flex-1"
      listClassName="h-full"
    />
  );
}

export interface ManagerWorkspaceRowProps {
  controller: ManagerStorageBrowserController;
  filesError?: Error | null;
  isFilesLoading: boolean;
}

export function ManagerWorkspaceRow({
  controller,
  filesError,
  isFilesLoading,
}: ManagerWorkspaceRowProps) {
  const { isSearchOpen, openSearch } = controller;
  return (
    <DetailRow
      orientation="vertical"
      className="min-h-32 flex-1"
      valueClassName="min-h-0 flex-1 overflow-hidden"
      labelClassName="flex items-center justify-between gap-2"
      label={
        <>
          <span>Manager workspace</span>
          {isSearchOpen ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 rounded-md p-0 text-muted-foreground"
              aria-label="Search files"
              onClick={openSearch}
            >
              <Icon name="Search" className="size-3.5" />
            </Button>
          )}
        </>
      }
    >
      <ManagerThreadStorageBrowser
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
  managerThreads: readonly ThreadListEntry[];
  canAssignToManager: boolean;
  canTakeOverThread: boolean;
  environment: Environment | null;
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceStatusError: Error | null;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  pullRequest: ThreadPullRequest | null;
  selectedMergeBaseBranch: string | undefined;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions: readonly string[] | undefined;
  mergeBaseBranchOptionsTruncated?: boolean;
  mergeBaseRemoteBranchOptions?: readonly string[];
  isLoadingMergeBaseBranchOptions: boolean;
  threadSchedules: readonly ThreadSchedule[];
  updateThreadPending: boolean;
  storage?: ManagerWorkspaceRowProps;
  onAssignManager: (parentThreadId: string | null) => void;
  onMergeBaseBranchChange: (branch: string) => void;
  onMergeBasePickerOpenChange?: (open: boolean) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
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
  threadSchedules,
}: Pick<
  ThreadMetadataContentProps,
  | "thread"
  | "parentThreadDisplayName"
  | "environment"
  | "workspaceStatus"
  | "workspaceStatusError"
  | "workspaceUnavailable"
  | "pullRequest"
  | "threadSchedules"
>): boolean {
  const isManagerThread = thread.type === "manager";
  const parentThreadId = thread.parentThreadId ?? undefined;
  const canUseGitUi = !isManagerThread;
  const isWorkspaceDeleted = environment?.status === "destroyed";
  const showWorkspaceStatus =
    canUseGitUi &&
    (Boolean(workspaceStatus) ||
      Boolean(workspaceStatusError) ||
      Boolean(workspaceUnavailable) ||
      isWorkspaceDeleted) &&
    !(thread.archivedAt != null && environment?.managed !== true);
  const branchName = workspaceStatus?.branch.currentBranch ?? null;
  const workspaceChangedFilesSections =
    selectWorkspaceChangedFilesSections(workspaceStatus);
  const showThreadChangedFiles =
    canUseGitUi && workspaceChangedFilesSections.length > 0;

  return Boolean(
    isManagerThread ||
    parentThreadId ||
    (!isManagerThread && environment) ||
    (!isManagerThread && branchName) ||
    (!isManagerThread && pullRequest) ||
    showWorkspaceStatus ||
    showThreadChangedFiles ||
    threadSchedules.length > 0 ||
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
 * full panel. Owns the info tab's vertical scroll: the rows scroll as a group
 * so no section (e.g. Manager workspace) can be pushed out of reach. Any
 * flex-filling row carries its own min-height so it stays usable once the
 * group scrolls.
 */
export function ThreadMetadataCard({ children }: DetailCardWrapperProps) {
  return (
    <DetailCard
      appearance="flat"
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
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
    managerThreads,
    canAssignToManager,
    canTakeOverThread,
    environment,
    workspaceStatus,
    workspaceStatusError,
    workspaceUnavailable,
    pullRequest,
    selectedMergeBaseBranch,
    mergeBaseBranchRef,
    mergeBaseBranchOptions,
    mergeBaseBranchOptionsTruncated,
    mergeBaseRemoteBranchOptions,
    isLoadingMergeBaseBranchOptions,
    threadSchedules,
    updateThreadPending,
    storage,
    onAssignManager,
    onMergeBaseBranchChange,
    onMergeBasePickerOpenChange,
    onMergeBaseBranchSearchQueryChange,
    onChangedFileClick,
  } = props;

  return (
    <ThreadMetadataCard>
      <KindRow thread={thread} />
      <ManagerSelectorRow
        thread={thread}
        projectId={projectId}
        parentThreadDisplayName={parentThreadDisplayName}
        managerThreads={managerThreads}
        canAssignToManager={canAssignToManager}
        canTakeOverThread={canTakeOverThread}
        updateThreadPending={updateThreadPending}
        onAssignManager={onAssignManager}
      />
      <EnvironmentRow thread={thread} environment={environment} />
      <WorkspacePathRow thread={thread} environment={environment} />
      <BranchRow thread={thread} workspaceStatus={workspaceStatus} />
      <MergeBaseRow
        thread={thread}
        workspaceStatus={workspaceStatus}
        selectedMergeBaseBranch={selectedMergeBaseBranch}
        mergeBaseBranchRef={mergeBaseBranchRef}
        mergeBaseBranchOptions={mergeBaseBranchOptions}
        mergeBaseBranchOptionsTruncated={mergeBaseBranchOptionsTruncated}
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
      <PullRequestRow thread={thread} pullRequest={pullRequest} />
      <ArchivedRow thread={thread} />
      <ThreadSchedulesRow schedules={threadSchedules} />
      <ChangedFilesRow
        thread={thread}
        workspaceStatus={workspaceStatus}
        onChangedFileClick={onChangedFileClick}
      />
      {storage ? <ManagerWorkspaceRow {...storage} /> : null}
    </ThreadMetadataCard>
  );
}
