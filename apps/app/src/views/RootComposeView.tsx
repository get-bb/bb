import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  findLocalPathProjectSourceForHost,
  type EnvironmentStatus,
  isActiveTerminalSessionStatus,
  PERSONAL_PROJECT_ID,
  type PermissionMode,
  type ProjectSource,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  SidebarBootstrapResponse,
  TerminalSession,
} from "@bb/server-contract";
import {
  NewThreadPromptBox,
  type NewThreadProjectConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import { withLoopPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { type PromptBoxHandle } from "@/components/promptbox/PromptBoxInternal";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import {
  HostFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { EmptyStatePanel } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { Button } from "@/components/ui/button.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@/components/ui/coarse-pointer-sizing.js";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import {
  useCloseTerminal,
  useCloseEnvironmentTerminal,
  useCreateTerminal,
  useCreateEnvironmentTerminal,
  useEnvironmentTerminals,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import {
  useProjectPromptHistory,
  useProjectSourceBranches,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useProjectDefaultExecutionOptions } from "@/hooks/queries/project-default-execution-options-query";
import {
  useLocalProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useEscapeToHide } from "@/hooks/useEscapeToHide";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { promptDraftToInput } from "@/lib/prompt-draft";
import {
  buildForkThreadRequest,
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  type ForkThreadCreateSeed,
} from "@/lib/fork-thread-request";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  getThreadRoutePath,
  getRootComposeRoutePath,
  getSurfaceAwareThreadRoutePath,
  isRoutePath,
  isProjectlessProjectId,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
} from "@/lib/bb-desktop";
import {
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useRemoveFixedRightTerminalTab,
  useSetFixedRightTerminalActiveTerminal,
  useTouchFixedPanelTabsState,
  useUpdateFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import { createNewTabFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import {
  getFilePreviewLineRangeStart,
  type HostFileTabState,
  type ThreadStorageFileTabState,
  type WorkspaceFileTabState,
} from "@/lib/file-preview";
import {
  resolveUrlOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import {
  useRootComposeProjectId,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import { isLoopbackOrigin } from "@/lib/system-config-atoms";
import { RootComposeSecondaryContent } from "./RootComposeSecondaryContent";
import {
  buildRootComposeBranchUiState,
  type RootComposeBranchEnvironmentMode,
} from "./root-compose-branch-ui";
import { resolveRootComposeThreadEnvironment } from "./root-compose-thread-environment";
import { useScopedBranchSelection } from "./root-compose-branch-selection";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";
import { RootComposeEmptyWelcome } from "./RootComposeEmptyWelcome";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import {
  useThreadFileTabs,
  type FileSearchSelection,
} from "@/components/secondary-panel/useThreadFileTabs";
import { resolveRightPanelFileVisual } from "@/components/secondary-panel/rightPanelFileVisuals";
import { ThreadTerminalPanel } from "@/components/thread/terminal/ThreadTerminalPanel";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
  terminalStatusLabel,
} from "@/components/thread/terminal/useThreadTerminalController";
import {
  buildTerminalSyncedSecondaryFileTabs,
  findActiveTerminalIdInSecondaryFileTabs,
  syncTerminalTabsInFixedPanelState,
} from "./thread-detail/threadTerminalTabs";
import {
  getActiveFixedSecondaryTab,
  useSetThreadSecondaryPanelSelection,
} from "./thread-detail/threadSecondaryPanelSelection";
import { useThreadSecondaryPanelVisibility } from "./thread-detail/useThreadSecondaryPanelVisibility";
import type { ThreadSecondaryPanelHostFileOpenHandler } from "./thread-detail/useThreadSecondaryPanelVisibility";
import {
  buildOpenInEditorHandler,
  resolveThreadLocalWorkspaceRootPath,
  resolveThreadWorkspacePreviewRootPath,
} from "./thread-detail/threadWorkspaceOpenPath";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";

const ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY = "bb.promptbox.zen-mode.root-compose";
const ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS = "pt-14";
// Fill the scroll area and center the no-projects welcome both axes.
const ROOT_COMPOSE_EMPTY_WELCOME_CONTENT_CLASS =
  "min-h-full flex-1 items-center justify-center pb-12";
const ROOT_COMPOSE_FIXED_PANEL_STATE_ID = "root-compose";
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];
const FILE_PREVIEW_WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const FILE_PREVIEW_HIGHLIGHTER_OPTIONS = {};

type ProjectSelectionChangeHandler = NewThreadProjectConfig["onChange"];
type SecondaryPanelChangeHandler = (panel: ThreadSecondaryPanelTab) => void;
type NullableSecondaryPanelChangeHandler = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

interface LegacyProjectComposeRedirectProps {
  projectId: string;
}

export function readFolderIdFromLocationState(state: unknown): string | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  if (!("folderId" in state) || typeof state.folderId !== "string") {
    return null;
  }
  const folderId = state.folderId.trim();
  return folderId.length > 0 ? folderId : null;
}

export type RootComposeFolderTarget =
  | { kind: "clear" }
  | { folderId: string; kind: "set" };

export function readRootComposeFolderTargetFromLocationState(
  state: unknown,
): RootComposeFolderTarget | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }

  if ("folderId" in state) {
    const folderId = readFolderIdFromLocationState(state);
    return folderId ? { folderId, kind: "set" } : { kind: "clear" };
  }

  if ("focusPrompt" in state && state.focusPrompt === true) {
    return { kind: "clear" };
  }

  return null;
}

export function shouldStartComposingFromLocationState(state: unknown): boolean {
  if (typeof state !== "object" || state === null) {
    return false;
  }
  return "focusPrompt" in state && state.focusPrompt === true;
}

type RootComposeViewProps =
  | {
      surface: "page";
    }
  | {
      onThreadCreated(args: ThreadRoutePathArgs): void;
      onEscapeEmptyPrompt(): void;
      surface: "popout";
    };

interface BuildMobileRecentThreadsArgs {
  sidebarNavigation: SidebarBootstrapResponse | undefined;
}

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  isProjectless: boolean;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
}

interface ShouldNavigateAfterThreadCreateArgs {
  isForkDraft: boolean;
  navigateToThreadAfterCreate: boolean;
}

interface ResolveRootComposePanelThreadIdArgs {
  environmentId: string | null;
  reuseThreadOptions: readonly ReuseThreadOption[];
}

interface CanCreateRootComposeTerminalArgs {
  terminalTarget: RootComposeTerminalTarget | null;
  environmentStatus: EnvironmentStatus | undefined;
}

type RootComposeTerminalTarget =
  | { kind: "environment"; environmentId: string }
  | { kind: "host_path"; cwd: string | null; hostId: string };

interface BuildRootComposeTerminalSessionsArgs {
  environmentTerminalSessions: readonly TerminalSession[] | undefined;
  globalTerminalSessions: readonly TerminalSession[] | undefined;
  terminalTarget: RootComposeTerminalTarget | null;
}

interface RootComposeRightPanelToggleProps {
  activeTerminalCount: number;
  isOpen: boolean;
  onToggle: () => void;
}

interface RightPanelFileTabIconProps {
  path: string;
}

function RightPanelFileTabIcon({ path }: RightPanelFileTabIconProps) {
  const visual = resolveRightPanelFileVisual({ path });
  return (
    <Icon
      name={visual.iconName}
      className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      aria-hidden
    />
  );
}

function RootComposeRightPanelToggle({
  activeTerminalCount,
  isOpen,
  onToggle,
}: RootComposeRightPanelToggleProps) {
  const renderAsDrawer = useIsCompactViewport();
  const rightPanelLabel = isOpen ? "Hide right panel" : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`${HEADER_ICON_BUTTON_CLASS} relative`}
      aria-label={rightPanelLabel}
      aria-pressed={isOpen}
      title={rightPanelLabel}
      onClick={onToggle}
    >
      <Icon name={rightPanelIconName} />
      {activeTerminalCount > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
        >
          {activeTerminalCount > 9 ? "9+" : activeTerminalCount}
        </span>
      ) : null}
    </Button>
  );
}

// react-router's location.state is freeform unknown — narrow it here at the
// system boundary before reading.
function readReuseEnvironmentIdFromLocationState(
  state: unknown,
): string | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { reuseEnvironmentId?: unknown })
    .reuseEnvironmentId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return null;
}

export function shouldNavigateAfterThreadCreate({
  isForkDraft,
  navigateToThreadAfterCreate,
}: ShouldNavigateAfterThreadCreateArgs): boolean {
  return isForkDraft || navigateToThreadAfterCreate;
}

function readForkThreadCreateSeedFromLocationState(
  state: unknown,
): ForkThreadCreateSeed | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.environmentId !== "string" ||
    value.environmentId.length === 0 ||
    typeof value.model !== "string" ||
    value.model.length === 0 ||
    typeof value.permissionMode !== "string" ||
    value.permissionMode.length === 0 ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.providerId !== "string" ||
    value.providerId.length === 0 ||
    typeof value.reasoningLevel !== "string" ||
    value.reasoningLevel.length === 0 ||
    typeof value.sourceThreadId !== "string" ||
    value.sourceThreadId.length === 0 ||
    typeof value.sourceThreadTitle !== "string" ||
    value.sourceThreadTitle.trim().length === 0
  ) {
    return null;
  }
  if (
    value.serviceTier !== undefined &&
    typeof value.serviceTier !== "string"
  ) {
    return null;
  }
  if (
    value.sourceSeqEnd !== undefined &&
    (typeof value.sourceSeqEnd !== "number" ||
      !Number.isInteger(value.sourceSeqEnd) ||
      value.sourceSeqEnd < 0)
  ) {
    return null;
  }
  return {
    environmentId: value.environmentId,
    model: value.model,
    permissionMode: value.permissionMode as PermissionMode,
    projectId: value.projectId,
    providerId: value.providerId,
    reasoningLevel: value.reasoningLevel as ReasoningLevel,
    serviceTier: value.serviceTier as ServiceTier | undefined,
    sourceSeqEnd: value.sourceSeqEnd as number | undefined,
    sourceThreadId: value.sourceThreadId,
    sourceThreadTitle: value.sourceThreadTitle.trim(),
  };
}

export function hasSingleUseRootComposeTargetState(state: unknown): boolean {
  return (
    readRootComposeFolderTargetFromLocationState(state) !== null ||
    readReuseEnvironmentIdFromLocationState(state) !== null ||
    readForkThreadCreateSeedFromLocationState(state) !== null
  );
}

// react-router's location.state is freeform unknown — narrow it here at the
// system boundary before reading.
export function readInitialPromptFromLocationState(
  state: unknown,
): string | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { initialPrompt?: unknown }).initialPrompt;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return null;
}

function isWorktreeWithEnv(thread: ThreadListEntry): boolean {
  if (thread.environmentId === null) return false;
  return (
    thread.environmentWorkspaceDisplayKind === "managed-worktree" ||
    thread.environmentWorkspaceDisplayKind === "unmanaged-worktree"
  );
}

function buildReuseThreadOptions(
  threads: readonly ThreadListEntry[],
): ReuseThreadOption[] {
  // One option per worktree env. Threads within each env are sorted
  // most-recently-active first so the picker preview surfaces the threads
  // the user is most likely to recognize. Only unarchived threads reach
  // here — `useThreads({ archived: false })` filters at the source. Envs
  // with no unarchived threads naturally drop out.
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  const branchByEnvironmentId = new Map<string, string | null>();
  const nameByEnvironmentId = new Map<string, string | null>();
  for (const thread of threads) {
    if (!isWorktreeWithEnv(thread)) continue;
    if (thread.environmentId === null) continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
      branchByEnvironmentId.set(
        thread.environmentId,
        thread.environmentBranchName,
      );
      nameByEnvironmentId.set(thread.environmentId, thread.environmentName);
    }
    bucket.push(thread);
  }
  const options: ReuseThreadOption[] = [];
  for (const [environmentId, bucket] of threadsByEnvironmentId) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    options.push({
      environmentId,
      branchName: branchByEnvironmentId.get(environmentId) ?? null,
      name: nameByEnvironmentId.get(environmentId) ?? null,
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    const leftLabel = left.name ?? left.branchName;
    const rightLabel = right.name ?? right.branchName;
    if (leftLabel && rightLabel) {
      return leftLabel.localeCompare(rightLabel);
    }
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
}

export function resolveRootComposeEffectiveEnvironmentValue({
  environmentSelectionValue,
  isProjectless,
  primaryHostId,
  projectSources,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
}: ResolveRootComposeEffectiveEnvironmentValueArgs): string {
  if (!primaryHostId) {
    return "";
  }

  const parsedSelection = parseEnvironmentValue(environmentSelectionValue);
  const canUseHostWorkspace =
    isProjectless ||
    findLocalPathProjectSourceForHost(projectSources, primaryHostId) !==
      undefined;
  const fallbackHostValue = canUseHostWorkspace
    ? encodeHostValue(primaryHostId, "local")
    : "";

  if (isProjectless) {
    return fallbackHostValue;
  }

  if (parsedSelection?.type === "reuse") {
    if (parsedSelection.environmentId === null) {
      return reuseThreadOptionsLoading || reuseThreadOptions.length > 0
        ? environmentSelectionValue
        : fallbackHostValue;
    }

    if (reuseThreadOptionsLoading) {
      return REUSE_VALUE_WITHOUT_ENVIRONMENT;
    }

    return reuseThreadOptions.some(
      (option) => option.environmentId === parsedSelection.environmentId,
    )
      ? environmentSelectionValue
      : fallbackHostValue;
  }

  if (!canUseHostWorkspace) {
    return "";
  }

  if (parsedSelection?.type === "host") {
    return encodeHostValue(primaryHostId, parsedSelection.mode);
  }

  return fallbackHostValue;
}

export function buildMobileRecentThreads({
  sidebarNavigation,
}: BuildMobileRecentThreadsArgs): ThreadListEntry[] {
  if (!sidebarNavigation) return [];

  const threads: ThreadListEntry[] = [
    ...sidebarNavigation.personalProject.threads,
  ];
  for (const project of sidebarNavigation.projects) {
    threads.push(...project.threads);
  }
  return threads;
}

export function resolveRootComposePanelThreadId({
  environmentId,
  reuseThreadOptions,
}: ResolveRootComposePanelThreadIdArgs): string | null {
  if (environmentId === null) {
    return null;
  }

  const reuseOption = reuseThreadOptions.find(
    (option) => option.environmentId === environmentId,
  );
  return reuseOption?.threads[0]?.id ?? null;
}

export function canCreateRootComposeTerminal({
  terminalTarget,
  environmentStatus,
}: CanCreateRootComposeTerminalArgs): boolean {
  if (terminalTarget === null) {
    return false;
  }
  if (terminalTarget.kind === "environment") {
    return environmentStatus === "ready";
  }
  return true;
}

export function buildRootComposeTerminalSessions({
  environmentTerminalSessions,
  globalTerminalSessions,
  terminalTarget,
}: BuildRootComposeTerminalSessionsArgs): readonly TerminalSession[] | undefined {
  if (terminalTarget?.kind === "environment") {
    return environmentTerminalSessions;
  }
  if (terminalTarget?.kind === "host_path") {
    return globalTerminalSessions?.filter(
      (session) =>
        session.threadId === null &&
        session.environmentId === null &&
        session.hostId === terminalTarget.hostId &&
        (terminalTarget.cwd === null ||
          session.initialCwd === terminalTarget.cwd),
    );
  }
  return undefined;
}

function LegacyProjectComposeRedirect({
  projectId,
}: LegacyProjectComposeRedirectProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();

  useEffect(() => {
    setRootComposeProjectId(projectId);
    navigate(getRootComposeRoutePath(), {
      replace: true,
      state: location.state,
    });
  }, [location.state, navigate, projectId, setRootComposeProjectId]);

  return (
    <PageShell contentClassName="min-h-full items-center justify-center">
      <p className="py-12 text-center text-sm text-muted-foreground">
        Loading…
      </p>
    </PageShell>
  );
}

interface CodexCliVersionBannerProps {
  currentVersion: string | null;
  minimumSupportedVersion: string | null;
  issue: ProviderCliActionableIssue | null;
  updating: boolean;
  onUpdate: () => void;
}

function CodexCliVersionBanner({
  currentVersion,
  minimumSupportedVersion,
  issue,
  updating,
  onUpdate,
}: CodexCliVersionBannerProps) {
  const minimumVersion = minimumSupportedVersion ?? "a newer version";
  const versionCopy = currentVersion
    ? `Installed ${currentVersion}; required ${minimumVersion} or newer.`
    : `Required ${minimumVersion} or newer.`;
  return (
    <PromptStackCard
      ariaLabel="Codex update needed"
      className="overflow-hidden"
    >
      <div className="flex min-h-8 max-w-full items-center gap-2 px-2.5 py-1 text-xs text-muted-foreground">
        <Icon
          name="Info"
          className="size-3.5 shrink-0 text-subtle-foreground"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">
          Update Codex to start this thread. {versionCopy}
        </span>
        {issue ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 shrink-0 px-2 text-xs"
            disabled={updating}
            onClick={onUpdate}
          >
            {updating ? "Updating" : issue.action.label}
          </Button>
        ) : null}
      </div>
    </PromptStackCard>
  );
}

export function RootComposeRoute() {
  const { projectId } = useParams<{ projectId: string }>();

  if (projectId) {
    return <LegacyProjectComposeRedirect projectId={projectId} />;
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={FILE_PREVIEW_WORKER_POOL_OPTIONS}
      highlighterOptions={FILE_PREVIEW_HIGHLIGHTER_OPTIONS}
    >
      <RootComposeView surface="page" />
    </WorkerPoolContextProvider>
  );
}

export function RootComposeView(props: RootComposeViewProps) {
  const [rootComposeProjectId, setRootComposeProjectId] =
    useRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
  const [rootComposeFolderId, setRootComposeFolderId] = useState<string | null>(
    () => readFolderIdFromLocationState(location.state),
  );
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const quickCreateProject = useQuickCreateProjectController();
  const sidebarNavigationQuery = useSidebarNavigation();
  const hasSidebarNavigationSettled =
    sidebarNavigationQuery.isSuccess || sidebarNavigationQuery.isError;
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const projectId = useMemo(() => {
    if (isProjectlessProjectId(rootComposeProjectId)) {
      return PERSONAL_PROJECT_ID;
    }
    if (!projects) {
      return rootComposeProjectId;
    }
    return projects.some((project) => project.id === rootComposeProjectId)
      ? rootComposeProjectId
      : PERSONAL_PROJECT_ID;
  }, [projects, rootComposeProjectId]);
  const isProjectless = isProjectlessProjectId(projectId);
  useEffect(() => {
    if (!projects) return;
    if (projectId === rootComposeProjectId) return;
    setRootComposeProjectId(projectId);
  }, [projectId, projects, rootComposeProjectId, setRootComposeProjectId]);
  const createThread = useCreateThread();
  const [lastCreatedThreadId, setLastCreatedThreadId] = useState<string | null>(
    null,
  );
  // The no-projects welcome replaces the composer until the user opts in; once
  // they pick "New thread" we reveal the composer for the rest of the session.
  const [startedComposing, setStartedComposing] = useState(() =>
    shouldStartComposingFromLocationState(location.state),
  );
  const [navigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  const [forkSeed, setForkSeed] = useState<ForkThreadCreateSeed | null>(() =>
    readForkThreadCreateSeedFromLocationState(location.state),
  );
  const primaryHostId = usePrimaryHost()?.id ?? null;
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({ kind: "new-thread" });
  const { data: projectPromptHistory = [] } =
    useProjectPromptHistory(projectId);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const prompt = promptDraft.text;
  const promptInput = useMemo(
    () =>
      promptDraftToInput({
        text: promptDraft.text,
        mentions: promptDraft.mentions,
        attachments: promptDraft.attachments,
      }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const rootComposeZenModeStorageKey = useMemo(
    () =>
      getProjectScopedStorageKey(ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY, projectId),
    [projectId],
  );
  const promptHistoryDrafts = useMemo(
    () => promptHistoryEntriesToDrafts(projectPromptHistory),
    [projectPromptHistory],
  );
  const currentProject = useMemo(
    () =>
      isProjectless
        ? sidebarNavigationQuery.data?.personalProject
        : projects?.find((p) => p.id === projectId),
    [isProjectless, projectId, projects, sidebarNavigationQuery.data],
  );
  const projectSources = useMemo(
    () => currentProject?.sources ?? [],
    [currentProject?.sources],
  );
  // Seed the picker from the server-resolved project defaults so the visible
  // default matches what create-thread will use when the user submits without
  // touching execution controls. Values normally ride along with sidebar
  // bootstrap; optimistic sidebar entries use a one-off fallback fetch because
  // their null means "not loaded into this cache entry", not a client default.
  const projectDefaultExecutionOptionsQuery = useProjectDefaultExecutionOptions(
    { projectId },
    {
      enabled:
        currentProject !== undefined &&
        currentProject.defaultExecutionOptions === null,
    },
  );
  const projectDefaultExecutionOptions =
    currentProject?.defaultExecutionOptions ??
    projectDefaultExecutionOptionsQuery.data ??
    null;
  const creationOptions = useThreadCreationOptions({
    scope: "new-thread",
    initialProviderId: projectDefaultExecutionOptions?.providerId,
    initialModel: projectDefaultExecutionOptions?.model,
    initialServiceTier: projectDefaultExecutionOptions?.serviceTier,
    initialReasoningLevel: projectDefaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: projectDefaultExecutionOptions?.permissionMode,
  });
  const {
    selectedProviderId,
    setSelectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderComposerActions,
    selectedModel,
    setSelectedModel,
    serviceTier,
    setServiceTier,
    reasoningLevel,
    setReasoningLevel,
    permissionMode,
    setPermissionMode,
    environmentSelectionValue,
    setEnvironmentSelectionValue,
    clearReuseEnvironment,
    activeModel,
    modelOptions,
    moreModelOptions,
    isLoadingModels,
    modelLoadFailed,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  } = creationOptions;
  const executionInputSources = creationOptions.executionInputSources;
  const providerCliSystemConfig = useSystemConfig();
  const providerCliDaemonPort = isLoopbackOrigin()
    ? (providerCliSystemConfig.data?.hostDaemonPort ?? null)
    : null;
  const providerCliStatus = useLocalProviderCliStatus({
    daemonPort: providerCliDaemonPort,
    enabled: providerCliDaemonPort !== null,
  });
  const refetchProviderCliStatus = providerCliStatus.refetch;
  const {
    installLogDialog: providerCliInstallLogDialog,
    runningProvider,
    startInstall,
  } = useProviderCliInstallRunner({
    daemonPort: providerCliDaemonPort,
    onStatusUpdated: () => {
      void refetchProviderCliStatus();
    },
  });
  const codexCliStatus = providerCliStatus.data?.codex ?? null;
  const isCodexCliVersionBlocked =
    selectedProviderId === "codex" &&
    codexCliStatus?.versionUnsupported === true;
  const codexCliIssue = useMemo(() => {
    if (!isCodexCliVersionBlocked || codexCliStatus === null) {
      return null;
    }
    const issue = buildProviderCliIssue({
      provider: "codex",
      status: codexCliStatus,
    });
    return issue && hasProviderCliAction(issue) ? issue : null;
  }, [codexCliStatus, isCodexCliVersionBlocked]);
  const handleUpdateCodexCli = useCallback(() => {
    if (codexCliIssue === null) {
      return;
    }
    startInstall(codexCliIssue);
  }, [codexCliIssue, startInstall]);

  // Seed transient picker state from navigation state: `reuseEnvironmentId`
  // (the "+" affordance on a worktree) seeds the env picker into reuse mode for
  // that env. A fork seed also pins the first create request to the source
  // thread/environment. This is single-use — clear location.state after applying
  // so a refresh starts from persisted root-compose selection.
  useEffect(() => {
    const folderTarget = readRootComposeFolderTargetFromLocationState(
      location.state,
    );
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const nextForkSeed = readForkThreadCreateSeedFromLocationState(
      location.state,
    );
    if (!hasSingleUseRootComposeTargetState(location.state)) {
      return;
    }
    if (shouldStartComposingFromLocationState(location.state)) {
      setStartedComposing(true);
    }
    if (folderTarget?.kind === "set") {
      setRootComposeFolderId(folderTarget.folderId);
    } else if (folderTarget?.kind === "clear") {
      setRootComposeFolderId(null);
    }
    if (reuseEnvironmentId !== null) {
      setEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (nextForkSeed !== null) {
      setForkSeed(nextForkSeed);
      setSelectedProviderId(nextForkSeed.providerId);
      setSelectedModel(nextForkSeed.model);
      setReasoningLevel(nextForkSeed.reasoningLevel);
      setPermissionMode(nextForkSeed.permissionMode);
      setServiceTier(nextForkSeed.serviceTier);
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: null,
    });
  }, [
    location.search,
    location.state,
    navigate,
    setEnvironmentSelectionValue,
    setPermissionMode,
    setReasoningLevel,
    setSelectedModel,
    setSelectedProviderId,
    setServiceTier,
  ]);

  // Seed the composer from navigation state `initialPrompt` (e.g. "Create via
  // chat" from Automations). Single-use: applied only when the current draft is
  // empty so it never clobbers an in-progress draft, then cleared from
  // location.state so a refresh starts from the persisted draft.
  const seedInitialPrompt = promptDraft.restoreIfEmpty;
  useEffect(() => {
    const initialPrompt = readInitialPromptFromLocationState(location.state);
    if (initialPrompt === null) return;
    seedInitialPrompt({ text: initialPrompt, mentions: [], attachments: [] });
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: { focusPrompt: true },
    });
  }, [location.search, location.state, navigate, seedInitialPrompt]);

  // Worktree picker options come from the project's unarchived threads.
  // Threads on managed or unmanaged worktrees with a non-null environmentId
  // contribute; envs with only archived threads disappear naturally.
  const threadsQuery = useThreads(
    { projectId, archived: false },
    { enabled: Boolean(projectId) },
  );
  const reuseThreadOptions = useMemo(
    () => buildReuseThreadOptions(threadsQuery.data ?? []),
    [threadsQuery.data],
  );
  const mobileRecentThreads = useMemo(
    () =>
      buildMobileRecentThreads({
        sidebarNavigation: sidebarNavigationQuery.data,
      }),
    [sidebarNavigationQuery.data],
  );

  // The stored root-compose environment is global. Resolve it against the
  // selected project before the branch picker or create-thread request sees it.
  const effectiveEnvironmentValue = useMemo(
    () =>
      resolveRootComposeEffectiveEnvironmentValue({
        environmentSelectionValue,
        isProjectless,
        primaryHostId,
        projectSources,
        reuseThreadOptions,
        reuseThreadOptionsLoading: threadsQuery.isLoading,
      }),
    [
      environmentSelectionValue,
      isProjectless,
      primaryHostId,
      projectSources,
      reuseThreadOptions,
      threadsQuery.isLoading,
    ],
  );
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(effectiveEnvironmentValue),
    [effectiveEnvironmentValue],
  );
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  useEffect(() => {
    setBranchSearchQuery("");
  }, [effectiveEnvironmentValue, projectId]);
  const isHostMode = parsedEnvironment?.type === "host";
  const isHostLocalMode = isHostMode && parsedEnvironment.mode === "local";
  const branchEnvironmentMode: RootComposeBranchEnvironmentMode = isProjectless
    ? "other"
    : isHostLocalMode
      ? "local"
      : isHostMode && parsedEnvironment.mode === "worktree"
        ? "worktree"
        : "other";
  const {
    selectedBranch,
    onBranchChange: handleBranchChange,
    onClearBranch: handleClearBranch,
    onCreateBranch: handleCreateBranch,
    onCreateBranchFrom: handleCreateBranchFrom,
  } = useScopedBranchSelection({
    environmentValue: effectiveEnvironmentValue,
    projectId,
  });
  const selectedBranchName = selectedBranch?.name ?? "";
  const hostBranchesQuery = useProjectSourceBranches(
    projectId,
    isHostMode ? parsedEnvironment.hostId : null,
    {
      enabled: isHostMode && !isProjectless,
      query: branchSearchQuery,
      selectedBranch: selectedBranchName,
    },
  );
  const activeBranchesQuery = hostBranchesQuery;
  const branchOptions = useMemo(() => {
    const branches = activeBranchesQuery.data?.branches ?? [];
    const selectedRef = activeBranchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "local" && !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    activeBranchesQuery.data?.branches,
    activeBranchesQuery.data?.selectedBranch,
  ]);
  const remoteBranchOptions = useMemo(() => {
    if (
      branchEnvironmentMode !== "local" &&
      branchEnvironmentMode !== "worktree"
    ) {
      return [];
    }
    const branches = activeBranchesQuery.data?.remoteBranches ?? [];
    const selectedRef = activeBranchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "remote" &&
      !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    activeBranchesQuery.data?.remoteBranches,
    activeBranchesQuery.data?.selectedBranch,
    branchEnvironmentMode,
  ]);
  const priorityBranchOptions = useMemo(
    () =>
      [
        activeBranchesQuery.data?.defaultWorktreeBaseBranch,
        activeBranchesQuery.data?.defaultBranch,
        activeBranchesQuery.data?.originDefaultBranch,
      ].filter((branch): branch is string => Boolean(branch)),
    [
      activeBranchesQuery.data?.defaultBranch,
      activeBranchesQuery.data?.defaultWorktreeBaseBranch,
      activeBranchesQuery.data?.originDefaultBranch,
    ],
  );
  const branchSelectionSeed =
    branchEnvironmentMode === "local" &&
    activeBranchesQuery.data?.checkout.kind === "branch"
      ? activeBranchesQuery.data.checkout.branchName
      : branchEnvironmentMode === "worktree"
        ? (activeBranchesQuery.data?.defaultWorktreeBaseBranch ??
          activeBranchesQuery.data?.defaultBranch ??
          null)
        : null;
  const handleCreateBranchFromSeed = useCallback(() => {
    handleCreateBranch(branchSelectionSeed);
  }, [branchSelectionSeed, handleCreateBranch]);
  const branchUiState = useMemo(
    () =>
      buildRootComposeBranchUiState({
        checkout: activeBranchesQuery.data,
        isFetching: activeBranchesQuery.isFetching,
        isLoading: activeBranchesQuery.isLoading,
        mode: branchEnvironmentMode,
        selectedBranch,
      }),
    [
      activeBranchesQuery.data,
      activeBranchesQuery.isFetching,
      activeBranchesQuery.isLoading,
      branchEnvironmentMode,
      selectedBranch,
    ],
  );
  const refetchSourceBranches = activeBranchesQuery.refetch;
  const handleBranchOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void refetchSourceBranches();
      }
    },
    [refetchSourceBranches],
  );

  const selectedEnvironment = useMemo(
    () =>
      resolveRootComposeThreadEnvironment({
        defaultBranch: activeBranchesQuery.data?.defaultBranch,
        defaultWorktreeBaseBranch:
          activeBranchesQuery.data?.defaultWorktreeBaseBranch,
        environmentValue: effectiveEnvironmentValue,
        projectId,
        selectedBranch,
      }),
    [
      activeBranchesQuery.data?.defaultBranch,
      activeBranchesQuery.data?.defaultWorktreeBaseBranch,
      effectiveEnvironmentValue,
      projectId,
      selectedBranch,
    ],
  );

  const projectOptions = useMemo(
    (): readonly ProjectSelectorOption[] =>
      projects?.map((project) => ({ id: project.id, name: project.name })) ??
      [],
    [projects],
  );
  const mobileRecentProjectNamesById = useMemo(() => {
    const namesById = new Map<string, string>();
    const navigation = sidebarNavigationQuery.data;
    if (!navigation) return namesById;

    namesById.set(
      navigation.personalProject.id,
      navigation.personalProject.name,
    );
    for (const project of navigation.projects) {
      namesById.set(project.id, project.name);
    }
    return namesById;
  }, [sidebarNavigationQuery.data]);

  const selectedThreadModel = activeModel?.model ?? selectedModel;
  const handleProjectChange = useCallback<ProjectSelectionChangeHandler>(
    (nextProjectId) => {
      const nextRootComposeProjectId = nextProjectId ?? PERSONAL_PROJECT_ID;
      if (nextRootComposeProjectId === projectId) return;
      setForkSeed(null);
      setRootComposeProjectId(nextRootComposeProjectId);
    },
    [projectId, setRootComposeProjectId],
  );
  const shouldFocusPrompt =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusPrompt" in location.state &&
    location.state.focusPrompt === true;

  useEffect(() => {
    if (!shouldFocusPrompt) return;
    const handle = window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [location.key, shouldFocusPrompt]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!projectId || files.length === 0) return;

      setAttachmentError(null);
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId,
            file,
          });
          promptDraft.addAttachment(uploaded);
        } catch (err) {
          setAttachmentError(
            getMutationErrorMessage({
              error: err,
              fallbackMessage: "Attachment upload failed",
            }),
          );
          break;
        }
      }
    },
    [projectId, promptDraft, uploadPromptAttachment],
  );

  const submitPrompt = useCallback(async () => {
    const submittedDraft = {
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    };
    const submittedInput = promptDraftToInput(submittedDraft);
    if (!projectId || !selectedProviderId || !selectedThreadModel) {
      return;
    }

    setAttachmentError(null);

    if (
      submittedInput.length === 0 ||
      createThread.isPending ||
      isCodexCliVersionBlocked ||
      (forkSeed === null && !selectedEnvironment)
    ) {
      return;
    }

    try {
      const shouldNavigateToCreatedThread = shouldNavigateAfterThreadCreate({
        isForkDraft: forkSeed !== null,
        navigateToThreadAfterCreate,
      });
      const request =
        forkSeed !== null
          ? buildForkThreadRequest({
              ...forkSeed,
              input: submittedInput,
              model: selectedThreadModel,
              permissionMode,
              reasoningLevel,
              serviceTier: supportsServiceTier ? serviceTier : undefined,
            })
          : selectedEnvironment !== null
            ? {
                input: submittedInput,
                projectId,
                providerId: selectedProviderId,
                model: selectedThreadModel,
                ...(rootComposeFolderId
                  ? { folderId: rootComposeFolderId }
                  : {}),
                ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
                reasoningLevel,
                permissionMode,
                executionInputSources,
                environment: selectedEnvironment,
              }
            : null;
      if (request === null) {
        return;
      }
      const thread = await createThread.mutateAsync(request);
      setLastCreatedThreadId(thread.id);
      clearReuseEnvironment();
      setForkSeed(null);
      setRootComposeFolderId(null);
      promptDraft.clearIfCurrentMatches(submittedDraft);
      if (props.surface === "popout") {
        props.onThreadCreated({
          projectId: thread.projectId,
          threadId: thread.id,
        });
      } else if (shouldNavigateToCreatedThread) {
        navigate(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        );
      }
    } catch {
      // Global mutation error handling already surfaced the failure.
    }
  }, [
    clearReuseEnvironment,
    createThread,
    executionInputSources,
    forkSeed,
    isCodexCliVersionBlocked,
    navigate,
    navigateToThreadAfterCreate,
    permissionMode,
    projectId,
    props,
    promptDraft,
    reasoningLevel,
    rootComposeFolderId,
    selectedEnvironment,
    selectedProviderId,
    selectedThreadModel,
    serviceTier,
    supportsServiceTier,
  ]);

  const isSubmitDisabled =
    !selectedProviderId ||
    isLoadingModels ||
    modelLoadError?.code === "missing_executable" ||
    modelLoadError?.code === "auth_required" ||
    isCodexCliVersionBlocked ||
    !selectedThreadModel ||
    createThread.isPending ||
    promptInput.length === 0 ||
    (forkSeed === null && !selectedEnvironment) ||
    (branchEnvironmentMode === "local" &&
      selectedBranch !== null &&
      branchUiState.mutationBlocker !== null);

  const isPromptEmpty = useCallback(
    () => promptInput.length === 0,
    [promptInput.length],
  );
  const onEscapeEmptyPrompt =
    props.surface === "popout" ? props.onEscapeEmptyPrompt : undefined;
  const hideEmptyPopoutPrompt = useCallback(() => {
    onEscapeEmptyPrompt?.();
  }, [onEscapeEmptyPrompt]);
  useEscapeToHide({
    enabled: props.surface === "popout",
    isEmpty: isPromptEmpty,
    onHide: hideEmptyPopoutPrompt,
  });

  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const historyConfig = useMemo(
    () => ({
      currentDraft: currentPromptDraft,
      entries: promptHistoryDrafts,
      onSelectEntry: promptDraft.setDraft,
      resetKey: projectId,
    }),
    [currentPromptDraft, projectId, promptDraft.setDraft, promptHistoryDrafts],
  );
  // Mirrors the @-mention plumbing: the composer feeds the text typed after the
  // command trigger into `commandQuery`, which drives command typeahead. In
  // projectless compose, the server resolves the personal project to user-home
  // command discovery with cwd: null.
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions),
    [selectedProviderComposerActions],
  );
  const providerPromptActionProps = useMemo(
    () => ({
      promptActions: withLoopPromptAction(providerPromptActions.promptActions),
    }),
    [providerPromptActions.promptActions],
  );
  const reuseEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId: selectedProviderId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    environmentId: reuseEnvironmentId,
    query: commandQuery,
  });
  const rootPanelEnvironmentId = reuseEnvironmentId;
  const rootPanelThreadId = useMemo(() => {
    return resolveRootComposePanelThreadId({
      environmentId: rootPanelEnvironmentId,
      reuseThreadOptions,
    });
  }, [rootPanelEnvironmentId, reuseThreadOptions]);
  const promptMentions = usePromptMentions(
    isProjectless ? undefined : projectId,
    {
      currentThreadId: rootPanelThreadId ?? undefined,
      environmentId: rootPanelEnvironmentId,
    },
  );
  useFixedPanelTabsStorageMaintenance(ROOT_COMPOSE_FIXED_PANEL_STATE_ID);
  const fixedPanelTabsState = useFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const isPersistedSecondaryPanelOpen =
    props.surface === "page" && fixedPanelTabsState.secondary.isOpen;
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const rawActiveRootStorageFileTab =
    activeFixedSecondaryTab?.kind === "thread-storage-file-preview"
      ? activeFixedSecondaryTab
      : null;
  const rawActiveRootStorageFileThreadId =
    rawActiveRootStorageFileTab?.threadId ??
    (rawActiveRootStorageFileTab ? rootPanelThreadId : null);
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const setActiveFixedTerminal = useSetFixedRightTerminalActiveTerminal(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const setRootSecondaryPanel = useSetThreadSecondaryPanelSelection(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  );
  const setRootSecondaryPanelForSurface =
    useCallback<NullableSecondaryPanelChangeHandler>(
      (panel) => {
        if (props.surface !== "page") {
          return;
        }
        setRootSecondaryPanel(panel);
      },
      [props.surface, setRootSecondaryPanel],
    );
  const rootPanelEnvironmentQuery = useEnvironment(rootPanelEnvironmentId, {
    enabled: props.surface === "page" && rootPanelEnvironmentId !== null,
    staleTime: 5_000,
  });
  const rootPanelEnvironment = rootPanelEnvironmentQuery.data;
  const rootPanelHostPathTerminalTarget =
    useMemo<RootComposeTerminalTarget | null>(() => {
      if (rootPanelEnvironmentId !== null) {
        return null;
      }
      const selectedHostId =
        parsedEnvironment?.type === "host"
          ? parsedEnvironment.hostId
          : primaryHostId;
      if (selectedHostId === null) {
        return null;
      }
      const source =
        findLocalPathProjectSourceForHost(projectSources, selectedHostId) ??
        projectSources.find((projectSource) => projectSource.isDefault) ??
        null;
      if (!source) {
        return {
          kind: "host_path",
          hostId: selectedHostId,
          cwd: null,
        };
      }
      return {
        kind: "host_path",
        hostId: source.hostId,
        cwd: source.path,
      };
    }, [
      parsedEnvironment,
      primaryHostId,
      projectSources,
      rootPanelEnvironmentId,
    ]);
  const rootPanelTerminalTarget = useMemo<RootComposeTerminalTarget | null>(
    () =>
      rootPanelEnvironmentId !== null
        ? { kind: "environment", environmentId: rootPanelEnvironmentId }
        : rootPanelHostPathTerminalTarget,
    [rootPanelEnvironmentId, rootPanelHostPathTerminalTarget],
  );
  const {
    threadStorageFiles: rootThreadStorageFiles,
    threadStorageRootPath: rootThreadStorageRootPath,
  } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled: props.surface === "page" && rootPanelThreadId !== null,
    filePreviewEnabled: false,
    threadId: rootPanelThreadId ?? undefined,
  });
  const shouldUseRootStorageViewerForActiveTab =
    rawActiveRootStorageFileThreadId !== null &&
    rawActiveRootStorageFileThreadId === rootPanelThreadId;
  const {
    threadStorageRootPath: activeStorageThreadStorageRootPath,
  } = useThreadStorageViewer({
    activePath: null,
    fileListEnabled:
      props.surface === "page" &&
      rawActiveRootStorageFileThreadId !== null &&
      !shouldUseRootStorageViewerForActiveTab,
    filePreviewEnabled: false,
    threadId:
      rawActiveRootStorageFileThreadId !== null &&
      !shouldUseRootStorageViewerForActiveTab
        ? rawActiveRootStorageFileThreadId
        : undefined,
  });
  const activeStorageFileRootPath = shouldUseRootStorageViewerForActiveTab
    ? rootThreadStorageRootPath
    : activeStorageThreadStorageRootPath;
  const environmentTerminalsListQuery = useEnvironmentTerminals(
    rootPanelEnvironmentId ?? "",
    {
      enabled:
        props.surface === "page" &&
        rootPanelTerminalTarget?.kind === "environment",
    },
  );
  const globalTerminalsListQuery = useTerminals(
    rootPanelTerminalTarget?.kind === "host_path"
      ? {
          kind: "host_path",
          hostId: rootPanelTerminalTarget.hostId,
          ...(rootPanelTerminalTarget.cwd === null
            ? {}
            : { cwd: rootPanelTerminalTarget.cwd }),
        }
      : null,
    {
      enabled:
        props.surface === "page" &&
        rootPanelTerminalTarget?.kind === "host_path",
    },
  );
  const loadedTerminalSessions = useMemo(
    () =>
      buildRootComposeTerminalSessions({
        environmentTerminalSessions: environmentTerminalsListQuery.data?.sessions,
        globalTerminalSessions: globalTerminalsListQuery.data?.sessions,
        terminalTarget: rootPanelTerminalTarget,
      }),
    [
      environmentTerminalsListQuery.data?.sessions,
      globalTerminalsListQuery.data?.sessions,
      rootPanelTerminalTarget,
    ],
  );
  const terminalSessions =
    loadedTerminalSessions ?? EMPTY_TERMINAL_SESSIONS;
  const terminalsListLoaded = loadedTerminalSessions !== undefined;
  const activeTerminalCount = useMemo(
    () =>
      terminalSessions.filter((session) =>
        isActiveTerminalSessionStatus(session.status),
      ).length,
    [terminalSessions],
  );
  const terminalsById = useMemo(
    () => new Map(terminalSessions.map((session) => [session.id, session])),
    [terminalSessions],
  );
  const [newTabFocusRequest, setNewTabFocusRequest] = useState(0);
  const {
    activeHostFileEnvironmentId,
    activeHostFileLineRange,
    activeHostFilePath,
    activeHostFileThreadId,
    activeStorageFileEnvironmentId,
    activeStorageFileLineRange,
    activeStorageFilePath,
    activeStorageFileThreadId,
    activeWorkspaceFileEnvironmentId,
    activeWorkspaceFileLineRange,
    activeWorkspaceFilePath,
    activeWorkspaceFileProjectId,
    activeWorkspaceFileSource,
    activeWorkspaceFileStatusLabel,
    activeBrowserTab,
    browserTabs,
    clearActiveFileTabs,
    activateTab,
    closeTab,
    isNewTabActive,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    threadId:
      props.surface === "page" ? ROOT_COMPOSE_FIXED_PANEL_STATE_ID : null,
    environmentId: rootPanelEnvironmentId,
    fileOwnerThreadId: rootPanelThreadId,
    preserveWorkspaceTabsAcrossContexts: true,
    projectId: isProjectless ? null : projectId,
    storageFiles: rootThreadStorageFiles?.files,
    terminalSessions: loadedTerminalSessions,
  });
  const activeRootHostFileThreadId =
    activeHostFileThreadId ??
    (activeHostFilePath !== null ? rootPanelThreadId : null);
  const activeRootHostFileEnvironmentId =
    activeHostFileEnvironmentId ??
    (activeHostFilePath !== null ? rootPanelEnvironmentId : null);
  const activeRootStorageFileThreadId =
    activeStorageFileThreadId ??
    (activeStorageFilePath !== null ? rootPanelThreadId : null);
  const activeRootStorageFileEnvironmentId =
    activeStorageFileEnvironmentId ??
    (activeStorageFilePath !== null ? rootPanelEnvironmentId : null);
  const syncedOrderedSecondaryFileTabs = useMemo(
    () =>
      loadedTerminalSessions === undefined
        ? orderedSecondaryFileTabs
        : buildTerminalSyncedSecondaryFileTabs({
            orderedTabs: orderedSecondaryFileTabs,
            terminalSessions: loadedTerminalSessions,
          }),
    [loadedTerminalSessions, orderedSecondaryFileTabs],
  );
  useEffect(() => {
    if (!terminalsListLoaded) {
      return;
    }
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        state,
        terminalSessions,
      }),
    );
  }, [terminalSessions, terminalsListLoaded, updateFixedPanelTabsState]);
  const canCreateRootTerminal = canCreateRootComposeTerminal({
    terminalTarget: rootPanelTerminalTarget,
    environmentStatus: rootPanelEnvironment?.status,
  });
  const openPersistedWorkspaceFile = useCallback(
    (file: WorkspaceFileTabState) => {
      openTab({ kind: "workspace-file-preview", tab: file });
    },
    [openTab],
  );
  const openPersistedStorageFile = useCallback(
    (file: ThreadStorageFileTabState) => {
      openTab({ kind: "thread-storage-file-preview", tab: file });
    },
    [openTab],
  );
  const openPersistedHostFile =
    useCallback<ThreadSecondaryPanelHostFileOpenHandler>(
      (file: HostFileTabState) => {
        openTab({ kind: "host-file-preview", tab: file });
      },
      [openTab],
    );
  const closeRootSecondaryPanel = useCallback(() => {
    setRootSecondaryPanelForSurface(null);
  }, [setRootSecondaryPanelForSurface]);
  const openRootSecondaryPanel =
    useCallback<SecondaryPanelChangeHandler>(
      (panel) => {
        setRootSecondaryPanelForSurface(panel);
      },
      [setRootSecondaryPanelForSurface],
    );
  const toggleRootPersistedSecondaryPanel = useCallback(() => {
    if (isPersistedSecondaryPanelOpen) {
      closeRootSecondaryPanel();
      return;
    }
    openTab({ kind: "new-tab" });
  }, [closeRootSecondaryPanel, isPersistedSecondaryPanelOpen, openTab]);
  const {
    closePanel: closeSecondaryPanel,
    isOpen: isSecondaryPanelOpen,
    openCompactDrawer,
    openPanel: openSecondaryPanel,
    openStorageFile,
    openWorkspaceFile,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeRootSecondaryPanel,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    openPersistedCommitDiff: () => undefined,
    openPersistedDiffFile: () => undefined,
    openPersistedDiffPanel: () => undefined,
    openPersistedHostFile,
    openPersistedPanel: openRootSecondaryPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
    surface: props.surface,
    threadId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    togglePersistedPanel: toggleRootPersistedSecondaryPanel,
  });
  // Click handler for inserted mention pills in the root composer: threads
  // navigate, files open the root right-panel preview. Directories and commands
  // stay display-only.
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) => {
      if (resource.kind === "thread") {
        return () =>
          navigate(
            getSurfaceAwareThreadRoutePath({
              projectId: resource.projectId ?? projectId,
              surface: props.surface,
              threadId: resource.threadId,
            }),
          );
      }
      if (resource.kind !== "path" || resource.entryKind !== "file") {
        return null;
      }
      if (resource.source === "thread-storage") {
        if (rootPanelThreadId === null) {
          return null;
        }
        return () =>
          openStorageFile({
            lineRange: null,
            path: resource.path,
          });
      }
      if (isProjectless) {
        return null;
      }
      return () =>
        openWorkspaceFile({
          lineRange: null,
          path: resource.path,
          source: { kind: "working-tree" },
          statusLabel: null,
        });
    },
    [
      isProjectless,
      navigate,
      openStorageFile,
      openWorkspaceFile,
      projectId,
      props.surface,
      rootPanelThreadId,
    ],
  );
  const typeaheadConfig = useMemo(
    () => ({
      mention: {
        suggestions: promptMentions.suggestions,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        trigger: commandSuggestions.trigger,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: setCommandQuery,
      },
    }),
    [
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      resolveMentionLink,
      commandSuggestions.isError,
      commandSuggestions.hasMore,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.trigger,
    ],
  );
  useEffect(() => {
    if (props.surface !== "page" || !isSecondaryPanelOpen) {
      return;
    }
    if (
      activeFixedSecondaryTab !== null &&
      activeFixedSecondaryTab.kind !== "thread-info" &&
      activeFixedSecondaryTab.kind !== "git-diff"
    ) {
      return;
    }
    openTab({ kind: "new-tab" });
  }, [activeFixedSecondaryTab, isSecondaryPanelOpen, openTab, props.surface]);
  const openBrowserTab = useCallback(
    (url?: string) => {
      openTab({ kind: "browser", url: url ?? "" });
    },
    [openTab],
  );
  const openBrowserTabAndReveal = useCallback(
    (url?: string) => {
      if (rootPanelThreadId === null) {
        return;
      }
      openBrowserTab(url);
      openCompactDrawer();
    },
    [openBrowserTab, openCompactDrawer, rootPanelThreadId],
  );
  const handleOpenBrowser = useCallback(() => {
    openBrowserTabAndReveal();
  }, [openBrowserTabAndReveal]);
  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (browserTabIds.has(tabId)) {
          openBrowserTabAndReveal(url);
        }
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (isRoutePath({ path: url })) {
        return;
      }
      openBrowserTabAndReveal(url);
    });
  }, [browserTabIds, openBrowserTabAndReveal]);
  const renderBrowserDeck = useCallback(
    ({
      canShowNativeBrowserView,
    }: {
      canShowNativeBrowserView: boolean;
    }) => {
      if (rootPanelThreadId === null) {
        return null;
      }
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTab?.id ?? null}
          environmentId={rootPanelEnvironmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={rootPanelThreadId}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [
      activeBrowserTab?.id,
      browserTabs,
      rootPanelEnvironmentId,
      rootPanelThreadId,
      updateBrowserTab,
    ],
  );
  const handleSelectFileSearchResult = useCallback(
    (selection: FileSearchSelection) => {
      selectFileSearchResult(selection);
      openCompactDrawer();
    },
    [openCompactDrawer, selectFileSearchResult],
  );
  const handleActivateFileTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
      openCompactDrawer();
    },
    [activateTab, openCompactDrawer],
  );
  const handleOpenNewTab = useCallback(() => {
    openTab({ kind: "new-tab" });
    openCompactDrawer();
    setNewTabFocusRequest((current) => current + 1);
  }, [openCompactDrawer, openTab]);
  const handleToggleSecondaryPanel = useCallback(() => {
    if (isSecondaryPanelOpen) {
      closeSecondaryPanel();
      return;
    }
    handleOpenNewTab();
  }, [closeSecondaryPanel, handleOpenNewTab, isSecondaryPanelOpen]);
  const handleSecondaryPanelChange =
    useCallback<SecondaryPanelChangeHandler>(
      (panel) => {
        clearActiveFileTabs();
        openSecondaryPanel(panel);
      },
      [clearActiveFileTabs, openSecondaryPanel],
    );
  const handleSecondaryPanelFocus = useCallback(() => {
    touchFixedPanelTabsState();
  }, [touchFixedPanelTabsState]);
  const createEnvironmentTerminalMutation = useCreateEnvironmentTerminal();
  const createHostPathTerminalMutation = useCreateTerminal();
  const closeEnvironmentTerminalMutation = useCloseEnvironmentTerminal();
  const closeHostPathTerminalMutation = useCloseTerminal();
  const handleStartTerminal = useCallback(() => {
    if (
      !canCreateRootTerminal ||
      rootPanelTerminalTarget === null ||
      createEnvironmentTerminalMutation.isPending ||
      createHostPathTerminalMutation.isPending
    ) {
      return;
    }
    const newTab = createNewTabFixedPanelTab();
    const createTerminal =
      rootPanelTerminalTarget.kind === "environment"
        ? createEnvironmentTerminalMutation.mutateAsync({
            environmentId: rootPanelTerminalTarget.environmentId,
            cols: DEFAULT_TERMINAL_COLS,
            rows: DEFAULT_TERMINAL_ROWS,
          })
        : createHostPathTerminalMutation.mutateAsync({
            cols: DEFAULT_TERMINAL_COLS,
            rows: DEFAULT_TERMINAL_ROWS,
            target: rootPanelTerminalTarget,
          });
    void createTerminal
      .then((session) => {
        closeTab(newTab.id);
        setActiveFixedTerminal(session.id);
        openCompactDrawer();
      })
      .catch(() => undefined);
  }, [
    canCreateRootTerminal,
    closeTab,
    createEnvironmentTerminalMutation,
    createHostPathTerminalMutation,
    openCompactDrawer,
    rootPanelTerminalTarget,
    setActiveFixedTerminal,
  ]);
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setActiveFixedTerminal(terminalId);
      openCompactDrawer();
    },
    [openCompactDrawer, setActiveFixedTerminal],
  );
  const handleCloseTerminalTab = useCallback(
    (terminalId: string) => {
      if (rootPanelTerminalTarget === null) {
        removeFixedTerminalTab(terminalId);
        return;
      }
      const options = {
        onSuccess: () => {
          removeFixedTerminalTab(terminalId);
        },
      };
      if (rootPanelTerminalTarget.kind === "environment") {
        closeEnvironmentTerminalMutation.mutate(
          {
            mode: "force",
            environmentId: rootPanelTerminalTarget.environmentId,
            terminalId,
          },
          options,
        );
        return;
      }
      closeHostPathTerminalMutation.mutate(
        { mode: "force", terminalId },
        options,
      );
    },
    [
      closeEnvironmentTerminalMutation,
      closeHostPathTerminalMutation,
      removeFixedTerminalTab,
      rootPanelTerminalTarget,
    ],
  );
  const fileTabs = (() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = syncedOrderedSecondaryFileTabs.map(
      (tab): SecondaryPanelFileTab => {
        switch (tab.kind) {
          case "browser": {
            const browserLabel =
              tab.title ??
              (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
            return {
              id: tab.id,
              filename: browserLabel.length > 0 ? browserLabel : "Browser",
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="Globe"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          }
          case "terminal": {
            const session = terminalsById.get(tab.terminalId);
            return {
              id: tab.id,
              filename: session?.title ?? "Terminal",
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="Terminal"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel:
                session === undefined || session.status === "running"
                  ? null
                  : terminalStatusLabel(session),
              onSelect: () => handleActivateTerminalTab(tab.terminalId),
              onClose: () => handleCloseTerminalTab(tab.terminalId),
            };
          }
          case "workspace-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: tab.statusLabel,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "host-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "thread-storage-file-preview":
            return {
              id: tab.id,
              filename: filenameOf(tab.path),
              isActive: tab.id === activeFixedSecondaryTabId,
              isPinned: tab.isPinned,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "new-tab":
            return {
              id: tab.id,
              filename: "New tab",
              isHidden: true,
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="NewTab"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          case "side-chat":
            return {
              id: tab.id,
              filename: tab.title,
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <Icon
                  name="SideChat"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
        }
      },
    );
    return tabs.length > 0 ? tabs : undefined;
  })();
  const { isLocalDaemonHost } = useHostDaemon();
  const activeWorkspaceEnvironmentQuery = useEnvironment(
    activeWorkspaceFileEnvironmentId,
    {
      enabled:
        props.surface === "page" &&
        activeWorkspaceFileEnvironmentId !== null &&
        activeWorkspaceFileEnvironmentId !== rootPanelEnvironmentId,
      staleTime: 5_000,
    },
  );
  const activeWorkspaceEnvironment =
    activeWorkspaceFileEnvironmentId === rootPanelEnvironmentId
      ? rootPanelEnvironment
      : activeWorkspaceEnvironmentQuery.data;
  const activeHostEnvironmentQuery = useEnvironment(
    activeRootHostFileEnvironmentId,
    {
      enabled:
        props.surface === "page" &&
        activeRootHostFileEnvironmentId !== null &&
        activeRootHostFileEnvironmentId !== rootPanelEnvironmentId,
      staleTime: 5_000,
    },
  );
  const activeHostEnvironment =
    activeRootHostFileEnvironmentId === rootPanelEnvironmentId
      ? rootPanelEnvironment
      : activeHostEnvironmentQuery.data;
  const activeStorageEnvironmentQuery = useEnvironment(
    activeRootStorageFileEnvironmentId,
    {
      enabled:
        props.surface === "page" &&
        activeRootStorageFileEnvironmentId !== null &&
        activeRootStorageFileEnvironmentId !== rootPanelEnvironmentId,
      staleTime: 5_000,
    },
  );
  const activeStorageEnvironment =
    activeRootStorageFileEnvironmentId === rootPanelEnvironmentId
      ? rootPanelEnvironment
      : activeStorageEnvironmentQuery.data;
  const activeWorkspaceEnvironmentIsLocal = activeWorkspaceEnvironment
    ? isLocalDaemonHost(activeWorkspaceEnvironment.hostId)
    : false;
  const activeHostEnvironmentIsLocal = activeHostEnvironment
    ? isLocalDaemonHost(activeHostEnvironment.hostId)
    : false;
  const activeStorageEnvironmentIsLocal = activeStorageEnvironment
    ? isLocalDaemonHost(activeStorageEnvironment.hostId)
    : false;
  const activeWorkspaceFileProjectPreviewId =
    activeWorkspaceFilePath !== null && activeWorkspaceFileEnvironmentId === null
      ? (activeWorkspaceFileProjectId ?? projectId)
      : null;
  const localWorkspaceRootPath = resolveThreadLocalWorkspaceRootPath({
    environment: activeWorkspaceEnvironment,
    threadEnvironmentIsLocal: activeWorkspaceEnvironmentIsLocal,
  });
  const workspacePreviewRootPath = resolveThreadWorkspacePreviewRootPath({
    environment: activeWorkspaceEnvironment,
  });
  const activeProjectSources =
    activeWorkspaceFileProjectPreviewId === null
      ? []
      : activeWorkspaceFileProjectPreviewId === projectId
        ? projectSources
        : (projects?.find(
            (project) => project.id === activeWorkspaceFileProjectPreviewId,
          )?.sources ?? []);
  const projectSourcePreviewRootPath =
    activeWorkspaceFileEnvironmentId === null &&
    activeWorkspaceFileProjectPreviewId !== null &&
    primaryHostId !== null
      ? (findLocalPathProjectSourceForHost(activeProjectSources, primaryHostId)
          ?.path ?? null)
      : null;
  const {
    canOpenPreferredFileTarget,
    openPathInPreferredFileTarget,
  } = useLocalOpenTargets({
    enabled:
      activeWorkspaceEnvironmentIsLocal ||
      activeHostEnvironmentIsLocal ||
      activeStorageEnvironmentIsLocal ||
      projectSourcePreviewRootPath !== null,
  });
  const handleOpenWorkspaceFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: localWorkspaceRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      localWorkspaceRootPath,
      openPathInPreferredFileTarget,
    ],
  );
  const handleOpenStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: activeStorageEnvironmentIsLocal
          ? activeStorageFileRootPath
          : null,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      activeStorageEnvironmentIsLocal,
      activeStorageFileRootPath,
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
    ],
  );
  const handleOpenProjectFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: projectSourcePreviewRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      projectSourcePreviewRootPath,
    ],
  );
  const activeRootHostFileLineNumber = getFilePreviewLineRangeStart({
    lineRange: activeHostFileLineRange,
  });
  const handleOpenHostFileInEditor =
    activeHostEnvironmentIsLocal && canOpenPreferredFileTarget
      ? (path: string) => {
          void openPathInPreferredFileTarget({
            lineNumber: activeRootHostFileLineNumber,
            path,
          });
        }
      : undefined;
  const workspaceFileCopyPath = activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: activeWorkspaceFilePath,
        rootPath: workspacePreviewRootPath,
      })
    : null;
  const projectFileCopyPath = activeWorkspaceFilePath
    ? resolveAbsoluteFilePath({
        path: activeWorkspaceFilePath,
        rootPath: projectSourcePreviewRootPath,
      })
    : null;
  const storageFileCopyPath = activeStorageFilePath
    ? resolveAbsoluteFilePath({
        path: activeStorageFilePath,
        rootPath: activeStorageFileRootPath,
      })
    : null;
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();
  const desktopBrowserAvailable = isDesktopBrowserAvailable();
  const handleOpenPanelLink = useCallback<MarkdownPreviewLinkHandler>(
    ({ href }) => {
      if (
        rootPanelThreadId === null ||
        resolveUrlOpenTarget({
          desktopBrowserAvailable,
          openLinksInAppBrowser,
          url: href,
        }) !== "in-app-browser"
      ) {
        return false;
      }
      openBrowserTabAndReveal(href);
      return true;
    },
    [
      desktopBrowserAvailable,
      openBrowserTabAndReveal,
      openLinksInAppBrowser,
      rootPanelThreadId,
    ],
  );
  const activeTerminalId = findActiveTerminalIdInSecondaryFileTabs({
    activeTabId: activeFixedSecondaryTabId,
    tabs: syncedOrderedSecondaryFileTabs,
  });
  const fileTabContent: ReactNode =
    activeTerminalId && rootPanelTerminalTarget ? (
      <ThreadTerminalPanel
        canCreateTerminal={canCreateRootTerminal}
        onOpenLink={handleOpenPanelLink}
        panelStateId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
        target={rootPanelTerminalTarget}
      />
    ) : isNewTabActive ? (
      <NewTabPage
        projectId={isProjectless ? undefined : projectId}
        environmentId={rootPanelEnvironmentId}
        currentThreadId={rootPanelThreadId ?? ""}
        focusRequest={newTabFocusRequest}
        onSelect={handleSelectFileSearchResult}
        recentItemsThreadId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
        onOpenBrowser={rootPanelThreadId ? handleOpenBrowser : undefined}
        onStartTerminal={
          canCreateRootTerminal ? handleStartTerminal : undefined
        }
        showFileSearch={!isProjectless}
      />
    ) : activeWorkspaceFilePath !== null &&
      activeWorkspaceFileEnvironmentId !== null ? (
      <WorkspaceFilePreviewTabContent
        activePath={activeWorkspaceFilePath}
        copyPath={workspaceFileCopyPath}
        environmentId={activeWorkspaceFileEnvironmentId}
        lineRange={activeWorkspaceFileLineRange}
        onOpenInEditor={handleOpenWorkspaceFileInEditor}
        source={activeWorkspaceFileSource}
        statusLabel={activeWorkspaceFileStatusLabel}
        threadId={rootPanelThreadId}
      />
    ) : activeWorkspaceFilePath !== null &&
      activeWorkspaceFileProjectPreviewId !== null ? (
      <ProjectFilePreviewTabContent
        activePath={activeWorkspaceFilePath}
        copyPath={projectFileCopyPath}
        lineRange={activeWorkspaceFileLineRange}
        onOpenInEditor={handleOpenProjectFileInEditor}
        projectId={activeWorkspaceFileProjectPreviewId}
      />
    ) : activeHostFilePath !== null ? (
      activeRootHostFileThreadId && activeRootHostFileEnvironmentId ? (
        <HostFilePreviewTabContent
          activePath={activeHostFilePath}
          copyPath={activeHostFilePath}
          environmentId={activeRootHostFileEnvironmentId}
          lineRange={activeHostFileLineRange}
          onOpenInEditor={handleOpenHostFileInEditor}
          threadId={activeRootHostFileThreadId}
        />
      ) : (
        <FilePreview
          path={activeHostFilePath}
          copyPath={activeHostFilePath}
          onOpenInEditor={handleOpenHostFileInEditor}
          state={{ kind: "loading" }}
        />
      )
    ) : activeStorageFilePath !== null ? (
      activeRootStorageFileThreadId ? (
        <ThreadStorageFilePreviewTabContent
          activePath={activeStorageFilePath}
          copyPath={storageFileCopyPath}
          lineRange={activeStorageFileLineRange}
          onOpenInEditor={handleOpenStorageFileInEditor}
          threadId={activeRootStorageFileThreadId}
        />
      ) : (
        <FilePreview
          path={activeStorageFilePath}
          copyPath={storageFileCopyPath}
          onOpenInEditor={handleOpenStorageFileInEditor}
          state={{ kind: "loading" }}
        />
      )
    ) : undefined;
  const isBrowserTabActive = activeBrowserTab !== null;
  const rootPanelMetadataContent = useMemo(
    () => (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-1">
        <EmptyStatePanel className="rounded-lg">
          No thread details available.
        </EmptyStatePanel>
      </div>
    ),
    [],
  );
  const handleOpenFilePreview = useCallback(
    (relativePath: string) => {
      openWorkspaceFile({
        lineRange: null,
        path: relativePath,
        source: { kind: "working-tree" },
        statusLabel: null,
      });
    },
    [openWorkspaceFile],
  );
  const rootPanelToggle =
    !isSecondaryPanelOpen ? (
      <div className="fixed right-4 top-2 z-40">
        <RootComposeRightPanelToggle
          activeTerminalCount={activeTerminalCount}
          isOpen={isSecondaryPanelOpen}
          onToggle={handleToggleSecondaryPanel}
        />
      </div>
    ) : null;
  const attachmentsConfig = useMemo(
    () => ({
      items: promptDraft.attachments,
      projectId: projectId ?? "",
      onAttachFiles: handleAttachFiles,
      onRemove: promptDraft.removeAttachment,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
    }),
    [
      attachmentError,
      handleAttachFiles,
      projectId,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      uploadPromptAttachment.isPending,
    ],
  );
  const executionConfig = useMemo(
    () => ({
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        onChange: forkSeed === null ? setSelectedProviderId : undefined,
        hasMultiple: hasMultipleProviders,
      },
      model: {
        active: activeModel,
        selected: selectedModel,
        options: modelOptions,
        moreOptions: moreModelOptions,
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        loadError: modelLoadError,
        onChange: setSelectedModel,
      },
      serviceTier: {
        value: serviceTier,
        onChange: setServiceTier,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: setReasoningLevel,
      },
    }),
    [
      activeModel,
      forkSeed,
      hasMultipleProviders,
      isLoadingModels,
      modelLoadFailed,
      modelLoadError,
      modelOptions,
      moreModelOptions,
      providerOptions,
      reasoningLevel,
      reasoningOptions,
      selectedModel,
      selectedProviderId,
      serviceTier,
      serviceTierSupportByProvider,
      setReasoningLevel,
      setSelectedModel,
      setSelectedProviderId,
      setServiceTier,
      supportsServiceTier,
    ],
  );
  const isForkDraft = forkSeed !== null;
  const showEmptyWelcome =
    props.surface === "page" &&
    !isForkDraft &&
    !startedComposing &&
    projects !== undefined &&
    projects.length === 0;
  const handleStartComposing = useCallback(
    (prefill?: string) => {
      if (prefill) {
        promptDraft.setTextAndMentions(prefill, []);
      }
      setStartedComposing(true);
    },
    [promptDraft],
  );
  // Focus the composer once it mounts in place of the welcome screen.
  useEffect(() => {
    if (!startedComposing) return;
    promptBoxRef.current?.focusEnd();
  }, [startedComposing]);
  const environmentConfig = useMemo(
    () => ({
      value: effectiveEnvironmentValue,
      onChange: setEnvironmentSelectionValue,
      sources: projectSources,
      reuseDisabled: reuseThreadOptions.length === 0,
      disabled: isForkDraft,
    }),
    [
      effectiveEnvironmentValue,
      isForkDraft,
      projectSources,
      reuseThreadOptions.length,
      setEnvironmentSelectionValue,
    ],
  );
  const worktreeConfig = useMemo(() => {
    const handleWorktreeChange = (environmentId: string) => {
      setEnvironmentSelectionValue(encodeReuseValue(environmentId));
    };
    return {
      options: reuseThreadOptions,
      value:
        parsedEnvironment?.type === "reuse"
          ? parsedEnvironment.environmentId
          : null,
      onChange: handleWorktreeChange,
      disabled: isForkDraft,
    };
  }, [
    isForkDraft,
    parsedEnvironment,
    reuseThreadOptions,
    setEnvironmentSelectionValue,
  ]);
  const branchConfig = useMemo(
    () => ({
      value:
        selectedBranch?.name ??
        (branchEnvironmentMode === "worktree"
          ? branchUiState.currentBranch
          : null),
      currentBranch: branchUiState.currentBranch,
      isNew: selectedBranch?.isNew ?? false,
      options: branchOptions,
      remoteOptions: remoteBranchOptions,
      priorityOptions: priorityBranchOptions,
      loading: activeBranchesQuery.isFetching,
      placeholder: branchUiState.placeholder,
      triggerLabel: branchUiState.triggerLabel,
      triggerTitle: branchUiState.triggerTitle,
      currentOptionLabel:
        branchEnvironmentMode === "local"
          ? branchUiState.currentOptionLabel
          : null,
      currentOptionTitle:
        branchEnvironmentMode === "local"
          ? (branchUiState.currentOptionLabel ?? undefined)
          : undefined,
      optionDisabledReason: branchUiState.mutationBlocker?.label,
      optionDisabledTitle: branchUiState.mutationBlocker?.title,
      createDisabledReason: branchUiState.mutationBlocker?.label,
      createDisabledTitle: branchUiState.mutationBlocker?.title,
      disabled: isForkDraft,
      onChange: handleBranchChange,
      onClear: handleClearBranch,
      onCreate: handleCreateBranchFromSeed,
      onCreateBaseChange: handleCreateBranchFrom,
      onOpenChange: handleBranchOpenChange,
      onSearchQueryChange: setBranchSearchQuery,
    }),
    [
      activeBranchesQuery.isFetching,
      branchOptions,
      branchEnvironmentMode,
      isForkDraft,
      priorityBranchOptions,
      remoteBranchOptions,
      branchUiState.currentBranch,
      branchUiState.currentOptionLabel,
      branchUiState.mutationBlocker,
      branchUiState.placeholder,
      branchUiState.triggerLabel,
      branchUiState.triggerTitle,
      handleBranchChange,
      handleBranchOpenChange,
      handleClearBranch,
      handleCreateBranchFromSeed,
      handleCreateBranchFrom,
      setBranchSearchQuery,
      selectedBranch?.isNew,
      selectedBranch?.name,
    ],
  );
  const permissionConfig = useMemo(
    () => ({
      value: permissionMode,
      options: permissionModeOptions,
      onChange: setPermissionMode,
      supported: supportsPermissionModeSelection,
    }),
    [
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      supportsPermissionModeSelection,
    ],
  );
  const handleCancelForkDraft = useCallback(() => {
    setForkSeed(null);
    window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
  }, []);

  const promptHeader = useMemo(() => {
    if (forkSeed === null) {
      return null;
    }
    return (
      <div className="flex">
        {/* `-ml-1.5` shifts the pill 6px left so its icon column lines up
            with the prompt controls below the card. */}
        <div
          aria-label={`Forking ${forkSeed.sourceThreadTitle}`}
          title={`Forking ${forkSeed.sourceThreadTitle}`}
          className="-ml-1.5 inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted py-0 pl-2.5 pr-1 text-xs font-medium text-muted-foreground"
        >
          <Icon name="Fork" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Forking {forkSeed.sourceThreadTitle}
          </span>
          <button
            type="button"
            aria-label="Cancel fork"
            title="Cancel fork"
            className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={handleCancelForkDraft}
          >
            <Icon name="X" className="size-3" aria-hidden />
          </button>
        </div>
      </div>
    );
  }, [forkSeed, handleCancelForkDraft]);

  const promptBanner = useMemo(() => {
    if (!isCodexCliVersionBlocked || codexCliStatus === null) {
      return null;
    }
    return (
      <CodexCliVersionBanner
        currentVersion={codexCliStatus.currentVersion}
        minimumSupportedVersion={codexCliStatus.minimumSupportedVersion}
        issue={codexCliIssue}
        updating={runningProvider === "codex"}
        onUpdate={handleUpdateCodexCli}
      />
    );
  }, [
    codexCliIssue,
    codexCliStatus,
    handleUpdateCodexCli,
    isCodexCliVersionBlocked,
    runningProvider,
  ]);

  if (!hasSidebarNavigationSettled) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      </PageShell>
    );
  }
  if (!projects && sidebarNavigationQuery.isError) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          Failed to load projects.
        </p>
      </PageShell>
    );
  }

  const promptBox = (
    <NewThreadPromptBox
      id="root-compose-prompt"
      promptBoxRef={promptBoxRef}
      value={prompt}
      mentionRanges={promptDraft.mentions}
      onChange={promptDraft.setTextAndMentions}
      onSubmit={submitPrompt}
      isSubmitting={createThread.isPending}
      disabled={isSubmitDisabled}
      zenModeStorageKey={rootComposeZenModeStorageKey}
      history={historyConfig}
      typeahead={typeaheadConfig}
      attachments={attachmentsConfig}
      {...providerPromptActionProps}
      modeConfig={{
        environment: environmentConfig,
        branch: branchConfig,
        worktree: worktreeConfig,
        permission: permissionConfig,
        banner: promptBanner,
        header: promptHeader,
      }}
      project={{
        projects: projectOptions,
        value: isProjectless ? null : projectId,
        onChange: handleProjectChange,
        allowNoProject: true,
        createProject: {
          onCreate: quickCreateProject.openCreateDialog,
          disabled:
            !quickCreateProject.isAvailable || quickCreateProject.isCreating,
          isCreating: quickCreateProject.isCreating,
        },
        disabled: isForkDraft,
      }}
      execution={executionConfig}
    />
  );

  if (props.surface === "popout") {
    return (
      <>
        <div className="w-full">{promptBox}</div>
        {providerCliInstallLogDialog}
      </>
    );
  }

  return (
    <>
      {providerCliInstallLogDialog}
      {rootPanelToggle}
      <RootComposeSecondaryContent
        contentClassName={
          showEmptyWelcome
            ? ROOT_COMPOSE_EMPTY_WELCOME_CONTENT_CLASS
            : ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS
        }
        isSecondaryPanelOpen={isSecondaryPanelOpen}
        secondaryPanel={{
          activeTab: activeFixedSecondaryTab,
          canUseGitUi: false,
          environmentId: rootPanelEnvironmentId ?? undefined,
          metadataContent: rootPanelMetadataContent,
          workspaceRootPath:
            rootPanelEnvironment?.path ??
            (rootPanelTerminalTarget?.kind === "host_path"
              ? (rootPanelTerminalTarget.cwd ?? undefined)
              : undefined),
          fileTabs,
          fileTabContent,
          renderBrowserDeck,
          isBrowserTabActive,
          isOpen: isSecondaryPanelOpen,
          showConversationCollapseControl: false,
          showGitDiffTab: false,
          showInfoTab: false,
          showNewTabButton: true,
          onClose: closeSecondaryPanel,
          onCollapse: closeSecondaryPanel,
          onOpenFileInEditor: handleOpenWorkspaceFileInEditor,
          onFileTabReorder: reorderFileTab,
          onOpenNewTab: handleOpenNewTab,
          onOpenFilePreview: handleOpenFilePreview,
          onPanelFocus: handleSecondaryPanelFocus,
          onPanelChange: handleSecondaryPanelChange,
        }}
      >
        {showEmptyWelcome ? (
          <RootComposeEmptyWelcome
            onCompose={handleStartComposing}
            onAddProject={quickCreateProject.openCreateDialog}
            addProjectDisabled={
              !quickCreateProject.isAvailable || quickCreateProject.isCreating
            }
          />
        ) : (
          <>
            {promptBox}
            <RootComposeMobileRecents
              highlightedThreadId={lastCreatedThreadId}
              projectNamesById={mobileRecentProjectNamesById}
              showCreatingRow={createThread.isPending}
              threads={mobileRecentThreads}
            />
          </>
        )}
      </RootComposeSecondaryContent>
    </>
  );
}
