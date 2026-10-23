import { EnvironmentProviderIcon } from "@/components/plugin/EnvironmentProviderIcon";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import { UncommittedChangesSection } from "./info/ChangesSection";
import { CommitsSection } from "./info/CommitsSection";
import {
  ForksSection,
  ChildThreadsSection,
} from "./info/RelatedThreadsSection";
import {
  ThreadStorageSection,
  type ThreadStorageSectionProps,
} from "./info/ThreadStorageSection";
import {
  ThreadInfoRows,
  ThreadInfoSections,
  type CoreThreadInfoRegistration,
} from "./info/ThreadInfoSlots";
import {
  experimental_THREAD_INFO_ROW_GROUPS,
  experimental_THREAD_INFO_SECTION_GROUPS,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk";
import { Link } from "react-router-dom";
import type {
  Environment,
  GitBranchRefClassification,
  Thread,
  ThreadListEntry,
  ThreadParentNotifications,
} from "@bb/domain";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import { cn, formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentWorkspaceInfoDisplay,
} from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { useHosts } from "@/hooks/queries/host-queries";
import { useProjectDisplayName } from "@/hooks/queries/sidebar-navigation-query";
import { MachineIcon } from "@/components/machines/MachineLabel";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CopyableInlineLabel } from "@/components/ui/copy-button.js";
import { useFittedPathMiddle } from "@/components/ui/truncate-path-middle";
import {
  DetailCard,
  DetailRow,
  DETAIL_ROW_ICON_CLASS,
} from "@/components/ui/detail-card.js";
import { useCreateThreadInEnvironment } from "@/hooks/useCreateThreadInEnvironment";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  BranchPicker,
  getMergeBaseBranchCandidateGroups,
} from "@/components/pickers/BranchPicker";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import {
  selectWorkspaceChangedFilesSections,
  type WorkspaceChangedFileSelection,
} from "@/components/workspace/workspace-change-summary";
import {
  getGitStatusDisplay,
  SquashMergeInfo,
} from "@/components/workspace/workspace-status";
import {
  useUnarchiveThread,
  useUpdateThread,
} from "../../hooks/mutations/thread-state-mutations";
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";
import { buildParentSelectorOptions } from "@/views/thread-detail/threadParentSelectorOptions";
import { getThreadRoutePath } from "@/lib/route-paths";
import { ThreadTitle } from "@/components/thread/ThreadTitleMentions";
import { ParentThreadPicker } from "@/components/pickers/ParentThreadPicker";
import type { WorkspaceStatus } from "bb-plugin-bb--git/contract";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract/workspace";

interface ParentSelectorRowProps {
  thread: Thread;
  projectId: string;
  parentThreadProjectId: string | null;
  parentThreadDisplayName: string | null;
  parentThreads: readonly ThreadListEntry[];
  canAssignToParent: boolean;
  canTakeOverThread: boolean;
  isLoadingParentThreads: boolean;
  isParentThreadsError: boolean;
  updateThreadPending: boolean;
  onAssignParent: (parentThreadId: string | null) => void;
  onParentSelectorOpenChange: (open: boolean) => void;
  onRetryParentThreads: () => void;
  defaultOpen?: boolean;
}

export function ParentSelectorRow({
  thread,
  projectId,
  parentThreadProjectId,
  parentThreadDisplayName,
  parentThreads,
  canAssignToParent,
  canTakeOverThread,
  isLoadingParentThreads,
  isParentThreadsError,
  updateThreadPending,
  onAssignParent,
  onParentSelectorOpenChange,
  onRetryParentThreads,
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
    <DetailRow icon="UserRound" label="Parent">
      {parentThreadId ? (
        <div
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-1 text-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
        >
          <Link
            to={getThreadRoutePath({
              projectId: parentThreadProjectId ?? projectId,
              threadId: parentThreadId,
            })}
            className={cn(
              "block min-w-0 text-foreground no-underline transition-[text-decoration-color] duration-150 hover:underline hover:underline-offset-2",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
          >
            <ThreadTitle
              title={selectedParentOptionLabel ?? "Parent thread"}
              tooltip
            />
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-3.5 shrink-0 rounded-full p-0 text-muted-foreground hover:bg-transparent hover:text-foreground [&_[data-icon-root]]:size-3 max-md:pointer-coarse:h-9 max-md:pointer-coarse:w-9 max-md:pointer-coarse:[&_[data-icon-root]]:size-5"
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
        <ParentThreadPicker
          value={parentSelectorValue}
          options={parentSelectorOptions}
          isLoading={isLoadingParentThreads}
          isError={isParentThreadsError}
          disabled={updateThreadPending}
          onChange={(value) => {
            onAssignParent(value === "none" ? null : value);
          }}
          onOpenChange={onParentSelectorOpenChange}
          onRetry={onRetryParentThreads}
          defaultOpen={defaultOpen}
        />
      )}
    </DetailRow>
  );
}

const PARENT_NOTIFICATIONS_OPTIONS: readonly PickerOption<ThreadParentNotifications>[] =
  [
    {
      value: "auto",
      label: "Auto",
      description: "Every finished turn, failure, and blocker",
    },
    {
      value: "stuck",
      label: "When stuck",
      description: "Only failures, interruptions, and blockers",
    },
    { value: "off", label: "Off", description: "Never" },
  ];

interface ParentNotificationsRowProps {
  thread: Thread;
}

export function ParentNotificationsRow({
  thread,
}: ParentNotificationsRowProps) {
  const updateThread = useUpdateThread({
    errorMessage: "Failed to change parent notifications.",
  });
  if (thread.parentThreadId === null) return null;
  return (
    <DetailRow icon="BellDot" label="Notify parent">
      <OptionPicker
        label="Notify parent"
        value={thread.parentNotifications}
        options={PARENT_NOTIFICATIONS_OPTIONS}
        className="-mx-1 h-5 rounded-sm font-normal text-foreground hover:bg-state-hover data-[state=open]:bg-state-hover"
        caretClassName="size-3"
        disabled={updateThread.isPending}
        showChevronWhenDisabled
        onChange={(parentNotifications) => {
          updateThread.mutate({ id: thread.id, parentNotifications });
        }}
      />
    </DetailRow>
  );
}

interface EnvironmentRowProps {
  thread: Thread;
  environment: Environment | null;
  environmentDisplayHost: EnvironmentDisplayHostContext;
}

export function EnvironmentRow({
  thread,
  environment,
  environmentDisplayHost,
}: EnvironmentRowProps) {
  const createThreadInEnvironment = useCreateThreadInEnvironment({
    projectId: thread.projectId,
    environmentId: environment?.id ?? "",
    sectionId: thread.sectionId,
    pinned: thread.pinnedAt !== null,
  });
  const { providers } = useSystemEnvironmentProviders();
  const { providers: machineProviders } = useSystemMachineProviders();
  const hosts = useHosts();
  if (!environment) return null;
  const environmentHost = hosts.data?.find(
    (host) => host.id === environment.hostId,
  );
  const machineProvider = machineProviders?.find(
    (provider) => provider.id === environmentHost?.machineProviderId,
  );
  const providerLookup = findEnvironmentDisplayProvider(
    providers,
    environment.environmentProviderId,
  );
  const display = formatEnvironmentDisplay({
    environment,
    host: environmentDisplayHost,
    providerLookup,
  });
  const infoDisplay = getEnvironmentWorkspaceInfoDisplay({
    display,
    providerLookup,
    hostName: environmentDisplayHost.identity?.name ?? null,
    locality: environmentDisplayHost.locality,
  });
  const displayHost = environmentHost ?? {
    name:
      environmentDisplayHost.identity?.name ?? infoDisplay.machineName ?? "",
    type: "persistent" as const,
    machineProviderId: null,
  };
  const showCreateThreadButton =
    environment.hostLifecycle === "active" &&
    isReusableEnvironment(environment);
  const machineIdentity =
    infoDisplay.machineName !== null ? environmentDisplayHost.identity : null;
  return (
    <>
      <DetailRow
        label={
          providerLookup.status === "loaded" &&
          providerLookup.provider !== null ? (
            <span className="flex items-center gap-1.5">
              <EnvironmentProviderIcon
                provider={providerLookup.provider}
                className={DETAIL_ROW_ICON_CLASS}
              />
              <span className="min-w-0 truncate">Environment</span>
            </span>
          ) : (
            "Environment"
          )
        }
        icon={
          providerLookup.status === "loaded" && providerLookup.provider !== null
            ? undefined
            : infoDisplay.icon
        }
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate" title={infoDisplay.label}>
            {infoDisplay.label}
          </span>
          {showCreateThreadButton ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="New thread in environment"
                  onClick={createThreadInEnvironment}
                  className="inline-flex shrink-0 items-center justify-center rounded-md p-0.5 text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground"
                >
                  <Icon
                    name="MessageSquarePlus"
                    className="size-3 shrink-0 max-md:pointer-coarse:size-4"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>New thread in environment</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
      </DetailRow>
      {machineIdentity ? (
        <DetailRow
          label={
            <span className="flex items-center gap-1.5">
              <MachineIcon
                host={displayHost}
                machineProvider={machineProvider}
                className={DETAIL_ROW_ICON_CLASS}
              />
              <span className="min-w-0 truncate">Machine</span>
            </span>
          }
        >
          <span
            className="flex min-w-0 items-center gap-1"
            title={`${machineIdentity.name} (${
              environment.hostLifecycle !== "active"
                ? "unavailable"
                : machineIdentity.connected
                  ? "connected"
                  : "offline"
            })`}
          >
            <span className="min-w-0 truncate">{displayHost.name}</span>
            {machineIdentity.connected ||
            environment.hostLifecycle !== "active" ? null : (
              <span className="shrink-0 text-muted-foreground">(offline)</span>
            )}
          </span>
        </DetailRow>
      ) : null}
    </>
  );
}

export function ProjectRow({ projectId }: { projectId: string }) {
  const projectName = useProjectDisplayName(projectId);
  if (!projectName) return null;

  return (
    <DetailRow icon="Folder" label="Project">
      <span className="block min-w-0 truncate" title={projectName}>
        {projectName}
      </span>
    </DetailRow>
  );
}

export function EnvironmentProvisioningFailureRow({
  failed,
}: {
  failed: boolean;
}) {
  if (!failed) return null;
  return (
    <DetailRow icon="AlertTriangle" label="Environment">
      <span className="flex min-w-0 items-center gap-1">
        <span className="min-w-0 truncate">Not created</span>
        <span className="shrink-0 text-muted-foreground">
          · provisioning failed
        </span>
      </span>
    </DetailRow>
  );
}

interface WorkspacePathRowProps {
  environment: Environment | null;
}

function isReusableEnvironment(environment: Environment): boolean {
  return environment.status === "ready" && environment.path !== null;
}

function measureCopyIconWidth(container: HTMLElement): number {
  const label = container.querySelector("button");
  const icon = label?.querySelector("svg");
  if (!label || !icon) return 0;
  const gap = Number.parseFloat(getComputedStyle(label).columnGap);
  return icon.getBoundingClientRect().width + (Number.isNaN(gap) ? 0 : gap);
}

export function WorkspacePathRow({ environment }: WorkspacePathRowProps) {
  if (!environment?.path) return null;
  return <WorkspacePathValue path={environment.path} />;
}

function WorkspacePathValue({ path }: { path: string }) {
  const { containerRef, fitted } = useFittedPathMiddle<HTMLDivElement>(
    formatHomePathForDisplay(path),
    measureCopyIconWidth,
  );

  return (
    <DetailRow icon="FolderOpen" label="Directory">
      <div ref={containerRef} className="min-w-0">
        <CopyableInlineLabel
          text={path}
          label="Copy directory"
          title={path}
          successMessage="Directory copied"
          errorMessage="Failed to copy directory"
        >
          <span className="text-muted-foreground">{fitted}</span>
        </CopyableInlineLabel>
      </div>
    </DetailRow>
  );
}

interface BranchRowProps {
  workspaceStatus: WorkspaceStatus | undefined;
}

export function BranchRow({ workspaceStatus }: BranchRowProps) {
  const checkoutDisplay = workspaceStatus
    ? formatWorkspaceCheckoutDisplay({ checkout: workspaceStatus.checkout })
    : null;
  if (checkoutDisplay === null) return null;
  return (
    <DetailRow icon="GitBranch" label={checkoutDisplay.rowLabel}>
      {checkoutDisplay.copyValue !== null ? (
        <span className="block truncate">
          <CopyableInlineLabel
            text={checkoutDisplay.copyValue}
            label={checkoutDisplay.copyLabel ?? "Copy checkout value"}
            title={checkoutDisplay.title}
            successMessage={
              checkoutDisplay.copySuccessMessage ?? "Value copied"
            }
            errorMessage={
              checkoutDisplay.copyErrorMessage ?? "Failed to copy value"
            }
          >
            {checkoutDisplay.label}
          </CopyableInlineLabel>
        </span>
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
  ThreadMetadataContentProps,
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
    <DetailRow icon="GitMerge" label="Merge base">
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
  thread: Thread;
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
    error: workspaceStatusError,
    workspaceUnavailable,
    workspaceDeleted: environment?.status === "destroyed",
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

interface ArchivedRowProps {
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
    <DetailRow icon="Archive" label="Archived">
      <span className="block truncate">
        <ThreadUnarchiveButton
          isPending={isPending}
          onUnarchive={onUnarchive}
        />
      </span>
    </DetailRow>
  );
}

export interface ThreadMetadataContentProps {
  thread: Thread;
  projectId: string;
  parentThreadProjectId: string | null;
  parentThreadDisplayName: string | null;
  parentThreads: readonly ThreadListEntry[];
  canAssignToParent: boolean;
  canTakeOverThread: boolean;
  isLoadingParentThreads: boolean;
  isParentThreadsError: boolean;
  environment: Environment | null;
  environmentProvisioningFailure: boolean;
  environmentDisplayHost: EnvironmentDisplayHostContext;
  workspaceStatus: WorkspaceStatus | undefined;
  workspaceStatusError: Error | null;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  threadEnvironmentId: string | null;
  selectedMergeBaseBranch: string | undefined;
  mergeBaseBranchRef?: GitBranchRefClassification | null;
  mergeBaseBranchOptions: readonly string[] | undefined;
  mergeBaseRemoteBranchOptions?: readonly string[];
  isLoadingMergeBaseBranchOptions: boolean;
  updateThreadPending: boolean;
  storage?: ThreadStorageSectionProps;
  onAssignParent: (parentThreadId: string | null) => void;
  onParentSelectorOpenChange: (open: boolean) => void;
  onRetryParentThreads: () => void;
  onMergeBaseBranchChange: (branch: string) => void;
  onMergeBasePickerOpenChange?: (open: boolean) => void;
  onMergeBaseBranchSearchQueryChange?: (query: string) => void;
  onChangedFileClick?: (selection: WorkspaceChangedFileSelection) => void;
  onCommitClick?: (sha: string) => void;
  onOpenChangedFile?: (path: string) => void;
}

export function hasAnyThreadMetadata(
  {
    thread,
    environment,
    environmentProvisioningFailure,
    workspaceStatus,
    workspaceStatusError,
    workspaceUnavailable,
  }: Pick<
    ThreadMetadataContentProps,
    | "thread"
    | "environment"
    | "environmentProvisioningFailure"
    | "workspaceStatus"
    | "workspaceStatusError"
    | "workspaceUnavailable"
  >,
  hasForks: boolean,
): boolean {
  const parentThreadId = thread.parentThreadId ?? undefined;
  const showWorkspaceStatus = shouldShowWorkspaceStatus({
    thread,
    environment,
    workspaceStatus,
    workspaceStatusError,
    workspaceUnavailable,
  });
  const branchName = workspaceStatus?.branch.currentBranch ?? null;
  const workspaceChangedFilesSections =
    selectWorkspaceChangedFilesSections(workspaceStatus);
  const showThreadChangedFiles = workspaceChangedFilesSections.length > 0;

  return Boolean(
    parentThreadId ||
    environment ||
    environmentProvisioningFailure ||
    branchName ||
    showWorkspaceStatus ||
    showThreadChangedFiles ||
    thread.archivedAt != null ||
    hasForks,
  );
}

interface DetailCardWrapperProps {
  children: ReactNode;
}

const INFO_SCROLLBAR_IDLE_DELAY_MS = 600;

export function ThreadMetadataCard({ children }: DetailCardWrapperProps) {
  const scrollbarIdleTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (scrollbarIdleTimeoutRef.current !== null) {
        window.clearTimeout(scrollbarIdleTimeoutRef.current);
      }
    },
    [],
  );

  const handleScroll = useCallback((event: UIEvent<HTMLDListElement>) => {
    const scrollArea = event.currentTarget;
    if (scrollArea.dataset.scrollbarScrolling !== "true") {
      scrollArea.dataset.scrollbarScrolling = "true";
    }
    if (scrollbarIdleTimeoutRef.current !== null) {
      window.clearTimeout(scrollbarIdleTimeoutRef.current);
    }
    scrollbarIdleTimeoutRef.current = window.setTimeout(() => {
      scrollbarIdleTimeoutRef.current = null;
      scrollArea.removeAttribute("data-scrollbar-scrolling");
    }, INFO_SCROLLBAR_IDLE_DELAY_MS);
  }, []);

  return (
    <DetailCard
      appearance="flat"
      className="transient-scrollbar min-h-0 flex-1 gap-1.5 overflow-x-hidden overflow-y-auto px-4 py-3 max-md:py-1 max-md:[--detail-label-width:7.5rem]"
      onScroll={handleScroll}
    >
      {children}
    </DetailCard>
  );
}

const ThreadInfoHostContext = createContext<ThreadMetadataContentProps | null>(
  null,
);

function useThreadInfoHost(): ThreadMetadataContentProps {
  const host = useContext(ThreadInfoHostContext);
  if (host === null) {
    throw new Error(
      "thread Info rows must render inside ThreadMetadataContent",
    );
  }
  return host;
}

function useIsThreadInfoHostActive(): boolean {
  const { environment } = useThreadInfoHost();
  return environment === null || environment.hostLifecycle === "active";
}

function CoreParentRow() {
  const host = useThreadInfoHost();
  return (
    <ParentSelectorRow
      thread={host.thread}
      projectId={host.projectId}
      parentThreadProjectId={host.parentThreadProjectId}
      parentThreadDisplayName={host.parentThreadDisplayName}
      parentThreads={host.parentThreads}
      canAssignToParent={host.canAssignToParent}
      canTakeOverThread={host.canTakeOverThread}
      isLoadingParentThreads={host.isLoadingParentThreads}
      isParentThreadsError={host.isParentThreadsError}
      updateThreadPending={host.updateThreadPending}
      onAssignParent={host.onAssignParent}
      onParentSelectorOpenChange={host.onParentSelectorOpenChange}
      onRetryParentThreads={host.onRetryParentThreads}
    />
  );
}

function CoreParentNotificationsRow() {
  return <ParentNotificationsRow thread={useThreadInfoHost().thread} />;
}

function CoreProjectRow({ projectId }: ExperimentalThreadInfoProps) {
  return <ProjectRow projectId={projectId} />;
}

function CoreEnvironmentRow() {
  const host = useThreadInfoHost();
  return (
    <EnvironmentRow
      thread={host.thread}
      environment={host.environment}
      environmentDisplayHost={host.environmentDisplayHost}
    />
  );
}

function CoreEnvironmentProvisioningFailureRow() {
  return (
    <EnvironmentProvisioningFailureRow
      failed={useThreadInfoHost().environmentProvisioningFailure}
    />
  );
}

function CoreWorkspacePathRow() {
  return <WorkspacePathRow environment={useThreadInfoHost().environment} />;
}

function CoreBranchRow() {
  const host = useThreadInfoHost();
  if (!useIsThreadInfoHostActive()) return null;
  return <BranchRow workspaceStatus={host.workspaceStatus} />;
}

function CoreMergeBaseRow() {
  const host = useThreadInfoHost();
  if (!useIsThreadInfoHostActive()) return null;
  return (
    <MergeBaseRow
      workspaceStatus={host.workspaceStatus}
      selectedMergeBaseBranch={host.selectedMergeBaseBranch}
      mergeBaseBranchRef={host.mergeBaseBranchRef}
      mergeBaseBranchOptions={host.mergeBaseBranchOptions}
      mergeBaseRemoteBranchOptions={host.mergeBaseRemoteBranchOptions}
      isLoadingMergeBaseBranchOptions={host.isLoadingMergeBaseBranchOptions}
      onMergeBaseBranchChange={host.onMergeBaseBranchChange}
      onMergeBasePickerOpenChange={host.onMergeBasePickerOpenChange}
      onMergeBaseBranchSearchQueryChange={
        host.onMergeBaseBranchSearchQueryChange
      }
    />
  );
}

function CoreGitStatusRow() {
  const host = useThreadInfoHost();
  if (!useIsThreadInfoHostActive()) return null;
  return (
    <GitStatusRow
      thread={host.thread}
      environment={host.environment}
      workspaceStatus={host.workspaceStatus}
      workspaceStatusError={host.workspaceStatusError}
      workspaceUnavailable={host.workspaceUnavailable}
    />
  );
}

function CoreArchivedRow() {
  return <ArchivedRow thread={useThreadInfoHost().thread} />;
}

function CoreChildThreadsSection() {
  return <ChildThreadsSection thread={useThreadInfoHost().thread} />;
}

function CoreForksSection() {
  return <ForksSection thread={useThreadInfoHost().thread} />;
}

function CoreCommitsSection() {
  const host = useThreadInfoHost();
  if (!useIsThreadInfoHostActive()) return null;
  return (
    <CommitsSection
      workspaceStatus={host.workspaceStatus}
      onCommitClick={host.onCommitClick}
      onChangedFileClick={host.onChangedFileClick}
      onOpenChangedFile={host.onOpenChangedFile}
    />
  );
}

function CoreUncommittedChangesSection() {
  const host = useThreadInfoHost();
  if (!useIsThreadInfoHostActive()) return null;
  return (
    <UncommittedChangesSection
      workspaceStatus={host.workspaceStatus}
      onChangedFileClick={host.onChangedFileClick}
      onOpenChangedFile={host.onOpenChangedFile}
    />
  );
}

function CoreThreadStorageSection() {
  const { storage } = useThreadInfoHost();
  return storage ? <ThreadStorageSection {...storage} /> : null;
}

const ROW_GROUPS = experimental_THREAD_INFO_ROW_GROUPS;
const SECTION_GROUPS = experimental_THREAD_INFO_SECTION_GROUPS;

const CORE_THREAD_INFO_ROWS: readonly CoreThreadInfoRegistration[] = [
  {
    id: "parent",
    group: ROW_GROUPS.thread,
    order: 10,
    component: CoreParentRow,
  },
  {
    id: "parentNotifications",
    group: ROW_GROUPS.thread,
    order: 20,
    component: CoreParentNotificationsRow,
  },
  {
    id: "project",
    group: ROW_GROUPS.thread,
    order: 30,
    component: CoreProjectRow,
  },
  {
    id: "environment",
    group: ROW_GROUPS.environment,
    order: 10,
    component: CoreEnvironmentRow,
  },
  {
    id: "environmentProvisioningFailure",
    group: ROW_GROUPS.environment,
    order: 20,
    component: CoreEnvironmentProvisioningFailureRow,
  },
  {
    id: "directory",
    group: ROW_GROUPS.environment,
    order: 30,
    component: CoreWorkspacePathRow,
  },
  { id: "branch", group: ROW_GROUPS.git, order: 10, component: CoreBranchRow },
  {
    id: "mergeBase",
    group: ROW_GROUPS.git,
    order: 20,
    component: CoreMergeBaseRow,
  },
  {
    id: "gitStatus",
    group: ROW_GROUPS.git,
    order: 30,
    component: CoreGitStatusRow,
  },
  {
    id: "archived",
    group: ROW_GROUPS.lifecycle,
    order: 10,
    component: CoreArchivedRow,
  },
];

const CORE_THREAD_INFO_SECTIONS: readonly CoreThreadInfoRegistration[] = [
  {
    id: "childThreads",
    group: SECTION_GROUPS.related,
    order: 10,
    component: CoreChildThreadsSection,
  },
  {
    id: "forks",
    group: SECTION_GROUPS.related,
    order: 20,
    component: CoreForksSection,
  },
  {
    id: "commits",
    group: SECTION_GROUPS.changes,
    order: 10,
    component: CoreCommitsSection,
  },
  {
    id: "uncommittedChanges",
    group: SECTION_GROUPS.changes,
    order: 20,
    component: CoreUncommittedChangesSection,
  },
  {
    id: "threadStorage",
    group: SECTION_GROUPS.storage,
    order: 10,
    component: CoreThreadStorageSection,
  },
];

export function ThreadMetadataContent(props: ThreadMetadataContentProps) {
  const infoEnvironment =
    props.threadEnvironmentId === null
      ? null
      : { id: props.threadEnvironmentId };
  return (
    <ThreadInfoHostContext.Provider value={props}>
      <ThreadMetadataCard>
        <div className="flex min-w-0 flex-col [&_[data-info-section]]:mt-3 [&_[data-info-section]]:border-t [&_[data-info-section]]:border-border [&_[data-info-section]]:pt-3">
          <div className="flex min-w-0 flex-col gap-1.5 [:not(:has([data-info-section]))>&]:border-b [:not(:has([data-info-section]))>&]:border-border [:not(:has([data-info-section]))>&]:pb-3">
            <ThreadInfoRows
              core={CORE_THREAD_INFO_ROWS}
              threadId={props.thread.id}
              projectId={props.projectId}
              environment={infoEnvironment}
            />
          </div>
          <ThreadInfoSections
            core={CORE_THREAD_INFO_SECTIONS}
            threadId={props.thread.id}
            projectId={props.projectId}
            environment={infoEnvironment}
          />
        </div>
      </ThreadMetadataCard>
    </ThreadInfoHostContext.Provider>
  );
}
