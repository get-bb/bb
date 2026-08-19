import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { findCachedProviderInfo } from "@/hooks/queries/system-queries";
import {
  findLocalPathProjectSourceForHost,
  type EnvironmentStatus,
  type Host,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type { OpenInTargetContext } from "@bb/host-daemon-contract";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import type {
  SidebarBootstrapResponse,
  TerminalSession,
} from "@bb/server-contract";
import {
  NewThreadComposer,
  type NewThreadComposerState,
} from "@/components/promptbox/NewThreadComposer";
import { CodexCliVersionBanner } from "@/components/promptbox/banner/CodexCliVersionBanner";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import {
  encodeHostValue,
  encodeReuseValue,
} from "@/components/pickers/environment-picker-value";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupCompletion,
  type ProjectMachineSetupDialogTarget,
} from "@/components/dialogs/ProjectMachineSetupDialog";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  LazyBrowserTabDeck,
  LazyFilePreview,
  LazyHostFilePreviewTabContent,
  LazyNewTabPage,
  LazyProjectFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import type { BrowserAddressFocusRequest } from "@/components/secondary-panel/BrowserTabContent";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { PageShell } from "@/components/ui/page-shell.js";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
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
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import {
  useCloseTerminal,
  useCloseEnvironmentTerminal,
  useCreateTerminal,
  useCreateEnvironmentTerminal,
  useEnvironmentTerminals,
  useTerminals,
} from "@/hooks/queries/thread-terminal-queries";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { useHostProviderCliStatus } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import {
  requestComposerFocus,
  subscribeComposerFocusRequests,
} from "@/lib/composer-focus-requests";
import { PluginComposerHostProvider } from "@/components/plugin/plugin-composer-host";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
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
import { resolveComposeHostId } from "./root-compose-environment-selection";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";
import { RootComposeEmptyWelcome } from "./RootComposeEmptyWelcome";
import {
  shouldLoadThreadStorageFileList,
  useThreadStorageViewer,
} from "@/components/secondary-panel/useThreadStorageViewer";
import {
  useThreadFileTabs,
  type FileSearchSelection,
} from "@/components/secondary-panel/useThreadFileTabs";
import { isSecondaryFileTab } from "@/components/secondary-panel/secondaryPanelTabState";
import { resolveRightPanelFileVisual } from "@/components/secondary-panel/rightPanelFileVisuals";
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

type SecondaryPanelChangeHandler = (panel: ThreadSecondaryPanelTab) => void;
type NullableSecondaryPanelChangeHandler = (
  panel: ThreadSecondaryPanelTab | null,
) => void;

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

interface BuildRootComposeNewTabFileTabArgs {
  activeTabId: string | null;
  onClose: () => void;
  onSelect: () => void;
  tabId: string;
}

/** The root launcher uses the same visible tab-pill model as thread panels. */
export function buildRootComposeNewTabFileTab({
  activeTabId,
  onClose,
  onSelect,
  tabId,
}: BuildRootComposeNewTabFileTabArgs): SecondaryPanelFileTab {
  return {
    id: tabId,
    filename: "New tab",
    isActive: tabId === activeTabId,
    leadingVisual: (
      <Icon
        name="NewTab"
        className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
        aria-hidden
      />
    ),
    statusLabel: null,
    onSelect,
    onClose,
  };
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

  return <RouteLoadingSkeleton />;
}

export function RootComposeView() {
  const [rootComposeProjectId, setRootComposeProjectId] =
    useRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createThread = useCreateThread();
  const [rootComposeSectionId, setRootComposeSectionId] = useState<
    string | null
  >(() => readSectionIdFromLocationState(location.state));
  const [lastCreatedThreadId, setLastCreatedThreadId] = useState<string | null>(
    null,
  );
  const [startedComposing, setStartedComposing] = useState(() =>
    shouldStartComposingFromLocationState(location.state),
  );
  const [navigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  const [forkSeed, setForkSeed] = useState<ForkThreadCreateSeed | null>(() =>
    readForkThreadCreateSeedFromLocationState(location.state),
  );

  const handleProjectChange = useCallback(
    (projectId: string) => {
      setForkSeed(null);
      setRootComposeProjectId(projectId);
    },
    [setRootComposeProjectId],
  );
  const handleSubmit = useCallback(
    async (request: NewThreadRequest) => {
      const shouldNavigateToCreatedThread = shouldNavigateAfterThreadCreate({
        isForkDraft: forkSeed !== null,
        navigateToThreadAfterCreate,
      });
      const createRequest =
        forkSeed === null
          ? {
              ...request,
              ...(rootComposeSectionId
                ? { sectionId: rootComposeSectionId }
                : {}),
            }
          : buildForkThreadRequest({
              ...forkSeed,
              input: request.input,
              model: request.model,
              permissionMode: request.permissionMode,
              providerSupportsFork:
                findCachedProviderInfo(queryClient, forkSeed.providerId)
                  ?.capabilities.supportsFork ?? false,
              reasoningLevel: request.reasoningLevel,
              serviceTier: request.serviceTier,
            });
      if (createRequest === null) return;
      const thread = await createThread.mutateAsync(createRequest);
      setLastCreatedThreadId(thread.id);
      setForkSeed(null);
      setRootComposeSectionId(null);
      if (shouldNavigateToCreatedThread) {
        navigate(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        );
      }
    },
    [
      createThread,
      forkSeed,
      queryClient,
      navigate,
      navigateToThreadAfterCreate,
      rootComposeSectionId,
    ],
  );
  const composerSeed = useMemo(
    () =>
      forkSeed === null
        ? undefined
        : {
            providerId: forkSeed.providerId,
            model: forkSeed.model,
            reasoningLevel: forkSeed.reasoningLevel,
            serviceTier: forkSeed.serviceTier,
            permissionMode: forkSeed.permissionMode,
            environment: {
              type: "reuse" as const,
              environmentId: forkSeed.environmentId,
            },
          },
    [forkSeed],
  );

  return (
    <NewThreadComposer
      projectId={rootComposeProjectId}
      onProjectChange={handleProjectChange}
      draftStorage={{ kind: "new-thread" }}
      selectionScope="new-thread"
      seed={composerSeed}
      resetKey={forkSeed?.sourceThreadId ?? null}
      preferConnectedProviderWhenUnset={forkSeed === null}
      onSubmit={handleSubmit}
    >
      {(composer) => (
        <RootComposeSurface
          composer={composer}
          forkSeed={forkSeed}
          lastCreatedThreadId={lastCreatedThreadId}
          rootComposeProjectId={rootComposeProjectId}
          setForkSeed={setForkSeed}
          setRootComposeProjectId={setRootComposeProjectId}
          setRootComposeSectionId={setRootComposeSectionId}
          setStartedComposing={setStartedComposing}
          startedComposing={startedComposing}
        />
      )}
    </NewThreadComposer>
  );
}

interface RootComposeSurfaceProps {
  composer: NewThreadComposerState;
  forkSeed: ForkThreadCreateSeed | null;
  lastCreatedThreadId: string | null;
  rootComposeProjectId: string;
  setForkSeed: (seed: ForkThreadCreateSeed | null) => void;
  setRootComposeProjectId: (projectId: string) => void;
  setRootComposeSectionId: (sectionId: string | null) => void;
  setStartedComposing: (started: boolean) => void;
  startedComposing: boolean;
}

function RootComposeSurface({
  composer,
  forkSeed,
  lastCreatedThreadId,
  rootComposeProjectId,
  setForkSeed,
  setRootComposeProjectId,
  setRootComposeSectionId,
  setStartedComposing,
  startedComposing,
}: RootComposeSurfaceProps) {
  const paneContext = useOptionalPaneContext();
  const isFocusedPane = paneContext?.isFocused ?? true;
  const location = useLocation();
  const navigate = useNavigate();
  const isPointerCoarse = usePointerCoarse();
  const quickCreateProject = useQuickCreateProjectController();
  const {
    projectId,
    isProjectless,
    projects,
    sidebarNavigation,
    sidebarNavigationError,
    currentProject,
    projectSources,
    connectedHostIds,
    primaryHostId,
    parsedEnvironment,
    projectHostId: rootProjectHostId,
    panelThreadId: rootPanelThreadId,
    selectedProviderId,
    promptDraft,
    promptBoxRef,
    pluginComposerHost: sharedPluginComposerHost,
    textEffects: promptTextEffects,
    isSubmitting,
    seedEnvironmentSelectionValue,
    setEnvironmentSelectionValue,
    setProviderModelReasoning,
    setPermissionMode,
    setServiceTier,
    renderPromptBox,
  } = composer;
  const rootPanelEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const pluginComposerHost = useMemo(
    () => ({
      ...sharedPluginComposerHost,
      // Root may be showing the empty welcome instead of a mounted editor.
      // Route focus through the shared request channel so the subscription
      // below first reveals the composer and then focuses it.
      focus: () => requestRootComposePluginFocus(promptDraft.storageKey),
    }),
    [promptDraft.storageKey, sharedPluginComposerHost],
  );

  useEffect(() => {
    if (projectId === rootComposeProjectId) return;
    setRootComposeProjectId(projectId);
  }, [projectId, rootComposeProjectId, setRootComposeProjectId]);
  useEffect(
    () =>
      subscribeComposerFocusRequests(promptDraft.storageKey, () => {
        setStartedComposing(true);
        window.requestAnimationFrame(() => promptBoxRef.current?.focusEnd());
      }),
    [promptBoxRef, promptDraft.storageKey, setStartedComposing],
  );
  const handleRootPanelSelectionAddToChat = useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) => {
      promptDraft.addQuote(text, attachments);
      setStartedComposing(true);
      window.requestAnimationFrame(() => promptBoxRef.current?.focusEnd());
    },
    [promptBoxRef, promptDraft, setStartedComposing],
  );

  // Both location-state effects below write the draft store and then clear
  // the state through a router transition. The store write re-renders this
  // view synchronously with a new `promptDraft` object, before the transition
  // commits, so an effect that depends on `promptDraft` itself would re-run
  // against the same location state, write again, and starve the transition
  // until React aborts the loop. Depend on the stable setters instead.
  const setPromptDraft = promptDraft.setDraft;
  const restorePromptDraftIfEmpty = promptDraft.restoreIfEmpty;
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
    if (!hasSingleUseRootComposeTargetState(location.state)) return;
    if (shouldStartComposingFromLocationState(location.state)) {
      setStartedComposing(true);
    }
    if (sectionTarget?.kind === "set") {
      setRootComposeSectionId(sectionTarget.sectionId);
    } else if (sectionTarget?.kind === "clear") {
      setRootComposeSectionId(null);
    }
    if (reuseEnvironmentId !== null) {
      seedEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (nextForkSeed !== null && nextHandoffSeed === null) {
      setForkSeed(nextForkSeed);
      setRootComposeProjectId(nextForkSeed.projectId);
      setProviderModelReasoning(nextForkSeed);
      setPermissionMode(nextForkSeed.permissionMode);
      setServiceTier(nextForkSeed.serviceTier);
      // New-thread selection state intentionally ignores seed.environment;
      // this explicit write is what pins the picker to the fork environment.
      seedEnvironmentSelectionValue(
        encodeReuseValue(nextForkSeed.environmentId),
      );
    }
    if (nextHandoffSeed !== null) {
      setStartedComposing(true);
      setRootComposeProjectId(nextHandoffSeed.projectId);
      setForkSeed(null);
      if (nextHandoffSeed.environmentId !== null) {
        seedEnvironmentSelectionValue(
          encodeReuseValue(nextHandoffSeed.environmentId),
        );
      }
      setPromptDraft(buildThreadHandoffPromptDraft(nextHandoffSeed));
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: null,
    });
  }, [
    location.search,
    location.state,
    navigate,
    seedEnvironmentSelectionValue,
    setForkSeed,
    setPermissionMode,
    setPromptDraft,
    setProviderModelReasoning,
    setRootComposeProjectId,
    setRootComposeSectionId,
    setServiceTier,
    setStartedComposing,
  ]);
  useEffect(() => {
    const initialPrompt = readInitialPromptFromLocationState(location.state);
    if (initialPrompt === null) return;
    const nextDraft = { text: initialPrompt, mentions: [], attachments: [] };
    if (shouldReplaceInitialPromptFromLocationState(location.state)) {
      setPromptDraft(nextDraft);
    } else {
      restorePromptDraftIfEmpty(nextDraft);
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: { focusPrompt: true },
    });
  }, [
    location.search,
    location.state,
    navigate,
    restorePromptDraftIfEmpty,
    setPromptDraft,
  ]);
  const shouldFocusPrompt =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusPrompt" in location.state &&
    location.state.focusPrompt === true;
  useEffect(() => {
    if (!shouldFocusPrompt || isPointerCoarse) return;
    const handle = window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [isPointerCoarse, location.key, promptBoxRef, shouldFocusPrompt]);

  const mobileRecentThreads = useMemo(
    () => buildMobileRecentThreads({ sidebarNavigation }),
    [sidebarNavigation],
  );
  const mobileRecentProjectNamesById = useMemo(() => {
    const namesById = new Map<string, string>();
    if (!sidebarNavigation) return namesById;
    namesById.set(
      sidebarNavigation.personalProject.id,
      sidebarNavigation.personalProject.name,
    );
    for (const project of sidebarNavigation.projects) {
      namesById.set(project.id, project.name);
    }
    return namesById;
  }, [sidebarNavigation]);

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
    if (!isCodexCliVersionBlocked || codexCliStatus === null) return null;
    const issue = buildProviderCliIssue({
      provider: "codex",
      status: codexCliStatus,
    });
    return issue && hasProviderCliAction(issue) ? issue : null;
  }, [codexCliStatus, isCodexCliVersionBlocked]);
  const handleUpdateCodexCli = useCallback(() => {
    if (codexCliIssue === null || composeHostId === null) return;
    startInstall({ hostId: composeHostId, issue: codexCliIssue });
  }, [codexCliIssue, composeHostId, startInstall]);

  useFixedPanelTabsStorageMaintenance();
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
    fileListEnabled: shouldLoadThreadStorageFileList({
      hasThread: rootPanelThreadId !== null,
      isSecondaryPanelOpen,
      secondaryTabs: fixedPanelTabsState.secondary.tabs,
    }),
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
    activeFileOpenerOwner,
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
        <LazyBrowserTabDeck
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
    handleCloseTerminalTab,
    isSecondaryPanelOpen,
  ]);
  const fileTabs = useMemo(() => {
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
            return buildRootComposeNewTabFileTab({
              activeTabId: activeFixedSecondaryTabId,
              onClose: () => closeTab(tab.id),
              onSelect: () => handleActivateFileTab(tab.id),
              tabId: tab.id,
            });
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
  }, [
    activeFixedSecondaryTabId,
    closeTab,
    handleActivateFileTab,
    handleActivateTerminalTab,
    handleCloseTerminalTab,
    rootPanelNewThreadPanelActions,
    syncedOrderedSecondaryFileTabs,
    terminalsById,
  ]);
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
  const renderFileOpenerReplacement = (original: ReactNode): ReactNode =>
    activeFileOpenerOwner !== null && activePluginPanelTab !== null ? (
      <PluginPanelTabContent
        tab={activePluginPanelTab}
        context={{
          kind: "new-thread",
          projectId: isProjectless ? null : projectId,
        }}
        fileOpenerOriginal={original}
      />
    ) : (
      original
    );
  const fileTabContent: ReactNode =
    activeTerminalId && rootPanelTerminalTarget ? (
      <LazyThreadTerminalPanel
        autoFocus={shouldAutoFocusTerminal}
        canCreateTerminal={canCreateRootTerminal}
        isPanelOpen={isSecondaryPanelOpen}
        isPanelPersistedOpen={isPersistedSecondaryPanelOpen}
        onAutoFocusHandled={handleTerminalAutoFocusHandled}
        onOpenLink={handleOpenPanelLink}
        onSelectionAddToChat={handleRootPanelSelectionAddToChat}
        panelStateId={ROOT_COMPOSE_FIXED_PANEL_STATE_ID}
        syncThreadId={null}
        target={rootPanelTerminalTarget}
      />
    ) : isNewTabActive ? (
      <LazyNewTabPage
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
      renderFileOpenerReplacement(
        <LazyWorkspaceFilePreviewTabContent
          activePath={activeWorkspaceFilePath}
          copyPath={workspaceFileCopyPath}
          environmentId={activeWorkspaceFileEnvironmentId}
          isPanelOpen={isSecondaryPanelOpen}
          lineRange={activeWorkspaceFileLineRange}
          onOpenInEditor={handleOpenWorkspaceFileInEditor}
          onSelectionAddToChat={handleRootPanelSelectionAddToChat}
          source={activeWorkspaceFileSource}
          statusLabel={activeWorkspaceFileStatusLabel}
          threadId={rootPanelThreadId}
        />,
      )
    ) : activeWorkspaceFilePath !== null &&
      activeWorkspaceFileProjectPreviewId !== null ? (
      renderFileOpenerReplacement(
        <LazyProjectFilePreviewTabContent
          activePath={activeWorkspaceFilePath}
          copyPath={projectFileCopyPath}
          environmentId={rootPanelEnvironmentId}
          hostId={rootProjectHostId}
          isPanelOpen={isSecondaryPanelOpen}
          lineRange={activeWorkspaceFileLineRange}
          onOpenInEditor={handleOpenProjectFileInEditor}
          onSelectionAddToChat={handleRootPanelSelectionAddToChat}
          projectId={activeWorkspaceFileProjectPreviewId}
        />,
      )
    ) : activeHostFilePath !== null ? (
      renderFileOpenerReplacement(
        activeRootHostFileThreadId && activeRootHostFileEnvironmentId ? (
          <LazyHostFilePreviewTabContent
            activePath={activeHostFilePath}
            copyPath={activeHostFilePath}
            environmentId={activeRootHostFileEnvironmentId}
            isPanelOpen={isSecondaryPanelOpen}
            lineRange={activeHostFileLineRange}
            onOpenInEditor={handleOpenHostFileInEditor}
            onSelectionAddToChat={handleRootPanelSelectionAddToChat}
            threadId={activeRootHostFileThreadId}
          />
        ) : (
          <LazyFilePreview
            path={activeHostFilePath}
            copyPath={activeHostFilePath}
            onOpenInEditor={handleOpenHostFileInEditor}
            state={{ kind: "loading" }}
          />
        ),
      )
    ) : activeStorageFilePath !== null ? (
      renderFileOpenerReplacement(
        activeRootStorageFileThreadId ? (
          <LazyThreadStorageFilePreviewTabContent
            activePath={activeStorageFilePath}
            copyPath={storageFileCopyPath}
            isPanelOpen={isSecondaryPanelOpen}
            lineRange={activeStorageFileLineRange}
            onOpenInEditor={handleOpenStorageFileInEditor}
            onSelectionAddToChat={handleRootPanelSelectionAddToChat}
            threadId={activeRootStorageFileThreadId}
          />
        ) : (
          <LazyFilePreview
            path={activeStorageFilePath}
            copyPath={storageFileCopyPath}
            onOpenInEditor={handleOpenStorageFileInEditor}
            state={{ kind: "loading" }}
          />
        ),
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
  const isForkDraft = forkSeed !== null;
  const showEmptyWelcome =
    !isForkDraft &&
    !startedComposing &&
    projects !== undefined &&
    projects.length === 0;
  const setPromptTextAndMentions = promptDraft.setTextAndMentions;
  const handleStartComposing = useCallback(
    (prefill?: string) => {
      if (prefill) {
        setPromptTextAndMentions(prefill, []);
      }
      setStartedComposing(true);
    },
    [setPromptTextAndMentions, setStartedComposing],
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
  }, [
    isCodexCliVersionBlocked,
    isPointerCoarse,
    promptBoxRef,
    startedComposing,
  ]);
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
      setEnvironmentSelectionValue(encodeHostValue(setUpHostId, "worktree"));
    },
    [setEnvironmentSelectionValue],
  );
  const handleCancelForkDraft = useCallback(() => {
    setForkSeed(null);
    window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
  }, [promptBoxRef, setForkSeed]);

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

  // The composer renders immediately with loading pickers; only a failed
  // bootstrap with no projects at all replaces it (see B28). While the
  // bootstrap is in flight the project picker shows a loading label and the
  // projectId-dependent queries inside NewThreadComposer stay disabled.
  if (!projects && sidebarNavigationError) {
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

  const promptBox = renderPromptBox({
    id: "root-compose-prompt",
    autoFocus: !isCodexCliVersionBlocked,
    zenModeStorageKey: getProjectScopedStorageKey(
      ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY,
      projectId,
    ),
    banner: promptBanner,
    header: promptHeader,
    externallyBlocked: isCodexCliVersionBlocked,
    resolveMentionLink,
    pluginComposerHost,
    textEffects: promptTextEffects,
    allowNoProject: true,
    createProject: {
      onCreate: quickCreateProject.openCreateDialog,
      disabled:
        !quickCreateProject.isAvailable || quickCreateProject.isCreating,
      isCreating: quickCreateProject.isCreating,
    },
    onRequestMachineSetup: handleRequestMachineSetup,
    locks: {
      project: isForkDraft,
      provider: isForkDraft,
      environment: isForkDraft,
      branch: isForkDraft,
    },
  });

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
            fixedTabs: [],
            // The shell, tab strip, launcher, resize, and drawer behavior are
            // shared with threads. Info, Diff, and conversation full-screen
            // stay thread-only because no thread exists on this surface yet.
            showConversationCollapseControl: false,
            inlinePanelToggle: panelTogglePlacement.inlinePanelToggle,
            onClose: closeSecondaryPanel,
            onCollapse: closeSecondaryPanel,
            onOpenFileInEditor: handleOpenWorkspaceFileInEditor,
            onFileTabReorder: reorderFileTab,
            onOpenNewTab: handleOpenNewTab,
            onOpenFilePreview: handleOpenFilePreview,
            onSelectionAddToChat: handleRootPanelSelectionAddToChat,
            onPanelFocus: handleSecondaryPanelFocus,
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
                showCreatingRow={isSubmitting}
                threads={mobileRecentThreads}
              />
            </>
          )}
        </RootComposeSecondaryContent>
      </PluginComposerHostProvider>
    </>
  );
}
