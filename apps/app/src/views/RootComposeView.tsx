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
  type Host,
  PERSONAL_PROJECT_ID,
  type PermissionMode,
  type ProjectExecutionDefaults,
  type PromptInput,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type {
  SidebarBootstrapResponse,
  TerminalSession,
} from "@bb/server-contract";
import {
  NewThreadPromptBox,
  type NewThreadProjectConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import { CodexCliVersionBanner } from "@/components/promptbox/banner/CodexCliVersionBanner";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { withAutomationPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { type PromptBoxHandle } from "@/components/promptbox/PromptBoxInternal";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupCompletion,
  type ProjectMachineSetupDialogTarget,
} from "@/components/dialogs/ProjectMachineSetupDialog";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import {
  HostFilePreviewTabContent,
  ProjectFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/ThreadSecondaryPanelTabContent";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type { BrowserAddressFocusRequest } from "@/components/secondary-panel/BrowserTabContent";
import { NewTabPage } from "@/components/secondary-panel/NewTabPage";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { PageShell } from "@/components/ui/page-shell.js";
import { Button } from "@bb/shared-ui/button";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  PluginPanelTabContent,
  usePluginNewThreadPanelActions,
} from "@/components/plugin/PluginPanelActions";
import { usePluginSlots } from "@/lib/plugin-slots";
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
  useHostProviderCliStatus,
  useSystemConfig,
} from "@/hooks/queries/system-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { selectPrimaryHost, useHosts } from "@/hooks/queries/host-queries";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import {
  requestComposerFocus,
  subscribeComposerFocusRequests,
} from "@/lib/composer-focus-requests";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { useComposerTextEffects } from "@/lib/composer-text-effects";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { sdk } from "@/lib/sdk";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import {
  arePromptDraftStatesEqual,
  getProjectStoredPromptAttachmentPaths,
  isPromptDraftEmpty,
  promptDraftToInput,
  type PromptDraftAttachment,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import {
  buildForkThreadRequest,
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  type ForkThreadCreateSeed,
} from "@/lib/fork-thread-request";
import {
  buildThreadHandoffPromptDraft,
  readThreadHandoffCreateSeedFromLocationState,
} from "@/lib/thread-handoff-request";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import {
  getThreadRoutePath,
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  isRoutePath,
  isProjectlessProjectId,
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
import {
  ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS,
  RootComposeSecondaryContent,
} from "./RootComposeSecondaryContent";
import {
  buildRootComposeBranchUiState,
  type RootComposeBranchEnvironmentMode,
} from "./root-compose-branch-ui";
import {
  resolveRootComposeThreadEnvironment,
  type RootComposeSelectedBranch,
} from "./root-compose-thread-environment";
import { useScopedBranchSelection } from "./root-compose-branch-selection";
import {
  buildReuseThreadOptions,
  isProjectSourceWorktreeUnavailable,
  PROJECT_SOURCE_WORKTREE_DISABLED_REASON,
  resolveComposeHostId,
  resolveRootComposeEffectiveEnvironmentValue,
  resolveRootComposeProjectRouting,
  resolveRootComposeProviderRouting,
} from "./root-compose-environment-selection";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";
import { RootComposeEmptyWelcome } from "./RootComposeEmptyWelcome";
import { useThreadStorageViewer } from "@/components/secondary-panel/useThreadStorageViewer";
import {
  useThreadFileTabs,
  type FileSearchSelection,
} from "@/components/secondary-panel/useThreadFileTabs";
import { isSecondaryFileTab } from "@/components/secondary-panel/secondaryPanelTabState";
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
  getRetainedTerminalTabId,
  syncTerminalTabsInFixedPanelState,
} from "@/components/secondary-panel/terminalPanelTabs";
import {
  getActiveFixedSecondaryTab,
  useSetThreadSecondaryPanelSelection,
} from "./thread-detail/threadSecondaryPanelSelection";
import {
  useThreadSecondaryPanelDrawerVisibility,
  useThreadSecondaryPanelVisibility,
} from "./thread-detail/useThreadSecondaryPanelVisibility";
import type { ThreadSecondaryPanelHostFileOpenHandler } from "./thread-detail/useThreadSecondaryPanelVisibility";
import {
  buildOpenInEditorHandler,
  resolveEnvironmentOpenContext,
  resolveThreadWorkspacePreviewRootPath,
} from "./thread-detail/threadWorkspaceOpenPath";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useOptionalPaneContext } from "./thread-detail/PaneContext";
import { RootComposePanelCommandHandlers } from "./RootComposePanelCommandHandlers";

const ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY = "bb.promptbox.zen-mode.root-compose";
const ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS = "pt-14";

function resolveHostOpenContext(args: {
  hostId: string | null;
  isLocal: boolean;
  serverOrigin: string;
}): OpenInTargetContext | null {
  if (args.hostId === null) {
    return null;
  }
  if (args.isLocal) {
    return { kind: "local" };
  }
  return {
    kind: "remote-ssh",
    serverOrigin: args.serverOrigin,
    hostId: args.hostId,
  };
}
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

export function mergeMissingPromptDraftAttachments(
  currentAttachments: readonly PromptDraftAttachment[],
  preservedAttachments: readonly PromptDraftAttachment[],
): PromptDraftAttachment[] | null {
  const existingPaths = new Set(
    currentAttachments.map((attachment) => attachment.path),
  );
  const missingAttachments = preservedAttachments.filter(
    (attachment) => !existingPaths.has(attachment.path),
  );
  if (missingAttachments.length === 0) {
    return null;
  }
  return [...currentAttachments, ...missingAttachments];
}

export function restorePromptDraftAfterOptionChange({
  currentDraft,
  preservedDraft,
}: {
  currentDraft: PromptDraftState;
  preservedDraft: PromptDraftState | null;
}): PromptDraftState | null {
  if (preservedDraft === null) {
    return null;
  }
  if (arePromptDraftStatesEqual(currentDraft, preservedDraft)) {
    return null;
  }

  let restoredDraft = currentDraft;
  let changed = false;

  if (isPromptDraftEmpty(currentDraft) && !isPromptDraftEmpty(preservedDraft)) {
    restoredDraft = preservedDraft;
    changed = true;
  } else if (
    currentDraft.text === preservedDraft.text &&
    currentDraft.mentions !== preservedDraft.mentions &&
    JSON.stringify(currentDraft.mentions) !==
      JSON.stringify(preservedDraft.mentions)
  ) {
    restoredDraft = {
      ...restoredDraft,
      mentions: preservedDraft.mentions,
    };
    changed = true;
  }

  const mergedAttachments = mergeMissingPromptDraftAttachments(
    restoredDraft.attachments,
    preservedDraft.attachments,
  );
  if (mergedAttachments !== null) {
    restoredDraft = {
      ...restoredDraft,
      attachments: mergedAttachments,
    };
    changed = true;
  }

  return changed ? restoredDraft : null;
}

export function hasPromptOptionValueChanged<T>(
  currentValue: T,
  nextValue: T,
): boolean {
  return !Object.is(currentValue, nextValue);
}

export function hasPromptBranchSelectionChanged(
  currentBranch: RootComposeSelectedBranch | null,
  nextBranch: RootComposeSelectedBranch | null,
): boolean {
  if (currentBranch === null || nextBranch === null) {
    return currentBranch !== nextBranch;
  }
  return (
    currentBranch.name !== nextBranch.name ||
    currentBranch.isNew !== nextBranch.isNew
  );
}

interface LegacyProjectComposeRedirectProps {
  projectId: string;
}

export function readSectionIdFromLocationState(state: unknown): string | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }
  if (!("sectionId" in state) || typeof state.sectionId !== "string") {
    return null;
  }
  const sectionId = state.sectionId.trim();
  return sectionId.length > 0 ? sectionId : null;
}

export type RootComposeSectionTarget =
  | { kind: "clear" }
  | { sectionId: string; kind: "set" };

export function readRootComposeSectionTargetFromLocationState(
  state: unknown,
): RootComposeSectionTarget | null {
  if (typeof state !== "object" || state === null) {
    return null;
  }

  if ("sectionId" in state) {
    const sectionId = readSectionIdFromLocationState(state);
    return sectionId ? { sectionId, kind: "set" } : { kind: "clear" };
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

export function requestRootComposePluginFocus(storageKey: string | null): void {
  requestComposerFocus(storageKey);
}

interface BuildMobileRecentThreadsArgs {
  sidebarNavigation: SidebarBootstrapResponse | undefined;
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
  connectedHostIds: ReadonlySet<string>;
  environmentHostId: string | null | undefined;
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
  isOpen: boolean;
  onToggle: () => void;
}

export function resolveRootComposePanelTogglePlacement(args: {
  isHosted: boolean;
  isOpen: boolean;
}): {
  inlinePanelToggle: "button" | "reserved";
  showPinnedToggle: boolean;
} {
  if (args.isHosted) {
    return { inlinePanelToggle: "button", showPinnedToggle: false };
  }
  return {
    inlinePanelToggle: "button",
    showPinnedToggle: !args.isOpen,
  };
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

export function RootComposeRightPanelToggle({
  isOpen,
  onToggle,
}: RootComposeRightPanelToggleProps) {
  const renderAsDrawer = useIsCompactViewport();
  const shortcut = useAppCommandShortcut("panel.toggle");
  const rightPanelLabel = isOpen ? "Hide right panel" : "Show right panel";
  const rightPanelIconName = renderAsDrawer ? "PanelBottom" : "PanelRight";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={`${HEADER_ICON_BUTTON_CLASS} relative`}
      aria-label={
        shortcut ? `${rightPanelLabel} (${shortcut.label})` : rightPanelLabel
      }
      aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
      aria-expanded={isOpen}
      onClick={onToggle}
    >
      <Icon name={rightPanelIconName} />
      <AppCommandShortcutHint
        shortcut={shortcut}
        className="absolute right-full mr-1"
      />
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
  // History state can outlive a release. The deprecated "workspace-write"
  // alias maps onto the same workspace sandbox as "accept-edits"; legacy
  // "readonly" (or any unknown value) invalidates the seed rather than being
  // silently reinterpreted as a writable mode.
  const seedPermissionMode =
    value.permissionMode === "workspace-write"
      ? "accept-edits"
      : value.permissionMode === "accept-edits" ||
          value.permissionMode === "auto" ||
          value.permissionMode === "full"
        ? value.permissionMode
        : null;
  if (seedPermissionMode === null) {
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
    permissionMode: seedPermissionMode,
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
    readRootComposeSectionTargetFromLocationState(state) !== null ||
    readReuseEnvironmentIdFromLocationState(state) !== null ||
    readForkThreadCreateSeedFromLocationState(state) !== null ||
    readThreadHandoffCreateSeedFromLocationState(state) !== null
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

export function shouldReplaceInitialPromptFromLocationState(
  state: unknown,
): boolean {
  return (
    state !== null &&
    typeof state === "object" &&
    "replaceInitialPrompt" in state &&
    state.replaceInitialPrompt === true
  );
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
  connectedHostIds,
  environmentHostId,
  terminalTarget,
  environmentStatus,
}: CanCreateRootComposeTerminalArgs): boolean {
  if (terminalTarget === null) {
    return false;
  }
  if (terminalTarget.kind === "environment") {
    return (
      environmentStatus === "ready" &&
      environmentHostId !== null &&
      environmentHostId !== undefined &&
      connectedHostIds.has(environmentHostId)
    );
  }
  return connectedHostIds.has(terminalTarget.hostId);
}

export function buildRootComposeTerminalSessions({
  environmentTerminalSessions,
  globalTerminalSessions,
  terminalTarget,
}: BuildRootComposeTerminalSessionsArgs):
  | readonly TerminalSession[]
  | undefined {
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

export function LegacyProjectComposeRedirect({
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
      <RootComposeView />
    </WorkerPoolContextProvider>
  );
}

type RootComposeProjectDefaultsState =
  | { status: "pending" }
  | { status: "error" }
  | {
      status: "resolved";
      defaults: ProjectExecutionDefaults | null;
    };

interface ResolveRootComposeProjectDefaultsStateArgs {
  cachedDefaults: ProjectExecutionDefaults | null | undefined;
  projectFound: boolean;
  queryData: ProjectExecutionDefaults | null | undefined;
  queryIsError: boolean;
  queryIsPlaceholderData: boolean;
  queryIsSuccess: boolean;
}

export function resolveRootComposeProjectDefaultsState({
  cachedDefaults,
  projectFound,
  queryData,
  queryIsError,
  queryIsPlaceholderData,
  queryIsSuccess,
}: ResolveRootComposeProjectDefaultsStateArgs): RootComposeProjectDefaultsState {
  if (cachedDefaults !== null && cachedDefaults !== undefined) {
    return { status: "resolved", defaults: cachedDefaults };
  }
  if (!projectFound) {
    return { status: "pending" };
  }
  if (queryIsSuccess && !queryIsPlaceholderData) {
    return { status: "resolved", defaults: queryData ?? null };
  }
  return queryIsError ? { status: "error" } : { status: "pending" };
}

export function RootComposeView() {
  const paneContext = useOptionalPaneContext();
  const isFocusedPane = paneContext?.isFocused ?? true;
  const [rootComposeProjectId, setRootComposeProjectId] =
    useRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
  const isPointerCoarse = usePointerCoarse();
  const [rootComposeSectionId, setRootComposeSectionId] = useState<
    string | null
  >(() => readSectionIdFromLocationState(location.state));
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
  const hostsQuery = useHosts();
  const connectedHostIds = useMemo(
    () =>
      new Set(
        (hostsQuery.data ?? [])
          .filter((host) => host.status === "connected")
          .map((host) => host.id),
      ),
    [hostsQuery.data],
  );
  const systemConfigQuery = useSystemConfig();
  const serverPrimaryHostId = systemConfigQuery.data?.primaryHostId ?? null;
  const primaryHost = useMemo(
    () => selectPrimaryHost(hostsQuery.data, serverPrimaryHostId),
    [hostsQuery.data, serverPrimaryHostId],
  );
  const primaryHostId = primaryHost?.id ?? null;
  const knownHostIds = useMemo(
    () => new Set((hostsQuery.data ?? []).map((host) => host.id)),
    [hostsQuery.data],
  );
  // Worktree rows only carry a machine hint once there's more than one
  // machine to tell apart.
  const worktreeHostNameById = useMemo(() => {
    const hosts = hostsQuery.data ?? [];
    if (hosts.length <= 1) return null;
    return new Map(hosts.map((host) => [host.id, host.name]));
  }, [hostsQuery.data]);
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({ kind: "new-thread" });
  const promptTextEffects = useComposerTextEffects(promptDraft.storageKey);
  // Plugin useComposer() writes (from nav panels / homepage sections) target
  // the new-thread draft; surface + focus the composer when they ask.
  useEffect(
    () =>
      subscribeComposerFocusRequests(promptDraft.storageKey, () => {
        setStartedComposing(true);
        window.requestAnimationFrame(() => {
          promptBoxRef.current?.focusEnd();
        });
      }),
    [promptDraft.storageKey],
  );
  const handleRootPanelSelectionAddToChat = useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) => {
      promptDraft.addQuote(text, attachments);
      setStartedComposing(true);
      window.requestAnimationFrame(() => {
        promptBoxRef.current?.focusEnd();
      });
    },
    [promptDraft],
  );
  const promptOptionDraftSnapshotRef = useRef<PromptDraftState | null>(null);
  const { data: projectPromptHistory = [] } =
    useProjectPromptHistory(projectId);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isCopyingPromptAttachments, setIsCopyingPromptAttachments] =
    useState(false);
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
  const pluginComposerHost = useMemo<PluginComposerHost>(
    () => ({
      scope: { kind: "new-thread", projectId },
      draft: {
        text: promptDraft.text,
        mentions: promptDraft.mentions,
        attachments: promptDraft.attachments,
      },
      textEffectKey: promptDraft.storageKey,
      getCurrent: promptDraft.getCurrent,
      setDraft: promptDraft.setDraft,
      focus: () => requestRootComposePluginFocus(promptDraft.storageKey),
    }),
    [
      projectId,
      promptDraft.attachments,
      promptDraft.getCurrent,
      promptDraft.mentions,
      promptDraft.setDraft,
      promptDraft.storageKey,
      promptDraft.text,
    ],
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
  // Worktree picker options come from the project's unarchived threads.
  // Threads on managed or unmanaged worktrees with a non-null environmentId
  // contribute; envs with only archived threads disappear naturally.
  const threadsQuery = useThreads(
    { projectId, archived: false },
    { enabled: Boolean(projectId) },
  );
  const reuseThreadOptions = useMemo(
    () =>
      buildReuseThreadOptions(threadsQuery.data ?? [], worktreeHostNameById),
    [threadsQuery.data, worktreeHostNameById],
  );
  const resolveProviderRouting = useCallback(
    (environmentSelectionValue: string) =>
      resolveRootComposeProviderRouting({
        environmentSelectionValue,
        isProjectless,
        knownHostIds,
        primaryHostId,
        projectSources,
        reuseThreadOptions,
        reuseThreadOptionsLoading: threadsQuery.isLoading,
      }),
    [
      isProjectless,
      knownHostIds,
      primaryHostId,
      projectSources,
      reuseThreadOptions,
      threadsQuery.isLoading,
    ],
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
  const projectDefaultsState = resolveRootComposeProjectDefaultsState({
    cachedDefaults: currentProject?.defaultExecutionOptions,
    projectFound: currentProject !== undefined,
    queryData: projectDefaultExecutionOptionsQuery.data,
    queryIsError: projectDefaultExecutionOptionsQuery.isError,
    queryIsPlaceholderData:
      projectDefaultExecutionOptionsQuery.isPlaceholderData,
    queryIsSuccess: projectDefaultExecutionOptionsQuery.isSuccess,
  });
  const projectDefaultExecutionOptions =
    projectDefaultsState.status === "resolved"
      ? projectDefaultsState.defaults
      : undefined;
  const creationOptions = useThreadCreationOptions({
    scope: "new-thread",
    preferenceProjectId: projectId,
    resolveProviderRouting,
    // Without a saved project default, fall back to an agent the user is
    // actually signed in to. The raw provider catalog is a fixed list, so
    // `providers[0]` would always be Codex — wrong for anyone who only has,
    // say, Claude Code connected.
    initialProviderId: projectDefaultExecutionOptions?.providerId,
    preferConnectedProviderWhenUnset:
      forkSeed === null && projectDefaultExecutionOptions === null,
    initialModel: projectDefaultExecutionOptions?.model,
    initialServiceTier: projectDefaultExecutionOptions?.serviceTier,
    initialReasoningLevel: projectDefaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: projectDefaultExecutionOptions?.permissionMode,
  });
  const {
    executionOptionsRouting,
    selectedProviderId,
    setSelectedProviderId,
    setProviderModelReasoning,
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
    isResolvingInitialProvider,
    modelLoadFailed,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  } = creationOptions;
  const executionInputSources = creationOptions.executionInputSources;
  const projectDefaultsUnavailable =
    forkSeed === null && projectDefaultsState.status !== "resolved";
  const snapshotPromptDraftBeforeOptionChange = useCallback(() => {
    const currentDraft = promptDraft.getCurrent();
    promptOptionDraftSnapshotRef.current = isPromptDraftEmpty(currentDraft)
      ? null
      : currentDraft;
  }, [promptDraft]);
  const handleSelectedProviderIdChange = useCallback(
    (nextProviderId: string) => {
      if (!hasPromptOptionValueChanged(selectedProviderId, nextProviderId)) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setSelectedProviderId(nextProviderId);
    },
    [
      selectedProviderId,
      setSelectedProviderId,
      snapshotPromptDraftBeforeOptionChange,
    ],
  );
  const handleSelectedModelChange = useCallback(
    (nextModel: string) => {
      if (!hasPromptOptionValueChanged(selectedModel, nextModel)) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setSelectedModel(nextModel);
    },
    [selectedModel, setSelectedModel, snapshotPromptDraftBeforeOptionChange],
  );
  const handleServiceTierChange = useCallback(
    (nextServiceTier: ServiceTier | undefined) => {
      if (!hasPromptOptionValueChanged(serviceTier, nextServiceTier)) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setServiceTier(nextServiceTier);
    },
    [serviceTier, setServiceTier, snapshotPromptDraftBeforeOptionChange],
  );
  const handleReasoningLevelChange = useCallback(
    (nextReasoningLevel: ReasoningLevel) => {
      if (!hasPromptOptionValueChanged(reasoningLevel, nextReasoningLevel)) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setReasoningLevel(nextReasoningLevel);
    },
    [reasoningLevel, setReasoningLevel, snapshotPromptDraftBeforeOptionChange],
  );
  const handlePermissionModeChange = useCallback(
    (nextPermissionMode: PermissionMode) => {
      if (!hasPromptOptionValueChanged(permissionMode, nextPermissionMode)) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setPermissionMode(nextPermissionMode);
    },
    [permissionMode, setPermissionMode, snapshotPromptDraftBeforeOptionChange],
  );
  const handleEnvironmentSelectionValueChange = useCallback(
    (nextEnvironmentValue: string) => {
      if (
        !hasPromptOptionValueChanged(
          environmentSelectionValue,
          nextEnvironmentValue,
        )
      ) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      setEnvironmentSelectionValue(nextEnvironmentValue);
    },
    [
      environmentSelectionValue,
      setEnvironmentSelectionValue,
      snapshotPromptDraftBeforeOptionChange,
    ],
  );
  useEffect(() => {
    const preservedDraft = promptOptionDraftSnapshotRef.current;
    if (preservedDraft === null) {
      return;
    }

    promptOptionDraftSnapshotRef.current = null;
    const restoredDraft = restorePromptDraftAfterOptionChange({
      currentDraft: promptDraft.getCurrent(),
      preservedDraft,
    });
    if (restoredDraft === null) {
      return;
    }

    promptDraft.setDraft(restoredDraft);
  });
  const seedHandoffPrompt = promptDraft.setDraft;

  // Seed transient picker state from navigation state: `reuseEnvironmentId`
  // (the "+" affordance on a worktree) seeds the env picker into reuse mode for
  // that env. A fork seed also pins the first create request to the source
  // thread/environment. This is single-use — clear location.state after applying
  // so a refresh starts from persisted root-compose selection.
  useEffect(() => {
    const sectionTarget = readRootComposeSectionTargetFromLocationState(
      location.state,
    );
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const nextForkSeed = readForkThreadCreateSeedFromLocationState(
      location.state,
    );
    const nextHandoffSeed = readThreadHandoffCreateSeedFromLocationState(
      location.state,
    );
    if (!hasSingleUseRootComposeTargetState(location.state)) {
      return;
    }
    if (shouldStartComposingFromLocationState(location.state)) {
      setStartedComposing(true);
    }
    if (sectionTarget?.kind === "set") {
      setRootComposeSectionId(sectionTarget.sectionId);
    } else if (sectionTarget?.kind === "clear") {
      setRootComposeSectionId(null);
    }
    if (reuseEnvironmentId !== null) {
      setEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (nextForkSeed !== null && nextHandoffSeed === null) {
      setForkSeed(nextForkSeed);
      setProviderModelReasoning(nextForkSeed);
      setPermissionMode(nextForkSeed.permissionMode);
      setServiceTier(nextForkSeed.serviceTier);
    }
    if (nextHandoffSeed !== null) {
      setStartedComposing(true);
      setRootComposeProjectId(nextHandoffSeed.projectId);
      setForkSeed(null);
      if (nextHandoffSeed.environmentId !== null) {
        setEnvironmentSelectionValue(
          encodeReuseValue(nextHandoffSeed.environmentId),
        );
      }
      seedHandoffPrompt(buildThreadHandoffPromptDraft(nextHandoffSeed));
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: null,
    });
  }, [
    location.search,
    location.state,
    navigate,
    seedHandoffPrompt,
    setEnvironmentSelectionValue,
    setPermissionMode,
    setProviderModelReasoning,
    setRootComposeProjectId,
    setServiceTier,
  ]);

  // Seed the composer from navigation state `initialPrompt`. Single-use:
  // applied only when the current draft is empty so it never clobbers an
  // in-progress draft, then cleared from
  // location.state so a refresh starts from the persisted draft.
  const seedInitialPrompt = promptDraft.restoreIfEmpty;
  const replaceInitialPrompt = promptDraft.setDraft;
  useEffect(() => {
    const initialPrompt = readInitialPromptFromLocationState(location.state);
    if (initialPrompt === null) return;
    const nextDraft = { text: initialPrompt, mentions: [], attachments: [] };
    if (shouldReplaceInitialPromptFromLocationState(location.state)) {
      replaceInitialPrompt(nextDraft);
    } else {
      seedInitialPrompt(nextDraft);
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: { focusPrompt: true },
    });
  }, [
    location.search,
    location.state,
    navigate,
    replaceInitialPrompt,
    seedInitialPrompt,
  ]);

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
        knownHostIds,
        primaryHostId,
        projectSources,
        reuseThreadOptions,
        reuseThreadOptionsLoading: threadsQuery.isLoading,
      }),
    [
      environmentSelectionValue,
      isProjectless,
      knownHostIds,
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
  // Provider-CLI eligibility follows the machine the thread will actually run
  // on — the selected host when the effective selection names one, otherwise
  // the primary. An outdated
  // CLI on the primary must not block submission to a healthy remote machine,
  // nor the other way around.
  const composeHostId = resolveComposeHostId(parsedEnvironment, primaryHostId);
  const providerCliStatus = useHostProviderCliStatus({
    hostId: composeHostId,
    enabled: composeHostId !== null,
  });
  const { queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();
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
    if (codexCliIssue === null || composeHostId === null) {
      return;
    }
    startInstall({ hostId: composeHostId, issue: codexCliIssue });
  }, [codexCliIssue, composeHostId, startInstall]);
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
  const canChangeBranchSelection =
    projectId !== undefined && effectiveEnvironmentValue !== "";
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
  const projectSourceWorktreeUnavailable = isProjectSourceWorktreeUnavailable(
    activeBranchesQuery.data,
  );
  const selectedEnvironmentRequestsManagedWorktree =
    parsedEnvironment?.type === "host" && parsedEnvironment.mode === "worktree";
  const managedWorktreeAvailabilityPending =
    selectedEnvironmentRequestsManagedWorktree &&
    !isProjectless &&
    activeBranchesQuery.isLoading;
  const managedWorktreeUnavailable =
    selectedEnvironmentRequestsManagedWorktree &&
    projectSourceWorktreeUnavailable;
  useEffect(() => {
    if (
      !projectSourceWorktreeUnavailable ||
      parsedEnvironment?.type !== "host" ||
      parsedEnvironment.mode !== "worktree"
    ) {
      return;
    }
    setEnvironmentSelectionValue(
      encodeHostValue(parsedEnvironment.hostId, "local"),
    );
  }, [
    parsedEnvironment,
    projectSourceWorktreeUnavailable,
    setEnvironmentSelectionValue,
  ]);
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
  const handlePromptBoxBranchChange = useCallback(
    (branch: string) => {
      const nextBranch: RootComposeSelectedBranch = {
        name: branch,
        isNew: false,
      };
      if (
        !canChangeBranchSelection ||
        !hasPromptBranchSelectionChanged(selectedBranch, nextBranch)
      ) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      handleBranchChange(branch);
    },
    [
      canChangeBranchSelection,
      handleBranchChange,
      selectedBranch,
      snapshotPromptDraftBeforeOptionChange,
    ],
  );
  const handlePromptBoxClearBranch = useCallback(() => {
    if (
      !canChangeBranchSelection ||
      !hasPromptBranchSelectionChanged(selectedBranch, null)
    ) {
      return;
    }
    snapshotPromptDraftBeforeOptionChange();
    handleClearBranch();
  }, [
    canChangeBranchSelection,
    handleClearBranch,
    selectedBranch,
    snapshotPromptDraftBeforeOptionChange,
  ]);
  const handlePromptBoxCreateBranchFromSeed = useCallback(() => {
    const branchName = selectedBranch?.name ?? branchSelectionSeed;
    const nextBranch =
      branchName === null
        ? null
        : {
            name: branchName,
            isNew: true,
          };
    if (
      !canChangeBranchSelection ||
      !hasPromptBranchSelectionChanged(selectedBranch, nextBranch)
    ) {
      return;
    }
    snapshotPromptDraftBeforeOptionChange();
    handleCreateBranchFromSeed();
  }, [
    branchSelectionSeed,
    canChangeBranchSelection,
    handleCreateBranchFromSeed,
    selectedBranch,
    snapshotPromptDraftBeforeOptionChange,
  ]);
  const handlePromptBoxCreateBranchFrom = useCallback(
    (branch: string) => {
      const nextBranch: RootComposeSelectedBranch = {
        name: branch,
        isNew: true,
      };
      if (
        !canChangeBranchSelection ||
        !hasPromptBranchSelectionChanged(selectedBranch, nextBranch)
      ) {
        return;
      }
      snapshotPromptDraftBeforeOptionChange();
      handleCreateBranchFrom(branch);
    },
    [
      canChangeBranchSelection,
      handleCreateBranchFrom,
      selectedBranch,
      snapshotPromptDraftBeforeOptionChange,
    ],
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
    async (nextProjectId) => {
      const nextRootComposeProjectId = nextProjectId ?? PERSONAL_PROJECT_ID;
      if (
        nextRootComposeProjectId === projectId ||
        isCopyingPromptAttachments
      ) {
        return;
      }

      const attachmentPaths = getProjectStoredPromptAttachmentPaths(
        promptDraft.getCurrent().attachments,
      );
      if (attachmentPaths.length > 0) {
        setAttachmentError(null);
        setIsCopyingPromptAttachments(true);
        try {
          await sdk.projects.attachments.copy({
            projectId: nextRootComposeProjectId,
            sourceProjectId: projectId,
            paths: attachmentPaths,
          });
        } catch (error) {
          setAttachmentError(
            getMutationErrorMessage({
              error,
              fallbackMessage:
                "Attachments could not be moved to the selected project",
            }),
          );
          return;
        } finally {
          setIsCopyingPromptAttachments(false);
        }
      }

      snapshotPromptDraftBeforeOptionChange();
      setForkSeed(null);
      setRootComposeProjectId(nextRootComposeProjectId);
    },
    [
      isCopyingPromptAttachments,
      projectId,
      promptDraft,
      setRootComposeProjectId,
      snapshotPromptDraftBeforeOptionChange,
    ],
  );
  const shouldFocusPrompt =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusPrompt" in location.state &&
    location.state.focusPrompt === true;

  useEffect(() => {
    if (!shouldFocusPrompt) return;
    if (isPointerCoarse) return;
    const handle = window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isPointerCoarse, location.key, shouldFocusPrompt]);

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

  // `inputsOverride` bypasses the draft: plugin slash-command `{ send }`
  // results (design §4.9) submit through the same thread-creation path
  // without touching what the user has typed.
  const submitPromptInternal = useCallback(
    async (inputsOverride: PromptInput[] | null) => {
      const submittedDraft =
        inputsOverride === null
          ? {
              text: promptDraft.text,
              mentions: promptDraft.mentions,
              attachments: promptDraft.attachments,
            }
          : null;
      const submittedInput =
        submittedDraft !== null
          ? promptDraftToInput(submittedDraft)
          : (inputsOverride ?? []);
      if (!projectId || !selectedProviderId || !selectedThreadModel) {
        return;
      }

      setAttachmentError(null);

      if (
        submittedInput.length === 0 ||
        createThread.isPending ||
        projectDefaultsUnavailable ||
        isResolvingInitialProvider ||
        isCodexCliVersionBlocked ||
        managedWorktreeAvailabilityPending ||
        managedWorktreeUnavailable ||
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
                  ...(rootComposeSectionId
                    ? { sectionId: rootComposeSectionId }
                    : {}),
                  ...(supportsServiceTier && serviceTier
                    ? { serviceTier }
                    : {}),
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
        setRootComposeSectionId(null);
        if (submittedDraft !== null) {
          promptDraft.clearIfCurrentMatches(submittedDraft);
        }
        if (shouldNavigateToCreatedThread) {
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
    },
    [
      clearReuseEnvironment,
      createThread,
      executionInputSources,
      forkSeed,
      isCodexCliVersionBlocked,
      managedWorktreeAvailabilityPending,
      managedWorktreeUnavailable,
      navigate,
      navigateToThreadAfterCreate,
      permissionMode,
      projectDefaultsUnavailable,
      projectId,
      promptDraft,
      reasoningLevel,
      rootComposeSectionId,
      isResolvingInitialProvider,
      selectedEnvironment,
      selectedProviderId,
      selectedThreadModel,
      serviceTier,
      supportsServiceTier,
    ],
  );

  const submitPrompt = useCallback(
    () => submitPromptInternal(null),
    [submitPromptInternal],
  );

  const isSubmitDisabled =
    !selectedProviderId ||
    isLoadingModels ||
    modelLoadError?.code === "missing_executable" ||
    modelLoadError?.code === "auth_required" ||
    isCodexCliVersionBlocked ||
    !selectedThreadModel ||
    createThread.isPending ||
    projectDefaultsUnavailable ||
    isResolvingInitialProvider ||
    isCopyingPromptAttachments ||
    promptInput.length === 0 ||
    (forkSeed === null && !selectedEnvironment) ||
    managedWorktreeAvailabilityPending ||
    managedWorktreeUnavailable ||
    (branchEnvironmentMode === "local" &&
      selectedBranch !== null &&
      branchUiState.mutationBlocker !== null);

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
      promptActions: withAutomationPromptAction(
        providerPromptActions.promptActions,
      ),
    }),
    [providerPromptActions.promptActions],
  );
  const reuseEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const rootProjectRouting = resolveRootComposeProjectRouting(
    parsedEnvironment,
    primaryHostId,
  );
  const rootProjectHostId = rootProjectRouting.hostId ?? null;
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId: selectedProviderId,
    commandScope: "new-thread",
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions: providerPromptActionProps.promptActions,
    environmentId: reuseEnvironmentId,
    hostId: rootProjectHostId,
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
      hostId: rootProjectHostId,
    },
  );
  useFixedPanelTabsStorageMaintenance(ROOT_COMPOSE_FIXED_PANEL_STATE_ID);
  const fixedPanelTabsState = useFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  const isPersistedSecondaryPanelOpen = fixedPanelTabsState.secondary.isOpen;
  const activeFixedSecondaryTab = getActiveFixedSecondaryTab({
    fixedPanelTabsState,
  });
  const retainedTerminalId = useMemo(
    () =>
      getRetainedTerminalTabId({
        activeTab: activeFixedSecondaryTab,
        isPanelOpen: isPersistedSecondaryPanelOpen,
      }),
    [activeFixedSecondaryTab, isPersistedSecondaryPanelOpen],
  );
  const activeFixedSecondaryTabId = activeFixedSecondaryTab?.id ?? null;
  const rawActiveRootStorageFileTab =
    activeFixedSecondaryTab?.kind === "thread-storage-file-preview"
      ? activeFixedSecondaryTab
      : null;
  const rawActiveRootStorageFileThreadId =
    rawActiveRootStorageFileTab?.threadId ??
    (rawActiveRootStorageFileTab ? rootPanelThreadId : null);
  const renderSecondaryPanelAsDrawer = useIsCompactViewport();
  const secondaryPanelDrawerVisibility =
    useThreadSecondaryPanelDrawerVisibility({
      isCompactViewport: renderSecondaryPanelAsDrawer,
      threadId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    });
  const isSecondaryPanelOpen = renderSecondaryPanelAsDrawer
    ? secondaryPanelDrawerVisibility.isDrawerVisible
    : isPersistedSecondaryPanelOpen;
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  const updateFixedPanelTabsState = useUpdateFixedPanelTabsState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  const setActiveFixedTerminal = useSetFixedRightTerminalActiveTerminal(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  // Route-driven panel remounts are passive. Explicit terminal actions keep
  // this request pending until the asynchronously mounted xterm handles it.
  const [shouldAutoFocusTerminal, setShouldAutoFocusTerminal] = useState(false);
  const handleTerminalAutoFocusHandled = useCallback(
    () => setShouldAutoFocusTerminal(false),
    [],
  );
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  const setRootSecondaryPanel = useSetThreadSecondaryPanelSelection(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
  );
  const setRootSecondaryPanelForSurface =
    useCallback<NullableSecondaryPanelChangeHandler>(
      (panel) => setRootSecondaryPanel(panel),
      [setRootSecondaryPanel],
    );
  const rootPanelEnvironmentQuery = useEnvironment(rootPanelEnvironmentId, {
    enabled: rootPanelEnvironmentId !== null,
    staleTime: 5_000,
  });
  const rootPanelEnvironment = rootPanelEnvironmentQuery.data;
  const rootPanelHostPathTerminalTarget =
    useMemo<RootComposeTerminalTarget | null>(() => {
      if (rootPanelEnvironmentId !== null) {
        return null;
      }
      const selectedHostId = resolveComposeHostId(
        parsedEnvironment,
        primaryHostId,
      );
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
    fileListEnabled: rootPanelThreadId !== null,
    filePreviewEnabled: false,
    threadId: rootPanelThreadId ?? undefined,
  });
  const shouldUseRootStorageViewerForActiveTab =
    rawActiveRootStorageFileThreadId !== null &&
    rawActiveRootStorageFileThreadId === rootPanelThreadId;
  const { threadStorageRootPath: activeStorageThreadStorageRootPath } =
    useThreadStorageViewer({
      activePath: null,
      fileListEnabled:
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
        isSecondaryPanelOpen && rootPanelTerminalTarget?.kind === "environment",
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
        isSecondaryPanelOpen && rootPanelTerminalTarget?.kind === "host_path",
    },
  );
  const loadedTerminalSessions = useMemo(
    () =>
      buildRootComposeTerminalSessions({
        environmentTerminalSessions:
          environmentTerminalsListQuery.data?.sessions,
        globalTerminalSessions: globalTerminalsListQuery.data?.sessions,
        terminalTarget: rootPanelTerminalTarget,
      }),
    [
      environmentTerminalsListQuery.data?.sessions,
      globalTerminalsListQuery.data?.sessions,
      rootPanelTerminalTarget,
    ],
  );
  const terminalSessions = loadedTerminalSessions ?? EMPTY_TERMINAL_SESSIONS;
  const terminalsListLoaded = loadedTerminalSessions !== undefined;
  const terminalsById = useMemo(
    () => new Map(terminalSessions.map((session) => [session.id, session])),
    [terminalSessions],
  );
  const [shouldAutoFocusNewTab, setShouldAutoFocusNewTab] = useState(false);
  const handleNewTabAutoFocusHandled = useCallback(
    () => setShouldAutoFocusNewTab(false),
    [],
  );
  const [browserAddressFocusRequest, setBrowserAddressFocusRequest] =
    useState<BrowserAddressFocusRequest | null>(null);
  const { newThreadPanelActions: rootPanelNewThreadPanelActions } =
    usePluginSlots();
  const {
    activePluginPanelTab,
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
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs,
    reorderFileTab,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    syncThreadId: null,
    environmentId: rootPanelEnvironmentId,
    fileOwnerThreadId: rootPanelThreadId,
    preserveWorkspaceTabsAcrossContexts: true,
    projectId: isProjectless ? null : projectId,
    retainedTerminalId,
    storageFiles: rootThreadStorageFiles?.files,
    terminalSessions: loadedTerminalSessions,
  });
  const rootPluginPanelActions = usePluginNewThreadPanelActions({
    openPluginPanel,
    projectId: isProjectless ? null : projectId,
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
            retainedTerminalId,
            terminalSessions: loadedTerminalSessions,
          }),
    [loadedTerminalSessions, orderedSecondaryFileTabs, retainedTerminalId],
  );
  useEffect(() => {
    if (!terminalsListLoaded) {
      return;
    }
    updateFixedPanelTabsState((state) =>
      syncTerminalTabsInFixedPanelState({
        retainedTerminalId,
        state,
        terminalSessions,
      }),
    );
  }, [
    retainedTerminalId,
    terminalSessions,
    terminalsListLoaded,
    updateFixedPanelTabsState,
  ]);
  const canCreateRootTerminal = canCreateRootComposeTerminal({
    connectedHostIds,
    environmentHostId: rootPanelEnvironment?.hostId,
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
  const openRootSecondaryPanel = useCallback<SecondaryPanelChangeHandler>(
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
    openCompactDrawer,
    openPanel: openSecondaryPanel,
    openStorageFile,
    openWorkspaceFile,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeRootSecondaryPanel,
    drawerVisibility: secondaryPanelDrawerVisibility,
    isCompactViewport: renderSecondaryPanelAsDrawer,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    openPersistedCommitDiff: () => undefined,
    openPersistedDiffFile: () => undefined,
    openPersistedDiffPanel: () => undefined,
    openPersistedHostFile,
    openPersistedPanel: openRootSecondaryPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
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
            getThreadRoutePath({
              projectId: resource.projectId ?? projectId,
              threadId: resource.threadId,
            }),
          );
      }
      if (resource.kind === "project") {
        return () => navigate(getProjectComposeRoutePath(resource.projectId));
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
      rootPanelThreadId,
    ],
  );
  const typeaheadConfig = useMemo(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
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
      promptMentions.triggers,
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
    if (!isSecondaryPanelOpen) {
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
  }, [activeFixedSecondaryTab, isSecondaryPanelOpen, openTab]);
  const openBrowserTab = useCallback(
    (url?: string) => {
      const browserUrl = url ?? "";
      const tab = openTab({ kind: "browser", url: browserUrl });
      if (browserUrl.length === 0 && tab?.kind === "browser") {
        setBrowserAddressFocusRequest((current) => ({
          requestId: (current?.requestId ?? 0) + 1,
          tabId: tab.id,
        }));
      }
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
  const handleBrowserAddressFocusRequestConsumed = useCallback(
    (request: BrowserAddressFocusRequest) => {
      setBrowserAddressFocusRequest((current) =>
        current?.requestId === request.requestId &&
        current.tabId === request.tabId
          ? null
          : current,
      );
    },
    [],
  );
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
    ({ canShowNativeBrowserView }: { canShowNativeBrowserView: boolean }) => {
      if (rootPanelThreadId === null) {
        return null;
      }
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTab?.id ?? null}
          addressFocusRequest={browserAddressFocusRequest}
          onAddressFocusRequestConsumed={
            handleBrowserAddressFocusRequestConsumed
          }
          environmentId={rootPanelEnvironmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={rootPanelThreadId}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [
      activeBrowserTab?.id,
      browserAddressFocusRequest,
      browserTabs,
      handleBrowserAddressFocusRequestConsumed,
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
    setShouldAutoFocusNewTab(true);
  }, [openCompactDrawer, openTab]);
  useAppCommandHandler("panel.newTab", () => {
    if (!isFocusedPane) return false;
    handleOpenNewTab();
    return true;
  });
  useAppCommandHandler("file.quickOpen", () => {
    if (!isFocusedPane) return false;
    handleOpenNewTab();
    return true;
  });
  const handleToggleSecondaryPanel = useCallback(() => {
    if (isSecondaryPanelOpen) {
      closeSecondaryPanel();
      return;
    }
    handleOpenNewTab();
  }, [closeSecondaryPanel, handleOpenNewTab, isSecondaryPanelOpen]);
  const handleSecondaryPanelChange = useCallback<SecondaryPanelChangeHandler>(
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
        setShouldAutoFocusTerminal(true);
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
  useAppCommandHandler("terminal.open", () => {
    if (
      !isFocusedPane ||
      !canCreateRootTerminal ||
      rootPanelTerminalTarget === null ||
      createEnvironmentTerminalMutation.isPending ||
      createHostPathTerminalMutation.isPending
    ) {
      return false;
    }
    handleStartTerminal();
    return true;
  });
  const handleActivateTerminalTab = useCallback(
    (terminalId: string) => {
      setShouldAutoFocusTerminal(true);
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
  const handleCloseWindowRequest = useCallback(() => {
    // Gate on the visible panel state, not the persisted flag: on compact
    // viewports the drawer can be dismissed while tabs stay persisted, and
    // Cmd+W must not consume hidden tabs.
    if (!isSecondaryPanelOpen) {
      return false;
    }
    if (
      activeFixedSecondaryTab !== null &&
      isSecondaryFileTab(activeFixedSecondaryTab)
    ) {
      // A lone new-tab placeholder respawns on close (an effect reopens one
      // whenever the panel would otherwise be empty), so hide the panel
      // instead of churning the placeholder.
      if (
        activeFixedSecondaryTab.kind === "new-tab" &&
        fixedPanelTabsState.secondary.tabs.length === 1
      ) {
        closeSecondaryPanel();
        return true;
      }
      if (activeFixedSecondaryTab.kind === "terminal") {
        handleCloseTerminalTab(activeFixedSecondaryTab.terminalId);
      } else {
        closeTab(activeFixedSecondaryTab.id);
      }
      return true;
    }
    // No closable tab is active: hide the panel before letting the next
    // Cmd+W close the window.
    closeSecondaryPanel();
    return true;
  }, [
    activeFixedSecondaryTab,
    closeSecondaryPanel,
    closeTab,
    fixedPanelTabsState.secondary.tabs,
    handleCloseTerminalTab,
    isSecondaryPanelOpen,
  ]);
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
          case "plugin-panel": {
            const actionIcon =
              rootPanelNewThreadPanelActions.find(
                (action) =>
                  action.pluginId === tab.pluginId &&
                  action.id === tab.actionId,
              )?.icon ?? null;
            return {
              id: tab.id,
              filename: tab.title,
              isActive: tab.id === activeFixedSecondaryTabId,
              leadingVisual: (
                <PluginIcon
                  pluginId={tab.pluginId}
                  icon={actionIcon}
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
              onClose: () => closeTab(tab.id),
            };
          }
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
    activeWorkspaceFilePath !== null &&
    activeWorkspaceFileEnvironmentId === null
      ? (activeWorkspaceFileProjectId ?? projectId)
      : null;
  const serverOrigin = window.location.origin;
  const activeWorkspaceOpenContext = resolveEnvironmentOpenContext({
    environment: activeWorkspaceEnvironment,
    threadEnvironmentIsLocal: activeWorkspaceEnvironmentIsLocal,
    serverOrigin,
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
    activeWorkspaceFileProjectPreviewId !== null
      ? rootPanelEnvironmentId !== null
        ? (rootPanelEnvironment?.path ?? null)
        : rootProjectHostId !== null
          ? (findLocalPathProjectSourceForHost(
              activeProjectSources,
              rootProjectHostId,
            )?.path ?? null)
          : null
      : null;
  const projectSourcePreviewHostId =
    projectSourcePreviewRootPath === null
      ? null
      : (rootPanelEnvironment?.hostId ?? rootProjectHostId);
  const projectSourceOpenContext = resolveHostOpenContext({
    hostId: projectSourcePreviewHostId,
    isLocal: isLocalDaemonHost(projectSourcePreviewHostId),
    serverOrigin,
  });
  const activeHostOpenContext = resolveEnvironmentOpenContext({
    environment: activeHostEnvironment,
    threadEnvironmentIsLocal: activeHostEnvironmentIsLocal,
    serverOrigin,
  });
  const activeStorageOpenContext = resolveEnvironmentOpenContext({
    environment: activeStorageEnvironment,
    threadEnvironmentIsLocal: activeStorageEnvironmentIsLocal,
    serverOrigin,
  });
  const activeOpenContext =
    activeWorkspaceFilePath !== null &&
    activeWorkspaceFileEnvironmentId !== null
      ? activeWorkspaceOpenContext
      : activeWorkspaceFilePath !== null &&
          activeWorkspaceFileProjectPreviewId !== null
        ? projectSourceOpenContext
        : activeHostFilePath !== null
          ? activeHostOpenContext
          : activeStorageFilePath !== null
            ? activeStorageOpenContext
            : null;
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({
      enabled: activeOpenContext !== null,
      ...(activeOpenContext ? { openContext: activeOpenContext } : {}),
    });
  const handleOpenWorkspaceFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: workspacePreviewRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
      canOpenPreferredFileTarget,
      openPathInPreferredFileTarget,
      workspacePreviewRootPath,
    ],
  );
  const handleOpenStorageFileInEditor = useMemo(
    () =>
      buildOpenInEditorHandler({
        rootPath: activeStorageFileRootPath,
        canOpenPreferredTarget: canOpenPreferredFileTarget,
        openInPreferredTarget: openPathInPreferredFileTarget,
      }),
    [
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
  const handleOpenHostFileInEditor = canOpenPreferredFileTarget
    ? (path: string) => {
        void openPathInPreferredFileTarget({
          lineNumber: activeRootHostFileLineNumber,
          path,
        });
      }
    : undefined;
  useAppCommandHandler("workspace.openPreferred", () => {
    if (!isFocusedPane) return false;
    if (
      activeWorkspaceFilePath !== null &&
      activeWorkspaceFileEnvironmentId !== null &&
      handleOpenWorkspaceFileInEditor
    ) {
      handleOpenWorkspaceFileInEditor(activeWorkspaceFilePath);
      return true;
    }
    if (
      activeWorkspaceFilePath !== null &&
      activeWorkspaceFileProjectPreviewId !== null &&
      handleOpenProjectFileInEditor
    ) {
      handleOpenProjectFileInEditor(activeWorkspaceFilePath);
      return true;
    }
    if (activeHostFilePath !== null && handleOpenHostFileInEditor) {
      handleOpenHostFileInEditor(activeHostFilePath);
      return true;
    }
    if (activeStorageFilePath !== null && handleOpenStorageFileInEditor) {
      handleOpenStorageFileInEditor(activeStorageFilePath);
      return true;
    }
    return false;
  });
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
        autoFocus={shouldAutoFocusTerminal}
        canCreateTerminal={canCreateRootTerminal}
        isPanelOpen={isSecondaryPanelOpen}
        isPanelPersistedOpen={isPersistedSecondaryPanelOpen}
        onAutoFocusHandled={handleTerminalAutoFocusHandled}
        onOpenLink={handleOpenPanelLink}
        onSelectionAddToChat={handleRootPanelSelectionAddToChat}
        panelStateId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
        target={rootPanelTerminalTarget}
      />
    ) : isNewTabActive ? (
      <NewTabPage
        autoFocus={shouldAutoFocusNewTab}
        projectId={isProjectless ? undefined : projectId}
        environmentId={rootPanelEnvironmentId}
        hostId={rootProjectHostId}
        currentThreadId={rootPanelThreadId ?? ""}
        onAutoFocusHandled={handleNewTabAutoFocusHandled}
        onSelect={handleSelectFileSearchResult}
        recentItemsThreadId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
        onOpenBrowser={rootPanelThreadId ? handleOpenBrowser : undefined}
        onStartTerminal={
          canCreateRootTerminal ? handleStartTerminal : undefined
        }
        pluginActions={rootPluginPanelActions}
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
        onSelectionAddToChat={handleRootPanelSelectionAddToChat}
        source={activeWorkspaceFileSource}
        statusLabel={activeWorkspaceFileStatusLabel}
        threadId={rootPanelThreadId}
      />
    ) : activeWorkspaceFilePath !== null &&
      activeWorkspaceFileProjectPreviewId !== null ? (
      <ProjectFilePreviewTabContent
        activePath={activeWorkspaceFilePath}
        copyPath={projectFileCopyPath}
        environmentId={rootPanelEnvironmentId}
        hostId={rootProjectHostId}
        lineRange={activeWorkspaceFileLineRange}
        onOpenInEditor={handleOpenProjectFileInEditor}
        onSelectionAddToChat={handleRootPanelSelectionAddToChat}
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
          onSelectionAddToChat={handleRootPanelSelectionAddToChat}
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
          onSelectionAddToChat={handleRootPanelSelectionAddToChat}
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
    ) : activePluginPanelTab ? (
      <PluginPanelTabContent
        tab={activePluginPanelTab}
        context={{
          kind: "new-thread",
          projectId: isProjectless ? null : projectId,
        }}
      />
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
  // Standalone compose keeps its panel toggle pinned to the viewport corner.
  // Multi-pane compose publishes its panel model to SplitThreadArea instead,
  // which owns the one stable window-level toggle.
  // The shared position class keeps this footprint paired with the no-drag
  // cutout the macOS window-drag strip carves for it while the panel is closed
  // (see RootComposeSecondaryContent).
  const panelTogglePositionClassName =
    ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS;
  const panelTogglePlacement = resolveRootComposePanelTogglePlacement({
    isHosted: (paneContext?.secondaryPanelHost ?? null) !== null,
    isOpen: isSecondaryPanelOpen,
  });
  const rootPanelToggle = panelTogglePlacement.showPinnedToggle ? (
    <div className={`fixed z-40 ${panelTogglePositionClassName}`}>
      <RootComposeRightPanelToggle
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
      isAttaching:
        uploadPromptAttachment.isPending || isCopyingPromptAttachments,
      error: attachmentError,
    }),
    [
      attachmentError,
      handleAttachFiles,
      projectId,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      isCopyingPromptAttachments,
      uploadPromptAttachment.isPending,
    ],
  );
  const executionConfig = useMemo(
    () => ({
      providerRouting: executionOptionsRouting,
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        onChange:
          forkSeed === null ? handleSelectedProviderIdChange : undefined,
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
        onChange: handleSelectedModelChange,
      },
      serviceTier: {
        value: serviceTier,
        onChange: handleServiceTierChange,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: handleReasoningLevelChange,
      },
    }),
    [
      activeModel,
      executionOptionsRouting,
      forkSeed,
      hasMultipleProviders,
      handleSelectedProviderIdChange,
      handleReasoningLevelChange,
      handleSelectedModelChange,
      handleServiceTierChange,
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
      supportsServiceTier,
    ],
  );
  const isForkDraft = forkSeed !== null;
  const showEmptyWelcome =
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
    if (isCodexCliVersionBlocked) return;
    if (isPointerCoarse) return;
    const handle = window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isCodexCliVersionBlocked, isPointerCoarse, startedComposing]);
  const [machineSetupTarget, setMachineSetupTarget] =
    useState<ProjectMachineSetupDialogTarget | null>(null);
  const currentProjectName = currentProject?.name ?? null;
  const currentProjectGitRemoteUrl = currentProject?.gitRemoteUrl ?? null;
  const handleRequestMachineSetup = useCallback(
    (setupHost: Host) => {
      if (!projectId || currentProjectName === null) return;
      setMachineSetupTarget({
        projectId,
        projectName: currentProjectName,
        gitRemoteUrl: currentProjectGitRemoteUrl,
        hostId: setupHost.id,
        hostName: setupHost.name,
      });
    },
    [currentProjectGitRemoteUrl, currentProjectName, projectId],
  );
  const handleMachineSetupComplete = useCallback(
    ({ hostId: setUpHostId }: ProjectMachineSetupCompletion) => {
      setMachineSetupTarget(null);
      // Mirror a normal selection of that machine: prefer worktree mode; the
      // non-git downgrade effect above falls back to local work if the new
      // source's checkout doesn't support worktrees.
      handleEnvironmentSelectionValueChange(
        encodeHostValue(setUpHostId, "worktree"),
      );
    },
    [handleEnvironmentSelectionValueChange],
  );
  const environmentConfig = useMemo(
    () => ({
      value: effectiveEnvironmentValue,
      onChange: handleEnvironmentSelectionValueChange,
      sources: projectSources,
      reuseDisabled: reuseThreadOptions.length === 0,
      worktreeDisabledReason: projectSourceWorktreeUnavailable
        ? PROJECT_SOURCE_WORKTREE_DISABLED_REASON
        : null,
      disabled: isForkDraft,
      ...(isProjectless
        ? {}
        : { onRequestMachineSetup: handleRequestMachineSetup }),
    }),
    [
      effectiveEnvironmentValue,
      isForkDraft,
      isProjectless,
      handleEnvironmentSelectionValueChange,
      handleRequestMachineSetup,
      projectSourceWorktreeUnavailable,
      projectSources,
      reuseThreadOptions.length,
    ],
  );
  const worktreeConfig = useMemo(() => {
    const handleWorktreeChange = (environmentId: string) => {
      handleEnvironmentSelectionValueChange(encodeReuseValue(environmentId));
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
    handleEnvironmentSelectionValueChange,
    parsedEnvironment,
    reuseThreadOptions,
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
      hidden: projectSourceWorktreeUnavailable,
      optionDisabledReason: branchUiState.mutationBlocker?.label,
      optionDisabledTitle: branchUiState.mutationBlocker?.title,
      createDisabledReason: branchUiState.mutationBlocker?.label,
      createDisabledTitle: branchUiState.mutationBlocker?.title,
      disabled: isForkDraft,
      onChange: handlePromptBoxBranchChange,
      onClear: handlePromptBoxClearBranch,
      onCreate: handlePromptBoxCreateBranchFromSeed,
      onCreateBaseChange: handlePromptBoxCreateBranchFrom,
      onOpenChange: handleBranchOpenChange,
      onSearchQueryChange: setBranchSearchQuery,
    }),
    [
      activeBranchesQuery.isFetching,
      branchOptions,
      branchEnvironmentMode,
      isForkDraft,
      priorityBranchOptions,
      projectSourceWorktreeUnavailable,
      remoteBranchOptions,
      branchUiState.currentBranch,
      branchUiState.currentOptionLabel,
      branchUiState.mutationBlocker,
      branchUiState.placeholder,
      branchUiState.triggerLabel,
      branchUiState.triggerTitle,
      handleBranchOpenChange,
      handlePromptBoxBranchChange,
      handlePromptBoxClearBranch,
      handlePromptBoxCreateBranchFromSeed,
      handlePromptBoxCreateBranchFrom,
      setBranchSearchQuery,
      selectedBranch?.isNew,
      selectedBranch?.name,
    ],
  );
  const permissionConfig = useMemo(
    () => ({
      value: permissionMode,
      options: permissionModeOptions,
      onChange: handlePermissionModeChange,
      supported: supportsPermissionModeSelection,
    }),
    [
      handlePermissionModeChange,
      permissionMode,
      permissionModeOptions,
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
          className="-ml-1.5 inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-muted py-0 pl-2.5 pr-1 text-xs font-medium text-muted-foreground"
        >
          <Icon name="Fork" className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            Forking {forkSeed.sourceThreadTitle}
          </span>
          <button
            type="button"
            aria-label="Cancel fork"
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
        canUpdate={codexCliIssue !== null}
        updating={
          composeHostId !== null &&
          (runningJobKey === providerCliJobKey(composeHostId, "codex") ||
            queuedJobKeys.has(providerCliJobKey(composeHostId, "codex")))
        }
        onUpdate={handleUpdateCodexCli}
      />
    );
  }, [
    codexCliIssue,
    codexCliStatus,
    composeHostId,
    handleUpdateCodexCli,
    isCodexCliVersionBlocked,
    queuedJobKeys,
    runningJobKey,
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

  const machineSetupDialog = (
    <ProjectMachineSetupDialog
      target={machineSetupTarget}
      onOpenChange={(open) => {
        if (!open) setMachineSetupTarget(null);
      }}
      onComplete={handleMachineSetupComplete}
    />
  );

  const promptBox = (
    <NewThreadPromptBox
      id="root-compose-prompt"
      promptBoxRef={promptBoxRef}
      value={prompt}
      mentionRanges={promptDraft.mentions}
      onChange={promptDraft.setTextAndMentions}
      onSubmit={submitPrompt}
      pluginComposerHost={pluginComposerHost}
      textEffects={promptTextEffects}
      isSubmitting={createThread.isPending}
      disabled={isSubmitDisabled}
      autoFocus={!isCodexCliVersionBlocked}
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
        disabled: isForkDraft || isCopyingPromptAttachments,
      }}
      execution={executionConfig}
    />
  );

  return (
    <>
      <RootComposePanelCommandHandlers
        isFocused={isFocusedPane}
        onClose={handleCloseWindowRequest}
        onToggle={handleToggleSecondaryPanel}
      />
      {machineSetupDialog}
      {rootPanelToggle}
      <PluginComposerHostProvider value={pluginComposerHost}>
        <RootComposeSecondaryContent
          contentClassName={
            showEmptyWelcome
              ? ROOT_COMPOSE_EMPTY_WELCOME_CONTENT_CLASS
              : ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS
          }
          isSecondaryPanelOpen={isSecondaryPanelOpen}
          onToggleSecondaryPanel={handleToggleSecondaryPanel}
          panelTogglePositionClassName={panelTogglePositionClassName}
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
            fileTabContentFillsRegion:
              activePluginPanelTab !== null &&
              rootPanelNewThreadPanelActions.find(
                (candidate) =>
                  candidate.pluginId === activePluginPanelTab.pluginId &&
                  candidate.id === activePluginPanelTab.actionId,
              )?.layout === "flush",
            renderBrowserDeck,
            isBrowserTabActive,
            isOpen: isSecondaryPanelOpen,
            showConversationCollapseControl: false,
            showGitDiffTab: false,
            showInfoTab: false,
            inlinePanelToggle: panelTogglePlacement.inlinePanelToggle,
            onClose: closeSecondaryPanel,
            onCollapse: closeSecondaryPanel,
            onOpenFileInEditor: handleOpenWorkspaceFileInEditor,
            onFileTabReorder: reorderFileTab,
            onOpenNewTab: handleOpenNewTab,
            onOpenFilePreview: handleOpenFilePreview,
            onSelectionAddToChat: handleRootPanelSelectionAddToChat,
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
      </PluginComposerHostProvider>
    </>
  );
}
