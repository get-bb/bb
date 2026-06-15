import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
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
  const primaryHostId = usePrimaryHost()?.id ?? null;
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({ projectId, threadId: null });
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
    projectId,
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
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  } = creationOptions;
  const executionInputSources = creationOptions.executionInputSources;

  // Seed transient picker state from navigation state: `reuseEnvironmentId`
  // (the "+" affordance on a worktree) seeds the env picker into reuse mode
  // for that env. This is single-use — clear location.state after applying so
  // a refresh starts from persisted root-compose selection.
  useEffect(() => {
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    if (reuseEnvironmentId === null) return;
    if (reuseEnvironmentId !== null) {
      setEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    navigate(getRootComposeRoutePath() + location.search, {
      replace: true,
      state: null,
    });
  }, [location.search, location.state, navigate, setEnvironmentSelectionValue]);

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

  // Projectless threads choose a host directly, not an environment mode. Keep
  // the underlying persisted value host-shaped for the create-thread contract,
  // but discard reuse/worktree mode when resolving the effective value.
  const effectiveEnvironmentValue = useMemo(() => {
    const parsedSelection = parseEnvironmentValue(environmentSelectionValue);
    if (isProjectless) {
      return primaryHostId ? encodeHostValue(primaryHostId, "local") : "";
    }
    if (parsedSelection?.type === "reuse") {
      return environmentSelectionValue;
    }
    if (primaryHostId) {
      return encodeHostValue(
        primaryHostId,
        parsedSelection?.type === "host" ? parsedSelection.mode : "local",
      );
    }
    return "";
  }, [environmentSelectionValue, isProjectless, primaryHostId]);
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
    rememberSelection: branchEnvironmentMode === "worktree",
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
  const branchSelectionSeed =
    branchEnvironmentMode === "local" &&
    activeBranchesQuery.data?.checkout.kind === "branch"
      ? activeBranchesQuery.data.checkout.branchName
      : branchEnvironmentMode === "worktree"
        ? (activeBranchesQuery.data?.defaultBranch ?? null)
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
        environmentValue: effectiveEnvironmentValue,
        projectId,
        selectedBranch,
      }),
    [effectiveEnvironmentValue, projectId, selectedBranch],
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
      !selectedEnvironment
    ) {
      return;
    }

    try {
      const thread = await createThread.mutateAsync({
        input: submittedInput,
        projectId,
        providerId: selectedProviderId,
        model: selectedThreadModel,
        ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
        reasoningLevel,
        permissionMode,
        executionInputSources,
        environment: selectedEnvironment,
      });
      setLastCreatedThreadId(thread.id);
      clearReuseEnvironment();
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
    !selectedThreadModel ||
    createThread.isPending ||
    promptInput.length === 0 ||
    !selectedEnvironment ||
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
  // command trigger into `commandQuery`, which drives the project+provider-
  // scoped command typeahead. When the picker reuses an existing environment,
  // scope discovery to that environment's workspace; otherwise fall back to the
  // project's default source (null).
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const reuseEnvironmentId =
    parsedEnvironment?.type === "reuse"
      ? parsedEnvironment.environmentId
      : null;
  const commandSuggestions = useCommandSuggestions({
    projectId: isProjectless ? undefined : projectId,
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
      commandSuggestions.isLoading,
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
        onChange: setSelectedProviderId,
        hasMultiple: hasMultipleProviders,
      },
      model: {
        active: activeModel,
        selected: selectedModel,
        options: modelOptions,
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
      hasMultipleProviders,
      modelLoadError,
      modelOptions,
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
  const environmentConfig = useMemo(
    () => ({
      value: effectiveEnvironmentValue,
      onChange: setEnvironmentSelectionValue,
      sources: projectSources,
      reuseDisabled: reuseThreadOptions.length === 0,
    }),
    [
      effectiveEnvironmentValue,
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
    };
  }, [parsedEnvironment, reuseThreadOptions, setEnvironmentSelectionValue]);
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

  const reuseHeader = useMemo(() => {
    if (parsedEnvironment?.type !== "reuse") return null;
    return (
      <div className="flex">
        {/* `-ml-1.5` shifts the pill 6px left so its GitBranch icon column
            lines up with the prompt controls below the card. */}
        <button
          type="button"
          onClick={clearReuseEnvironment}
          title="Stop reusing and start a regular new thread"
          aria-label="Stop reusing worktree"
          className="group -ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
            <Icon
              name="GitBranch"
              className="size-3.5 transition-opacity group-hover:opacity-0"
              aria-hidden
            />
            <Icon
              name="X"
              className="absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          </span>
          Reusing existing worktree
        </button>
      </div>
    );
  }, [clearReuseEnvironment, parsedEnvironment]);

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
        header: reuseHeader,
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
