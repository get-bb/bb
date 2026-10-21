import { EnvironmentProviderIcon } from "@/components/plugin/EnvironmentProviderIcon";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type UIEvent,
} from "react";
import {
  ForksSection,
  ChildThreadsSection,
} from "./info/RelatedThreadsSection";
import {
  ThreadStorageSection,
  type ThreadStorageSectionProps,
} from "./info/ThreadStorageSection";
import { Link } from "react-router-dom";
import type {
  Environment,
  Thread,
  ThreadListEntry,
  ThreadParentNotifications,
  ThreadPullRequest,
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
import { Button } from "@bb/shared-ui/button";
import { COARSE_POINTER_TEXT_SM_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { CopyableInlineLabel } from "@/components/ui/copy-button.js";
import { useFittedPathMiddle } from "@/components/ui/truncate-path-middle";
import {
  DetailCard,
  DetailRow,
  DetailRowIconLabel,
  DETAIL_ROW_ICON_CLASS,
} from "@bb/shared-ui/detail-card";
import { useCreateThreadInEnvironment } from "@/hooks/useCreateThreadInEnvironment";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
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
import {
  describePullRequestStatus,
  getPullRequestNextStep,
  getPullRequestStateDisplay,
  isPullRequestAutoMergeOn,
} from "@/lib/pull-request-display";
import { PullRequestNextStepLabel } from "@/components/pull-request/PullRequestNextStepLabel";
import { PullRequestStateIcon } from "@/components/pull-request/PullRequestStatusPill";
import { GithubFaviconIcon } from "@/components/pull-request/GithubFaviconIcon";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";
import { ParentThreadPicker } from "@/components/pickers/ParentThreadPicker";

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
    <DetailRow
      label={
        <DetailRowIconLabel icon="BellDot">Notify parent</DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
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
            <DetailRowIconLabel icon={infoDisplay.icon}>
              Environment
            </DetailRowIconLabel>
          )
        }
        valueClassName="min-w-0"
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
          valueClassName="min-w-0"
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
    <DetailRow
      label={<DetailRowIconLabel icon="Folder">Project</DetailRowIconLabel>}
      valueClassName="min-w-0"
    >
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
    <DetailRow
      label={
        <DetailRowIconLabel icon="AlertTriangle">
          Environment
        </DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
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
    <DetailRow
      label={
        <DetailRowIconLabel icon="FolderOpen">Directory</DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
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

interface PullRequestRowProps {
  pullRequest: ThreadPullRequest | null;
}

export function PullRequestRow({ pullRequest }: PullRequestRowProps) {
  const handlePullRequestClick = useUrlAnchorClickHandler(pullRequest?.url);
  if (!pullRequest) return null;
  const stateDisplay = getPullRequestStateDisplay(pullRequest);
  const nextStep = getPullRequestNextStep(pullRequest);
  return (
    <DetailRow
      label={
        <DetailRowIconLabel icon="GitPullRequestArrow">
          Pull request
        </DetailRowIconLabel>
      }
      valueClassName="min-w-0"
    >
      <span className="flex h-5 max-w-full min-w-0 items-center gap-2">
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handlePullRequestClick}
          aria-label={`Pull request ${pullRequest.number}: ${describePullRequestStatus(pullRequest)}`}
          className="flex min-w-0 items-center gap-2 text-xs text-foreground no-underline transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <GithubFaviconIcon />
          <span className="shrink-0 text-muted-foreground">
            #{pullRequest.number}
          </span>
          <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-1.5 text-muted-foreground">
            <PullRequestStateIcon
              pullRequest={pullRequest}
              className="size-3.5"
            />
            <span>{stateDisplay.label}</span>
          </span>
          {nextStep ? <PullRequestNextStepLabel nextStep={nextStep} /> : null}
        </a>
        {isPullRequestAutoMergeOn(pullRequest) ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="img"
                aria-label="Auto-merge on"
                className="flex shrink-0 items-center text-subtle-foreground"
              >
                <Icon name="Zap" className="size-3" aria-hidden />
              </span>
            </TooltipTrigger>
            <TooltipContent>Auto-merge on</TooltipContent>
          </Tooltip>
        ) : null}
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
    <DetailRow
      label={<DetailRowIconLabel icon="Archive">Archived</DetailRowIconLabel>}
      valueClassName="min-w-0 truncate"
    >
      <ThreadUnarchiveButton isPending={isPending} onUnarchive={onUnarchive} />
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
  pullRequest: ThreadPullRequest | null;
  updateThreadPending: boolean;
  storage?: ThreadStorageSectionProps;
  onAssignParent: (parentThreadId: string | null) => void;
  onParentSelectorOpenChange: (open: boolean) => void;
  onRetryParentThreads: () => void;
}

export function hasAnyThreadMetadata(
  {
    thread,
    environment,
    environmentProvisioningFailure,
    pullRequest,
  }: Pick<
    ThreadMetadataContentProps,
    "thread" | "environment" | "environmentProvisioningFailure" | "pullRequest"
  >,
  hasForks: boolean,
): boolean {
  const parentThreadId = thread.parentThreadId ?? undefined;
  return Boolean(
    parentThreadId ||
    environment ||
    environmentProvisioningFailure ||
    pullRequest ||
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

export function ThreadMetadataContent(props: ThreadMetadataContentProps) {
  const {
    thread,
    projectId,
    parentThreadProjectId,
    parentThreadDisplayName,
    parentThreads,
    canAssignToParent,
    canTakeOverThread,
    isLoadingParentThreads,
    isParentThreadsError,
    environment,
    environmentProvisioningFailure,
    environmentDisplayHost,
    pullRequest,
    updateThreadPending,
    storage,
    onAssignParent,
    onParentSelectorOpenChange,
    onRetryParentThreads,
  } = props;

  return (
    <ThreadMetadataCard>
      <div className="flex min-w-0 flex-col divide-y divide-border [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child:not(:only-child)]:pb-0 [&>*:only-child]:border-b [&>*:only-child]:border-border">
        <div className="flex min-w-0 flex-col gap-1.5">
          <ParentSelectorRow
            thread={thread}
            projectId={projectId}
            parentThreadProjectId={parentThreadProjectId}
            parentThreadDisplayName={parentThreadDisplayName}
            parentThreads={parentThreads}
            canAssignToParent={canAssignToParent}
            canTakeOverThread={canTakeOverThread}
            isLoadingParentThreads={isLoadingParentThreads}
            isParentThreadsError={isParentThreadsError}
            updateThreadPending={updateThreadPending}
            onAssignParent={onAssignParent}
            onParentSelectorOpenChange={onParentSelectorOpenChange}
            onRetryParentThreads={onRetryParentThreads}
          />
          <ParentNotificationsRow thread={thread} />
          <ProjectRow projectId={projectId} />
          <EnvironmentRow
            thread={thread}
            environment={environment}
            environmentDisplayHost={environmentDisplayHost}
          />
          <EnvironmentProvisioningFailureRow
            failed={environmentProvisioningFailure}
          />
          <WorkspacePathRow environment={environment} />
          <PullRequestRow pullRequest={pullRequest} />
          <ArchivedRow thread={thread} />
        </div>
        <ChildThreadsSection thread={thread} />
        <ForksSection thread={thread} />
        {storage ? <ThreadStorageSection {...storage} /> : null}
      </div>
    </ThreadMetadataCard>
  );
}
