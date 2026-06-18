import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type PermissionMode,
  type ProjectSource,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  NewThreadPromptBox,
  type NewThreadProjectConfig,
} from "@/components/promptbox/NewThreadPromptBox";
import { type PromptBoxHandle } from "@/components/promptbox/PromptBoxInternal";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import {
  useProjectPromptHistory,
  useProjectSourceBranches,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import { useProjectDefaultExecutionOptions } from "@/hooks/queries/project-default-execution-options-query";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
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
  isProjectlessProjectId,
  type ThreadRoutePathArgs,
} from "@/lib/route-paths";
import {
  useRootComposeProjectId,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import {
  buildRootComposeBranchUiState,
  type RootComposeBranchEnvironmentMode,
} from "./root-compose-branch-ui";
import { resolveRootComposeThreadEnvironment } from "./root-compose-thread-environment";
import { useScopedBranchSelection } from "./root-compose-branch-selection";
import { RootComposeMobileRecents } from "./RootComposeMobileRecents";

const ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY = "bb.promptbox.zen-mode.root-compose";
const ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS = "pt-2";

type ProjectSelectionChangeHandler = NewThreadProjectConfig["onChange"];

interface LegacyProjectComposeRedirectProps {
  projectId: string;
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

export function RootComposeRoute() {
  const { projectId } = useParams<{ projectId: string }>();

  if (projectId) {
    return <LegacyProjectComposeRedirect projectId={projectId} />;
  }

  return <RootComposeView surface="page" />;
}

export function RootComposeView(props: RootComposeViewProps) {
  const [rootComposeProjectId, setRootComposeProjectId] =
    useRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
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
  const promptMentions = usePromptMentions(
    isProjectless ? undefined : projectId,
    {
      environmentId: null,
    },
  );
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

  // Seed transient picker state from navigation state: `reuseEnvironmentId`
  // (the "+" affordance on a worktree) seeds the env picker into reuse mode for
  // that env. A fork seed also pins the first create request to the source
  // thread/environment. This is single-use — clear location.state after applying
  // so a refresh starts from persisted root-compose selection.
  useEffect(() => {
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const nextForkSeed = readForkThreadCreateSeedFromLocationState(
      location.state,
    );
    if (reuseEnvironmentId === null && nextForkSeed === null) return;
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
      (forkSeed === null && !selectedEnvironment)
    ) {
      return;
    }

    try {
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
      promptDraft.clearIfCurrentMatches(submittedDraft);
      if (props.surface === "popout") {
        props.onThreadCreated({
          projectId: thread.projectId,
          threadId: thread.id,
        });
      } else if (navigateToThreadAfterCreate) {
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
    navigate,
    navigateToThreadAfterCreate,
    permissionMode,
    projectId,
    props,
    promptDraft,
    reasoningLevel,
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
  // The new-thread composer has no environment yet, so only thread mentions are
  // openable here (they navigate). File pills stay non-interactive.
  const resolveMentionLink = useCallback<PromptMentionLinkResolver>(
    (resource) =>
      resource.kind === "thread"
        ? () =>
            navigate(
              getSurfaceAwareThreadRoutePath({
                projectId: resource.projectId ?? projectId,
                surface: props.surface,
                threadId: resource.threadId,
              }),
            )
        : null,
    [navigate, projectId, props.surface],
  );
  // Mirrors the @-mention plumbing: the composer feeds the text typed after the
  // command trigger into `commandQuery`, which drives command typeahead. In
  // projectless compose, the server resolves the personal project to user-home
  // command discovery with cwd: null.
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const reuseEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const commandSuggestions = useCommandSuggestions({
    projectId,
    providerId: selectedProviderId,
    environmentId: reuseEnvironmentId,
    query: commandQuery,
  });
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
    if (forkSeed === null) return null;
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
      modeConfig={{
        environment: environmentConfig,
        branch: branchConfig,
        worktree: worktreeConfig,
        permission: permissionConfig,
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
    return <div className="w-full">{promptBox}</div>;
  }

  return (
    <PageShell
      contentClassName={ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS}
    >
      {promptBox}
      <RootComposeMobileRecents
        highlightedThreadId={lastCreatedThreadId}
        projectNamesById={mobileRecentProjectNamesById}
        showCreatingRow={createThread.isPending}
        threads={mobileRecentThreads}
      />
    </PageShell>
  );
}
