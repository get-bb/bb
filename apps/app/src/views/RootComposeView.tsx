import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "jotai";
import { useLocation, useNavigate } from "react-router-dom";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import {
  findLocalPathProjectSourceForHost,
  type EnvironmentStatus,
  type Host,
  type ProviderInfo,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  DraftContent,
  DraftOptions,
  SidebarBootstrapResponse,
  TerminalSession,
} from "@bb/server-contract";
import {
  NewThreadComposer,
  type NewThreadComposerState,
  type NewThreadComposerSubmission,
} from "@/components/promptbox/NewThreadComposer";
import { ProviderCliVersionBanner } from "@/components/promptbox/banner/ProviderCliVersionBanner";
import {
  buildProviderCliIssue,
  hasProviderCliAction,
  useProviderCliInstallRunner,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID } from "@bb/client-core";
import {
  encodeProviderValue,
  encodeReuseValue,
} from "@/components/pickers/environment-picker-value";
import {
  ProjectMachineSetupDialog,
  type ProjectMachineSetupCompletion,
  type ProjectMachineSetupDialogTarget,
} from "@/components/dialogs/ProjectMachineSetupDialog";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/AppPageHeader";
import { RIGHT_PANEL_TOGGLE_ICON_NAME } from "@/components/secondary-panel/panelToggleControlState";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import type {
  SecondaryPanelPaneRenderContext,
  SecondaryPanelRenderableTab,
} from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  LazyBrowserTabDeck,
  preloadThreadSecondaryPanel,
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
import type { FileOpenerOverride } from "@/lib/plugin-slot-resolvers";
import { usePluginNewThreadPanelActions } from "@/components/plugin/PluginPanelActions";
import { usePluginSlots } from "@/lib/plugin-slots";
import { useDraftResource } from "@/hooks/useDraftResource";
import { createNewThreadDraft } from "@/lib/drafts/resource-runtime";
import { getDraftRoutePath } from "@/lib/draft-route";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { PaneContent } from "@/lib/split-layout";
import {
  ownsRootComposeLocation,
  replaceRootDraftOrigin,
  rootComposeRouteDraftId,
  rootDraftComposerSeed,
  rootDraftSubmissionContent,
  type RootDraftOrigin,
} from "./root-compose-draft";
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
import {
  requestComposerFocus,
  subscribeComposerFocusRequests,
} from "@/lib/composer-focus-requests";
import { PluginComposerHostProvider } from "@/components/plugin/plugin-composer-host";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import type { PromptDraftAttachment } from "@bb/client-core";
import {
  FORK_THREAD_CREATE_SEED_LOCATION_STATE_KEY,
  type ForkThreadCreateSeed,
} from "@bb/client-core";
import {
  buildThreadHandoffPromptDraft,
  readThreadHandoffCreateSeedFromLocationState,
} from "@bb/client-core";
import { useNavigateToThreadAfterCreatePreference } from "@/lib/root-compose-create-preference";
import {
  readInitialPromptFromSearch,
  stripInitialPromptFromSearch,
} from "./root-compose-initial-prompt";
import {
  getThreadRoutePath,
  getProjectComposeRoutePath,
  getRootComposeRoutePath,
  isRoutePath,
} from "@/lib/route-paths";
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
import type {
  HostFileTabState,
  ThreadStorageFileTabState,
  WorkspaceFileTabState,
} from "@bb/client-core";
import {
  resolveUrlOpenTarget,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import type { MarkdownPreviewLinkHandler } from "@/components/ui/markdown-link";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import {
  AppNavigationHostProvider,
  type AppFilePreviewIntent,
  type AppFixedTabOpenIntent,
} from "@/lib/app-navigation-host";
import { openAppFixedTabFromDestinations } from "@/lib/app-fixed-tab-navigation";
import {
  normalizeExperimentalFileOpenOptions,
  toFilePreviewLineRange,
} from "@/lib/live-file-navigation";
import {
  rootComposeProjectIdAtom,
  useRootComposeProjectId,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import {
  ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS,
  RootComposeSecondaryContent,
} from "./RootComposeSecondaryContent";
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
import { isSecondaryFileTab } from "@bb/client-core";
import { RightPanelFileTabIcon } from "@/components/secondary-panel/RightPanelFileTabIcon";
import {
  DEFAULT_TERMINAL_COLS,
  DEFAULT_TERMINAL_ROWS,
} from "@/components/thread/terminal/useThreadTerminalController";
import {
  buildTerminalSyncedSecondaryFileTabs,
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
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useOptionalPaneContext } from "./thread-detail/PaneContext";
import {
  PluginDetailPanelContext,
  usePluginDetailPanelState,
} from "@/components/plugin/plugin-detail-navigation";
import { RootComposePanelCommandHandlers } from "./RootComposePanelCommandHandlers";
import {
  ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
  RootComposePanelTabContent,
  type RootComposeTerminalTarget,
} from "./RootComposePanelTabContent";

const ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS = "pt-14";

const ROOT_COMPOSE_EMPTY_WELCOME_CONTENT_CLASS =
  "min-h-full flex-1 items-center justify-center pb-12";
const EMPTY_TERMINAL_SESSIONS: readonly TerminalSession[] = [];

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

type RootComposeSectionTarget =
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

interface BuildMobileRecentThreadsArgs {
  sidebarNavigation: SidebarBootstrapResponse | undefined;
}

interface ShouldNavigateAfterThreadCreateArgs {
  isForkDraft: boolean;
  navigateToThreadAfterCreate: boolean;
}

interface CanCreateRootComposeTerminalArgs {
  connectedHostIds: ReadonlySet<string>;
  environmentHostId: string | null | undefined;
  terminalTarget: RootComposeTerminalTarget | null;
  environmentStatus: EnvironmentStatus | undefined;
}

interface BuildRootComposeTerminalSessionsArgs {
  environmentTerminalSessions: readonly TerminalSession[] | undefined;
  globalTerminalSessions: readonly TerminalSession[] | undefined;
  terminalTarget: RootComposeTerminalTarget | null;
}

interface RootComposeRightPanelToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function RootComposeRightPanelToggle({
  isOpen,
  onToggle,
}: RootComposeRightPanelToggleProps) {
  const shortcut = useAppCommandShortcut("panel.toggle");
  const rightPanelLabel = isOpen ? "Hide right panel" : "Show right panel";
  const rightPanelIconName = RIGHT_PANEL_TOGGLE_ICON_NAME;

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idleCallback = window.requestIdleCallback(
        preloadThreadSecondaryPanel,
        { timeout: 1000 },
      );
      return () => window.cancelIdleCallback(idleCallback);
    }
    const timeout = window.setTimeout(preloadThreadSecondaryPanel, 1000);
    return () => window.clearTimeout(timeout);
  }, []);

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
      onFocus={preloadThreadSecondaryPanel}
      onPointerDown={preloadThreadSecondaryPanel}
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

  return <RouteLoadingSkeleton isBoundedPane={false} />;
}

export function RootComposeView({
  draftId: paneDraftId,
}: { draftId?: string } = {}) {
  const [defaultProjectId] = useRootComposeProjectId();
  const store = useStore();
  const [lastCreatedThreadId, setLastCreatedThreadId] = useState<string | null>(
    null,
  );
  const location = useLocation();
  const navigate = useNavigate();
  const paneContext = useOptionalPaneContext();
  const bootstrapDraftId = useRef<string | null>(null);
  const draftId = paneDraftId ?? rootComposeRouteDraftId(location);

  useEffect(() => {
    if (draftId !== null) {
      bootstrapDraftId.current = null;
      return;
    }
    if (location.pathname !== "/" || paneContext?.isFocused === false) return;
    const id =
      bootstrapDraftId.current ??
      createNewThreadDraft({
        projectId: store.get(rootComposeProjectIdAtom),
        sectionId: readSectionIdFromLocationState(location.state),
      });
    bootstrapDraftId.current = id;
    const search = new URLSearchParams(location.search);
    search.set("draft", id);
    navigate(`/?${search.toString()}`, {
      replace: true,
      state: location.state,
    });
  }, [
    defaultProjectId,
    store,
    draftId,
    location.pathname,
    location.search,
    location.state,
    navigate,
    paneContext?.isFocused,
  ]);

  return draftId === null ? (
    <RouteLoadingSkeleton isBoundedPane={paneContext?.isBoundedPane ?? false} />
  ) : (
    <RootComposeDraft
      key={draftId}
      draftId={draftId}
      lastCreatedThreadId={lastCreatedThreadId}
      onCreatedThread={setLastCreatedThreadId}
    />
  );
}

function RootComposeDraft({
  draftId,
  lastCreatedThreadId,
  onCreatedThread,
}: {
  draftId: string;
  lastCreatedThreadId: string | null;
  onCreatedThread: (id: string) => void;
}) {
  const resource = useDraftResource(draftId);
  const {
    edit: editDraft,
    submit: submitDraft,
    retry: retryDraft,
    reloadRemote: reloadDraft,
  } = resource;
  const setDefaultProjectId = useSetRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
  const store = useStore();
  const paneContext = useOptionalPaneContext();
  const locationRef = useRef(location);
  useLayoutEffect(() => {
    locationRef.current = location;
  }, [location]);
  const [startedComposing, setStartedComposing] = useState(
    () =>
      ownsRootComposeLocation(
        draftId,
        paneContext?.isFocused ?? true,
        location,
      ) && shouldStartComposingFromLocationState(location.state),
  );
  useEffect(() => {
    if (
      resource.promptDraft.text.length > 0 ||
      resource.promptDraft.attachments.length > 0
    ) {
      setStartedComposing(true);
    }
  }, [resource.promptDraft.text, resource.promptDraft.attachments.length]);
  const [sourceThreadTitle, setSourceThreadTitle] = useState("Source thread");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [navigateToThreadAfterCreate] =
    useNavigateToThreadAfterCreatePreference();
  const submissionInFlight = useRef(false);
  const pendingSubmission = useRef<{
    origin: RootDraftOrigin;
    navigateAfter: boolean;
  } | null>(null);
  const reboundDeletedDraft = useRef(false);
  const content = resource.content;
  const lastUsableContent = useRef<DraftContent | null>(null);
  if (content !== null && resource.status !== "deleted") {
    lastUsableContent.current = content;
  }
  const isForkDraft = content?.options.originKind === "fork";
  const forkSeed = isForkDraft ? { sourceThreadTitle } : null;
  const origin = useCallback(
    (): RootDraftOrigin => ({
      draftId,
      paneId: paneContext?.paneId ?? null,
      hadLayout: store.get(splitLayoutAtom) !== null,
    }),
    [draftId, paneContext?.paneId, store],
  );
  const replaceOrigin = useCallback(
    (target: RootDraftOrigin, destination: PaneContent) => {
      const current = store.get(splitLayoutAtom);
      const result = replaceRootDraftOrigin({
        layout: current,
        origin: target,
        destination,
        currentRouteDraftId: rootComposeRouteDraftId(locationRef.current),
      });
      if (result.layout !== null && result.layout !== current) {
        store.set(splitLayoutAtom, result.layout);
      }
      if (!result.navigate) return;
      if (destination.kind === "thread") {
        navigate(getThreadRoutePath(destination));
      } else if (destination.kind === "new-thread") {
        navigate(getDraftRoutePath(destination.draftId), { replace: true });
      }
    },
    [navigate, store],
  );
  const handleProjectChange = useCallback(
    (projectId: string) => {
      editDraft((current) => ({
        ...current,
        projectId,
        options: {
          ...current.options,
          sourceThreadId: null,
          sourceSeqEnd: null,
          originKind: null,
        },
      }));
      setDefaultProjectId(projectId);
    },
    [editDraft, setDefaultProjectId],
  );
  const setForkSeed = useCallback(
    (seed: ForkThreadCreateSeed | null) => {
      if (seed === null) {
        editDraft((current) => ({
          ...current,
          options: {
            ...current.options,
            sourceThreadId: null,
            sourceSeqEnd: null,
            originKind: null,
          },
        }));
        return;
      }
      setSourceThreadTitle(seed.sourceThreadTitle);
      setDefaultProjectId(seed.projectId);
      editDraft((current) => ({
        ...current,
        projectId: seed.projectId,
        options: {
          ...current.options,
          providerId: seed.providerId,
          model: seed.model,
          reasoningLevel: seed.reasoningLevel,
          serviceTier: seed.serviceTier ?? null,
          permissionMode: seed.permissionMode,
          environment: { type: "reuse", environmentId: seed.environmentId },
          sourceThreadId: seed.sourceThreadId,
          sourceSeqEnd: seed.sourceSeqEnd ?? null,
          originKind: "fork",
        },
      }));
    },
    [editDraft, setDefaultProjectId],
  );
  const setSectionId = useCallback(
    (sectionId: string | null) => {
      editDraft((current) => ({ ...current, sectionId }));
    },
    [editDraft],
  );
  const setReuseEnvironment = useCallback(
    (environmentId: string) => {
      editDraft((current) => ({
        ...current,
        options: {
          ...current.options,
          environment: { type: "reuse", environmentId },
        },
      }));
    },
    [editDraft],
  );
  const awaitingLocationSeed =
    ownsRootComposeLocation(
      draftId,
      paneContext?.isFocused ?? true,
      location,
    ) && hasSingleUseRootComposeTargetState(location.state);
  const handleOptionsChange = useCallback(
    (
      options: Pick<
        DraftOptions,
        | "providerId"
        | "model"
        | "reasoningLevel"
        | "serviceTier"
        | "permissionMode"
        | "environment"
      >,
    ) => {
      if (
        awaitingLocationSeed ||
        resource.status === "loading" ||
        resource.status === "deleted" ||
        resource.content === null
      )
        return;
      editDraft((current) => ({
        ...current,
        options: { ...current.options, ...options },
      }));
    },
    [awaitingLocationSeed, resource.content, editDraft, resource.status],
  );
  const completeSubmission = useCallback(
    (
      result: Awaited<ReturnType<typeof submitDraft>>,
      submission: { origin: RootDraftOrigin; navigateAfter: boolean },
    ) => {
      pendingSubmission.current = null;
      if (result.draft === null) reboundDeletedDraft.current = true;
      onCreatedThread(result.thread.id);
      if (submission.navigateAfter) {
        replaceOrigin(submission.origin, {
          kind: "thread",
          projectId: result.thread.projectId,
          threadId: result.thread.id,
        });
      } else if (result.draft === null) {
        const previous = lastUsableContent.current;
        const nextDraftId =
          result.recoveryDraftId ??
          createNewThreadDraft({
            projectId: previous?.projectId ?? null,
            options: previous
              ? {
                  providerId: previous.options.providerId,
                  model: previous.options.model,
                  reasoningLevel: previous.options.reasoningLevel,
                  serviceTier: previous.options.serviceTier,
                  permissionMode: previous.options.permissionMode,
                  environment: previous.options.environment,
                }
              : {},
          });
        replaceOrigin(submission.origin, {
          kind: "new-thread",
          draftId: nextDraftId,
        });
      }
    },
    [onCreatedThread, replaceOrigin],
  );
  const submitResource = useCallback(
    async (submission: { origin: RootDraftOrigin; navigateAfter: boolean }) => {
      submissionInFlight.current = true;
      pendingSubmission.current = submission;
      try {
        completeSubmission(await submitDraft(), submission);
      } finally {
        submissionInFlight.current = false;
      }
    },
    [completeSubmission, submitDraft],
  );
  const retryResource = useCallback(async () => {
    if (pendingSubmission.current !== null) {
      await submitResource(pendingSubmission.current);
      return;
    }
    const submission = {
      origin: origin(),
      navigateAfter: shouldNavigateAfterThreadCreate({
        isForkDraft,
        navigateToThreadAfterCreate,
      }),
    };
    submissionInFlight.current = true;
    try {
      const result = await retryDraft();
      if (result !== null) completeSubmission(result, submission);
    } finally {
      submissionInFlight.current = false;
    }
  }, [
    completeSubmission,
    isForkDraft,
    navigateToThreadAfterCreate,
    origin,
    retryDraft,
    submitResource,
  ]);
  const useSavedVersion = useCallback(async () => {
    await reloadDraft();
    pendingSubmission.current = null;
  }, [reloadDraft]);
  const handleSubmit = useCallback(
    async (request: NewThreadComposerSubmission) => {
      editDraft((current) => rootDraftSubmissionContent(current, request));
      await submitResource({
        origin: origin(),
        navigateAfter: shouldNavigateAfterThreadCreate({
          isForkDraft,
          navigateToThreadAfterCreate,
        }),
      });
    },
    [
      isForkDraft,
      navigateToThreadAfterCreate,
      origin,
      editDraft,
      submitResource,
    ],
  );
  useEffect(() => {
    if (
      resource.status !== "deleted" ||
      resource.recoveryCopies.length > 0 ||
      actionPending ||
      submissionInFlight.current ||
      pendingSubmission.current !== null ||
      reboundDeletedDraft.current
    )
      return;
    reboundDeletedDraft.current = true;
    replaceOrigin(origin(), {
      kind: "new-thread",
      draftId: createNewThreadDraft({
        projectId: lastUsableContent.current?.projectId ?? null,
      }),
    });
  }, [
    actionPending,
    origin,
    replaceOrigin,
    resource.recoveryCopies.length,
    resource.status,
  ]);
  const runAction = useCallback(async (action: () => void | Promise<void>) => {
    setActionError(null);
    setActionPending(true);
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Could not update this draft.",
      );
    } finally {
      setActionPending(false);
    }
  }, []);
  const resourceNotice = (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
    >
      <span>
        {resource.status === "loading"
          ? "Loading draft…"
          : resource.status === "saving"
            ? "Saving draft…"
            : resource.status === "conflict"
              ? "This draft changed elsewhere. Your edits are kept here."
              : resource.status === "deleted"
                ? "This draft was sent or deleted. Recover your edits as a copy."
                : resource.status === "error" || resource.persistenceError
                  ? "Draft not saved."
                  : "Draft saved"}
      </span>
      {actionError || resource.error || resource.persistenceError ? (
        <span>
          {actionError ??
            resource.error?.message ??
            resource.persistenceError?.message}
        </span>
      ) : null}
      {resource.status === "error" ||
      resource.persistenceError ||
      pendingSubmission.current !== null ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={actionPending}
          onClick={() => void runAction(retryResource)}
        >
          Retry
        </Button>
      ) : null}
      {resource.status === "conflict" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={actionPending}
          onClick={() => void runAction(useSavedVersion)}
        >
          Use saved version
        </Button>
      ) : null}
      {resource.recoveryCopies.map((_, index) => (
        <Button
          key={index}
          size="sm"
          variant="ghost"
          disabled={actionPending}
          onClick={() =>
            void runAction(() => {
              const copyId = resource.saveLocalAsCopy(index);
              replaceOrigin(origin(), { kind: "new-thread", draftId: copyId });
            })
          }
        >
          {index === 0 ? "Save a copy" : `Save copy ${index + 1}`}
        </Button>
      ))}
    </div>
  );
  const composerSeed = useMemo(
    () =>
      content === null ? undefined : rootDraftComposerSeed(content.options),
    [content],
  );
  if (content === null) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        {resourceNotice}
      </PageShell>
    );
  }
  return (
    <NewThreadComposer
      projectId={content.projectId}
      onProjectChange={handleProjectChange}
      draftStorage={{ kind: "new-thread" }}
      draftController={resource.promptDraft}
      selectionScope="component-local"
      seed={composerSeed}
      resetKey={draftId}
      preferReadyProviderWhenUnset={!isForkDraft}
      onOptionsChange={handleOptionsChange}
      resourceBlockedReason={
        resource.status === "conflict"
          ? "Resolve the draft conflict before sending."
          : resource.status === "deleted"
            ? "Recover this draft as a new copy before sending."
            : resource.status === "loading"
              ? "Loading draft…"
              : null
      }
      onSubmit={handleSubmit}
    >
      {(composer) => (
        <RootComposeSurface
          composer={composer}
          draftId={draftId}
          forkSeed={forkSeed}
          lastCreatedThreadId={lastCreatedThreadId}
          setForkSeed={setForkSeed}
          setRootComposeProjectId={handleProjectChange}
          setRootComposeSectionId={setSectionId}
          setReuseEnvironment={setReuseEnvironment}
          setStartedComposing={setStartedComposing}
          startedComposing={
            startedComposing ||
            resource.promptDraft.text.length > 0 ||
            resource.promptDraft.attachments.length > 0 ||
            resource.status === "error" ||
            resource.status === "conflict" ||
            resource.status === "deleted"
          }
          resourceNotice={resourceNotice}
          canApplyLocationSeeds={
            resource.status !== "loading" &&
            resource.status !== "conflict" &&
            resource.status !== "deleted"
          }
        />
      )}
    </NewThreadComposer>
  );
}

interface RootComposeSurfaceProps {
  composer: NewThreadComposerState;
  draftId: string;
  forkSeed: Pick<ForkThreadCreateSeed, "sourceThreadTitle"> | null;
  lastCreatedThreadId: string | null;
  resourceNotice: ReactNode;
  canApplyLocationSeeds: boolean;
  setForkSeed: (seed: ForkThreadCreateSeed | null) => void;
  setRootComposeProjectId: (projectId: string) => void;
  setRootComposeSectionId: (sectionId: string | null) => void;
  setReuseEnvironment: (environmentId: string) => void;
  setStartedComposing: (started: boolean) => void;
  startedComposing: boolean;
}

function RootComposeSurface({
  composer,
  draftId,
  forkSeed,
  lastCreatedThreadId,
  resourceNotice,
  canApplyLocationSeeds,
  setForkSeed,
  setRootComposeProjectId,
  setRootComposeSectionId,
  setReuseEnvironment,
  setStartedComposing,
  startedComposing,
}: RootComposeSurfaceProps) {
  const paneContext = useOptionalPaneContext();
  const isFocusedPane = paneContext?.isFocused ?? true;
  const pluginDetails = usePluginDetailPanelState(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    isFocusedPane,
  );
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
      focus: () => requestComposerFocus(promptDraft.storageKey),
    }),
    [promptDraft.storageKey, sharedPluginComposerHost],
  );

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

  const setPromptDraft = promptDraft.setDraft;
  const restorePromptDraftIfEmpty = promptDraft.restoreIfEmpty;

  const consumedLocationKey = useRef<string | null>(null);
  const ownsLocation =
    canApplyLocationSeeds &&
    ownsRootComposeLocation(draftId, isFocusedPane, location);
  useEffect(() => {
    if (!ownsLocation || consumedLocationKey.current === location.key) return;
    const queryPrompt = readInitialPromptFromSearch(location.search);
    const initialPrompt = readInitialPromptFromLocationState(location.state);
    const nextForkSeed = readForkThreadCreateSeedFromLocationState(
      location.state,
    );
    const nextHandoffSeed = readThreadHandoffCreateSeedFromLocationState(
      location.state,
    );
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const hasSectionTarget =
      typeof location.state === "object" &&
      location.state !== null &&
      "sectionId" in location.state;
    const shouldFocus = shouldStartComposingFromLocationState(location.state);
    if (
      queryPrompt === null &&
      initialPrompt === null &&
      !hasSingleUseRootComposeTargetState(location.state)
    )
      return;
    consumedLocationKey.current = location.key;
    if (queryPrompt !== null) {
      setPromptDraft({ text: queryPrompt, mentions: [], attachments: [] });
    }
    if (hasSectionTarget) {
      setRootComposeSectionId(readSectionIdFromLocationState(location.state));
    }
    if (reuseEnvironmentId !== null) {
      setReuseEnvironment(reuseEnvironmentId);
      seedEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (nextForkSeed !== null && nextHandoffSeed === null) {
      setForkSeed(nextForkSeed);
      setProviderModelReasoning(nextForkSeed);
      setPermissionMode(nextForkSeed.permissionMode);
      setServiceTier(nextForkSeed.serviceTier);
      seedEnvironmentSelectionValue(
        encodeReuseValue(nextForkSeed.environmentId),
      );
    }
    if (nextHandoffSeed !== null) {
      setRootComposeProjectId(nextHandoffSeed.projectId);
      if (nextHandoffSeed.environmentId !== null) {
        setReuseEnvironment(nextHandoffSeed.environmentId);
        seedEnvironmentSelectionValue(
          encodeReuseValue(nextHandoffSeed.environmentId),
        );
      }
      setPromptDraft(buildThreadHandoffPromptDraft(nextHandoffSeed));
    }
    if (initialPrompt !== null) {
      const nextDraft = { text: initialPrompt, mentions: [], attachments: [] };
      if (shouldReplaceInitialPromptFromLocationState(location.state)) {
        setPromptDraft(nextDraft);
      } else {
        restorePromptDraftIfEmpty(nextDraft);
      }
    }
    if (
      shouldFocus ||
      queryPrompt !== null ||
      initialPrompt !== null ||
      nextHandoffSeed !== null ||
      nextForkSeed !== null
    ) {
      setStartedComposing(true);
      if (!isPointerCoarse) {
        window.requestAnimationFrame(() => promptBoxRef.current?.focusEnd());
      }
    }
    navigate(
      getRootComposeRoutePath() + stripInitialPromptFromSearch(location.search),
      { replace: true, state: null },
    );
  }, [
    isPointerCoarse,
    location.key,
    location.search,
    location.state,
    navigate,
    ownsLocation,
    promptBoxRef,
    restorePromptDraftIfEmpty,
    seedEnvironmentSelectionValue,
    setForkSeed,
    setPermissionMode,
    setPromptDraft,
    setProviderModelReasoning,
    setReuseEnvironment,
    setRootComposeProjectId,
    setRootComposeSectionId,
    setServiceTier,
    setStartedComposing,
  ]);

  const mobileRecentThreads = useMemo(
    () => buildMobileRecentThreads({ sidebarNavigation }),
    [sidebarNavigation],
  );
  const systemProviders = useSystemProviders().data;
  const mobileRecentProvidersById = useMemo(() => {
    const byId = new Map<string, ProviderInfo>();
    for (const provider of systemProviders ?? []) {
      byId.set(provider.id, provider);
    }
    return byId;
  }, [systemProviders]);
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

  const providerCliStatus = useHostProviderCliStatus({
    hostId: rootProjectHostId,
    enabled: rootProjectHostId !== null,
  });
  const { queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();
  const selectedProviderCliStatus =
    providerCliStatus.data?.[selectedProviderId] ?? null;
  const isProviderCliVersionBlocked =
    selectedProviderCliStatus?.versionUnsupported === true;
  const selectedProviderCliIssue = useMemo(() => {
    if (!isProviderCliVersionBlocked || selectedProviderCliStatus === null) {
      return null;
    }
    const issue = buildProviderCliIssue({
      provider: selectedProviderId,
      status: selectedProviderCliStatus,
    });
    return issue && hasProviderCliAction(issue) ? issue : null;
  }, [
    isProviderCliVersionBlocked,
    selectedProviderCliStatus,
    selectedProviderId,
  ]);
  const handleUpdateProviderCli = useCallback(() => {
    if (selectedProviderCliIssue === null || rootProjectHostId === null) return;
    startInstall({
      hostId: rootProjectHostId,
      issue: selectedProviderCliIssue,
    });
  }, [selectedProviderCliIssue, rootProjectHostId, startInstall]);

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
  const isCompactViewport = useIsCompactViewport();
  const secondaryPanelDrawerVisibility =
    useThreadSecondaryPanelDrawerVisibility({
      isCompactViewport,
      threadId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    });
  const isWorkspacePanelOpen = isCompactViewport
    ? secondaryPanelDrawerVisibility.isDrawerVisible
    : isPersistedSecondaryPanelOpen;
  const isSecondaryPanelOpen =
    isWorkspacePanelOpen || pluginDetails.activePluginId !== null;
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
  const [shouldAutoFocusTerminal, setShouldAutoFocusTerminal] = useState(false);
  const handleTerminalAutoFocusHandled = useCallback(
    () => setShouldAutoFocusTerminal(false),
    [],
  );
  const removeFixedTerminalTab = useRemoveFixedRightTerminalTab(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
    secondaryPanelDrawerVisibility.closeDrawer,
  );
  const setRootSecondaryPanel = useSetThreadSecondaryPanelSelection(
    ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    null,
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
      const selectedHostId = rootProjectHostId;
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
    }, [projectSources, rootPanelEnvironmentId, rootProjectHostId]);
  const rootPanelTerminalTarget = useMemo<RootComposeTerminalTarget | null>(
    () =>
      rootPanelEnvironmentId !== null
        ? { kind: "environment", environmentId: rootPanelEnvironmentId }
        : rootPanelHostPathTerminalTarget,
    [rootPanelEnvironmentId, rootPanelHostPathTerminalTarget],
  );
  const {
    checkThreadStorageFileExists: checkRootThreadStorageFileExists,
    threadStorageFiles: rootThreadStorageFiles,
  } = useThreadStorageViewer({
    fileListEnabled: shouldLoadThreadStorageFileList({
      hasThread: rootPanelThreadId !== null,
      isSecondaryPanelOpen,
      secondaryTabs: fixedPanelTabsState.secondary.tabs,
    }),
    threadId: rootPanelThreadId ?? undefined,
  });
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
    browserTabs,
    activateTab,
    closeTab,
    openPluginPanel,
    openTab,
    orderedSecondaryFileTabs,
    reopenClosedTab,
    reorderTab,
    selectFileSearchResult,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
    syncThreadId: null,
    environmentId: rootPanelEnvironmentId,
    fileOwnerThreadId: rootPanelThreadId,
    onCloseLastTab: secondaryPanelDrawerVisibility.closeDrawer,
    preserveWorkspaceTabsAcrossContexts: true,
    projectHostId: rootProjectHostId,
    projectId: isProjectless ? null : projectId,
    retainedTerminalId,
    storageFileExists: checkRootThreadStorageFileExists,
    storageFiles: rootThreadStorageFiles,
    terminalSessions: loadedTerminalSessions,
  });
  const rootPluginPanelActions = usePluginNewThreadPanelActions({
    openPluginPanel,
    projectId: isProjectless ? null : projectId,
  });
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
    (
      file: WorkspaceFileTabState,
      options?: { viewer?: FileOpenerOverride },
    ) => {
      openTab({ kind: "workspace-file-preview", tab: file }, options);
    },
    [openTab],
  );
  const openPersistedStorageFile = useCallback(
    (
      file: ThreadStorageFileTabState,
      options?: { viewer?: FileOpenerOverride },
    ) => {
      openTab({ kind: "thread-storage-file-preview", tab: file }, options);
    },
    [openTab],
  );
  const openPersistedHostFile =
    useCallback<ThreadSecondaryPanelHostFileOpenHandler>(
      (file: HostFileTabState, options) => {
        openTab({ kind: "host-file-preview", tab: file }, options);
      },
      [openTab],
    );
  const closeRootSecondaryPanel = useCallback(() => {
    setRootSecondaryPanel(null);
  }, [setRootSecondaryPanel]);
  const toggleRootPersistedSecondaryPanel = useCallback(() => {
    if (isPersistedSecondaryPanelOpen) {
      closeRootSecondaryPanel();
      return;
    }
    openTab({ kind: "new-tab" });
  }, [closeRootSecondaryPanel, isPersistedSecondaryPanelOpen, openTab]);
  const {
    closePanel: closeWorkspacePanel,
    openCompactDrawer,
    openHostFile,
    openStorageFile,
    openWorkspaceFile,
  } = useThreadSecondaryPanelVisibility({
    closePersistedPanel: closeRootSecondaryPanel,
    drawerVisibility: secondaryPanelDrawerVisibility,
    isCompactViewport,
    isPersistedOpen: isPersistedSecondaryPanelOpen,
    openPersistedCommitDiff: () => undefined,
    openPersistedDiffFile: () => undefined,
    openPersistedDiffPanel: () => undefined,
    openPersistedHostFile,
    openPersistedPanel: setRootSecondaryPanel,
    openPersistedStorageFile,
    openPersistedWorkspaceFile,
    togglePersistedPanel: toggleRootPersistedSecondaryPanel,
  });
  const dismissPluginDetails = pluginDetails.dismiss;
  const closeSecondaryPanel = useCallback(() => {
    dismissPluginDetails();
    closeWorkspacePanel();
  }, [dismissPluginDetails, closeWorkspacePanel]);
  const handleOpenLiveFilePreview = useCallback(
    (intent: AppFilePreviewIntent): boolean => {
      const normalized = normalizeExperimentalFileOpenOptions(intent);
      if (normalized === null) return false;
      const lineRange = toFilePreviewLineRange(normalized.location);
      const options =
        intent.viewer === undefined ? undefined : { viewer: intent.viewer };
      switch (normalized.target.kind) {
        case "workspace":
          if (normalized.target.environmentId !== rootPanelEnvironmentId) {
            return false;
          }
          openWorkspaceFile(
            {
              lineRange,
              path: normalized.target.path,
              source: { kind: "working-tree" },
              statusLabel: null,
            },
            options,
          );
          return true;
        case "host":
          if (
            rootPanelThreadId === null ||
            normalized.target.hostId !== rootPanelEnvironment?.hostId
          ) {
            return false;
          }
          openHostFile({ lineRange, path: normalized.target.path }, options);
          return true;
        case "thread-storage":
          if (normalized.target.threadId !== rootPanelThreadId) return false;
          openStorageFile({ lineRange, path: normalized.target.path }, options);
          return true;
      }
    },
    [
      openHostFile,
      openStorageFile,
      openWorkspaceFile,
      rootPanelEnvironment?.hostId,
      rootPanelEnvironmentId,
      rootPanelThreadId,
    ],
  );
  const appNavigationCapabilities = useMemo(
    () => ({
      openFilePreview: handleOpenLiveFilePreview,
      openFixedTab: (intent: AppFixedTabOpenIntent) =>
        openAppFixedTabFromDestinations([], intent),
    }),
    [handleOpenLiveFilePreview],
  );
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
        return () => {
          handleOpenLiveFilePreview({
            target: {
              kind: "thread-storage",
              threadId: rootPanelThreadId,
              path: resource.path,
            },
            location: null,
          });
        };
      }
      if (isProjectless) {
        return null;
      }
      if (rootPanelEnvironmentId === null) return null;
      return () => {
        handleOpenLiveFilePreview({
          target: {
            kind: "workspace",
            environmentId: rootPanelEnvironmentId,
            path: resource.path,
          },
          location: null,
        });
      };
    },
    [
      isProjectless,
      handleOpenLiveFilePreview,
      navigate,
      projectId,
      rootPanelEnvironmentId,
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
    ({
      activeBrowserTabId,
      canHandleBrowserCommands,
      canShowNativeBrowserView,
      onNativeFocus,
    }: {
      activeBrowserTabId: string | null;
      canHandleBrowserCommands: boolean;
      canShowNativeBrowserView: boolean;
      onNativeFocus: () => void;
    }) => {
      if (rootPanelThreadId === null) {
        return null;
      }
      return (
        <LazyBrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTabId}
          addressFocusRequest={browserAddressFocusRequest}
          onAddressFocusRequestConsumed={
            handleBrowserAddressFocusRequestConsumed
          }
          environmentId={rootPanelEnvironmentId}
          canShowNativeBrowserView={canShowNativeBrowserView}
          canHandleBrowserCommands={canHandleBrowserCommands}
          onNativeFocus={onNativeFocus}
          threadId={rootPanelThreadId}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [
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
  useAppCommandHandler("panel.reopenClosedTab", () => {
    if (!isFocusedPane || !reopenClosedTab()) return false;
    openCompactDrawer();
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
    if (pluginDetails.activePluginId !== null) {
      pluginDetails.close(pluginDetails.activePluginId);
      return true;
    }
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
    closeSecondaryPanel();
    return true;
  }, [
    activeFixedSecondaryTab,
    closeSecondaryPanel,
    closeTab,
    handleCloseTerminalTab,
    isSecondaryPanelOpen,
    pluginDetails,
  ]);
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
  const renderRootPanelTabContent = useCallback(
    (
      tab: (typeof syncedOrderedSecondaryFileTabs)[number],
      pane: SecondaryPanelPaneRenderContext,
    ) => (
      <RootComposePanelTabContent
        activeTabId={activeFixedSecondaryTabId}
        canCreateTerminal={canCreateRootTerminal}
        currentProjectId={projectId}
        isPanelOpen={isSecondaryPanelOpen}
        isPanelPersistedOpen={isPersistedSecondaryPanelOpen}
        isProjectless={isProjectless}
        onActivateTab={activateTab}
        onAutoFocusNewTabHandled={handleNewTabAutoFocusHandled}
        onAutoFocusTerminalHandled={handleTerminalAutoFocusHandled}
        onOpenBrowser={openBrowserTabAndReveal}
        onOpenPanelLink={handleOpenPanelLink}
        onSelectFileSearchResult={handleSelectFileSearchResult}
        onSelectionAddToChat={handleRootPanelSelectionAddToChat}
        onStartTerminal={handleStartTerminal}
        pane={pane}
        primaryHostId={primaryHostId}
        pluginActions={rootPluginPanelActions}
        projectSources={projectSources}
        projects={projects}
        rootPanelEnvironmentId={rootPanelEnvironmentId}
        rootPanelThreadId={rootPanelThreadId}
        rootProjectHostId={rootProjectHostId}
        shouldAutoFocusNewTab={shouldAutoFocusNewTab}
        shouldAutoFocusTerminal={shouldAutoFocusTerminal}
        tab={tab}
        terminalTarget={rootPanelTerminalTarget}
      />
    ),
    [
      activateTab,
      activeFixedSecondaryTabId,
      canCreateRootTerminal,
      handleNewTabAutoFocusHandled,
      handleOpenPanelLink,
      handleRootPanelSelectionAddToChat,
      handleSelectFileSearchResult,
      handleStartTerminal,
      handleTerminalAutoFocusHandled,
      isPersistedSecondaryPanelOpen,
      isProjectless,
      isSecondaryPanelOpen,
      openBrowserTabAndReveal,
      projectId,
      primaryHostId,
      projectSources,
      projects,
      rootPanelEnvironmentId,
      rootPanelThreadId,
      rootPanelTerminalTarget,
      rootPluginPanelActions,
      rootProjectHostId,
      shouldAutoFocusNewTab,
      shouldAutoFocusTerminal,
    ],
  );
  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(() => {
    const filenameOf = (path: string) => path.split("/").at(-1) ?? path;
    const tabs = syncedOrderedSecondaryFileTabs.map(
      (tab): SecondaryPanelRenderableTab => {
        const pluginAction =
          tab.kind === "plugin-panel"
            ? rootPanelNewThreadPanelActions.find(
                (action) =>
                  action.pluginId === tab.pluginId &&
                  action.id === tab.actionId,
              )
            : undefined;
        const shared = {
          contentFillsRegion:
            tab.kind === "plugin-panel" &&
            (tab.fileOpenerOwner !== undefined ||
              pluginAction?.layout === "flush"),
          onClose: () => closeTab(tab.id),
          renderContent: (pane: SecondaryPanelPaneRenderContext) =>
            renderRootPanelTabContent(tab, pane),
          tab,
        };
        switch (tab.kind) {
          case "browser": {
            const browserLabel =
              tab.title ??
              (tab.url.length > 0 ? getBrowserUrlHost(tab.url) : "");
            return {
              ...shared,
              label: browserLabel.length > 0 ? browserLabel : "Browser",
              leadingVisual: (
                <Icon
                  name="Globe"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
            };
          }
          case "terminal": {
            const session = terminalsById.get(tab.terminalId);
            return {
              ...shared,
              label: session?.title ?? "Terminal",
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
                  : session.status,
              onSelect: () => handleActivateTerminalTab(tab.terminalId),
              onClose: () => handleCloseTerminalTab(tab.terminalId),
            };
          }
          case "workspace-file-preview":
            return {
              ...shared,
              label: filenameOf(tab.path),
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: tab.statusLabel,
              onSelect: () => handleActivateFileTab(tab.id),
            };
          case "host-file-preview":
            return {
              ...shared,
              label: filenameOf(tab.path),
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
            };
          case "thread-storage-file-preview":
            return {
              ...shared,
              label: filenameOf(tab.path),
              isPinned: tab.isPinned,
              leadingVisual: <RightPanelFileTabIcon path={tab.path} />,
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
            };
          case "new-tab":
            return {
              ...shared,
              label: "New tab",
              leadingVisual: (
                <Icon
                  name="NewTab"
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  aria-hidden
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
            };
          case "plugin-panel":
            return {
              ...shared,
              label: tab.title,
              leadingVisual: (
                <PluginIcon
                  pluginId={tab.pluginId}
                  icon={pluginAction?.icon ?? null}
                  className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                />
              ),
              statusLabel: null,
              onSelect: () => handleActivateFileTab(tab.id),
            };
        }
      },
    );
    return tabs;
  }, [
    closeTab,
    handleActivateFileTab,
    handleActivateTerminalTab,
    handleCloseTerminalTab,
    renderRootPanelTabContent,
    rootPanelNewThreadPanelActions,
    syncedOrderedSecondaryFileTabs,
    terminalsById,
  ]);
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
  const showPinnedToggle =
    (paneContext?.secondaryPanelHost ?? null) === null &&
    (!isSecondaryPanelOpen || isCompactViewport);
  const rootPanelToggle = showPinnedToggle ? (
    <div
      className={`fixed z-40 ${ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS} ${
        isSecondaryPanelOpen ? "pointer-events-none invisible" : ""
      }`}
    >
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
  useEffect(() => {
    if (!startedComposing || !isFocusedPane) return;
    if (isProviderCliVersionBlocked) return;
    if (isPointerCoarse) return;
    const handle = window.requestAnimationFrame(() => {
      promptBoxRef.current?.focusEnd();
    });
    return () => window.cancelAnimationFrame(handle);
  }, [
    isFocusedPane,
    isProviderCliVersionBlocked,
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
      if (parsedEnvironment?.type === "provider") {
        setEnvironmentSelectionValue(
          encodeProviderValue(parsedEnvironment.environmentProviderId),
          setUpHostId,
        );
        return;
      }
      setEnvironmentSelectionValue(
        encodeProviderValue(PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID),
        setUpHostId,
      );
    },
    [parsedEnvironment, setEnvironmentSelectionValue],
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
        {}
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
    if (!isProviderCliVersionBlocked || selectedProviderCliStatus === null) {
      return null;
    }
    return (
      <ProviderCliVersionBanner
        displayName={selectedProviderCliStatus.displayName}
        currentVersion={selectedProviderCliStatus.currentVersion}
        minimumSupportedVersion={
          selectedProviderCliStatus.minimumSupportedVersion
        }
        canUpdate={selectedProviderCliIssue !== null}
        updating={
          rootProjectHostId !== null &&
          (runningJobKey ===
            providerCliJobKey(rootProjectHostId, selectedProviderId) ||
            queuedJobKeys.has(
              providerCliJobKey(rootProjectHostId, selectedProviderId),
            ))
        }
        onUpdate={handleUpdateProviderCli}
      />
    );
  }, [
    rootProjectHostId,
    handleUpdateProviderCli,
    isProviderCliVersionBlocked,
    queuedJobKeys,
    runningJobKey,
    selectedProviderCliIssue,
    selectedProviderCliStatus,
    selectedProviderId,
  ]);

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
    id: `root-compose-prompt-${draftId}`,
    autoFocus: isFocusedPane && !isProviderCliVersionBlocked,
    allowSoftKeyboardAutoFocus: isFocusedPane && isCompactViewport,
    banner: (
      <>
        {resourceNotice}
        {!projects && sidebarNavigationError ? (
          <p className="text-xs text-destructive">
            Could not load projects. Your draft is kept here.
          </p>
        ) : null}
        {promptBanner}
      </>
    ),
    header: promptHeader,
    blockedReason: isProviderCliVersionBlocked
      ? `Update ${selectedProviderCliStatus?.displayName ?? selectedProviderId} before starting a thread.`
      : undefined,
    resolveMentionLink,
    pluginComposerHost,
    textEffects: promptTextEffects,
    allowNoProject: true,
    createProject: {
      onCreate: () =>
        quickCreateProject.openCreateDialogForSelection(composer.selectProject),
      disabled:
        !quickCreateProject.isAvailable || quickCreateProject.isCreating,
      isCreating: quickCreateProject.isCreating,
    },
    onRequestMachineSetup: handleRequestMachineSetup,
    locks: {
      project: isForkDraft,
      provider: isForkDraft,
      environment: isForkDraft,
    },
  });

  return (
    <PluginDetailPanelContext.Provider value={pluginDetails}>
      <RootComposePanelCommandHandlers
        isFocused={isFocusedPane}
        onClose={handleCloseWindowRequest}
        onToggle={handleToggleSecondaryPanel}
      />
      {machineSetupDialog}
      {rootPanelToggle}
      <PluginComposerHostProvider value={pluginComposerHost}>
        <UrlOpenRoutingProvider
          openInAppBrowser={
            desktopBrowserAvailable && rootPanelThreadId !== null
              ? openBrowserTabAndReveal
              : null
          }
        >
          <AppNavigationHostProvider capabilities={appNavigationCapabilities}>
            <RootComposeSecondaryContent
              contentClassName={
                showEmptyWelcome
                  ? ROOT_COMPOSE_EMPTY_WELCOME_CONTENT_CLASS
                  : ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS
              }
              compactScrollContent={
                showEmptyWelcome ? null : (
                  <RootComposeMobileRecents
                    highlightedThreadId={lastCreatedThreadId}
                    projectNamesById={mobileRecentProjectNamesById}
                    providersById={mobileRecentProvidersById}
                    showCreatingRow={isSubmitting}
                    threads={mobileRecentThreads}
                  />
                )
              }
              isSecondaryPanelOpen={isSecondaryPanelOpen}
              onToggleSecondaryPanel={handleToggleSecondaryPanel}
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
                tabs: panelTabs,
                splitPanelStateId: ROOT_COMPOSE_FIXED_PANEL_STATE_ID,
                renderBrowserDeck,
                isOpen: isSecondaryPanelOpen,
                fixedTabs: [],
                showConversationCollapseControl: false,
                onClose: closeSecondaryPanel,
                onCollapse: closeSecondaryPanel,
                onTabReorder: reorderTab,
                onOpenNewTab: handleOpenNewTab,
                onOpenFilePreview: handleOpenFilePreview,
                onSelectionAddToChat: handleRootPanelSelectionAddToChat,
                onPanelFocus: touchFixedPanelTabsState,
              }}
            >
              {showEmptyWelcome ? (
                <RootComposeEmptyWelcome
                  onCompose={handleStartComposing}
                  onAddProject={quickCreateProject.openCreateDialog}
                  addProjectDisabled={
                    !quickCreateProject.isAvailable ||
                    quickCreateProject.isCreating
                  }
                />
              ) : (
                promptBox
              )}
            </RootComposeSecondaryContent>
          </AppNavigationHostProvider>
        </UrlOpenRoutingProvider>
      </PluginComposerHostProvider>
    </PluginDetailPanelContext.Provider>
  );
}
