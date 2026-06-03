import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
import {
  NewThreadPromptBox,
  type NewThreadHostConfig,
  type NewThreadProjectConfig,
  type ThreadCreationMode,
} from "@/components/promptbox/NewThreadPromptBox";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  useHireProjectManager,
  useUploadPromptAttachment,
} from "@/hooks/mutations/project-mutations";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import {
  useProjectPromptHistory,
  useProjectDefaultExecutionOptions,
  useProjectSourceBranches,
  useSidebarNavigation,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { promptDraftToInput } from "@/lib/prompt-draft";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  getThreadRoutePath,
  getRootComposeRoutePath,
  isProjectlessProjectId,
} from "@/lib/app-route-paths";
import {
  useRootComposeMode,
  useRootComposeProjectId,
  useSetRootComposeProjectId,
} from "@/lib/root-compose-selection";
import {
  buildRootComposeBranchUiState,
  type RootComposeBranchEnvironmentMode,
} from "./root-compose-branch-ui";
import { resolveRootComposeThreadEnvironment } from "./root-compose-thread-environment";
import { useScopedBranchSelection } from "./root-compose-branch-selection";

const ROOT_COMPOSE_ZEN_MODE_STORAGE_KEY = "bb.promptbox.zen-mode.root-compose";
const ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS = "pt-2";

type ProjectSelectionChangeHandler = NewThreadProjectConfig["onChange"];
type HostSelectionChangeHandler = NewThreadHostConfig["onChange"];

interface LegacyProjectComposeRedirectProps {
  projectId: string;
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

function readModeFromLocationState(state: unknown): ThreadCreationMode | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { mode?: unknown }).mode;
  return candidate === "manager" || candidate === "thread" ? candidate : null;
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
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    if (left.branchName && right.branchName) {
      return left.branchName.localeCompare(right.branchName);
    }
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
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

  return <RootComposeView />;
}

export function RootComposeView() {
  const [rootComposeProjectId, setRootComposeProjectId] =
    useRootComposeProjectId();
  const location = useLocation();
  const navigate = useNavigate();
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
  const hireProjectManager = useHireProjectManager();
  const { isLocalHost, localHostId } = useHostDaemon();
  const hostsQuery = useEffectiveHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({ projectId, threadId: null });
  const { data: projectPromptHistory = [] } =
    useProjectPromptHistory(projectId);
  const [mode, setMode] = useRootComposeMode();
  const promptMentions = usePromptMentions(
    isProjectless ? undefined : projectId,
    {
      threadSuggestionMode: mode === "manager" ? "all" : "none",
      environmentId: null,
    },
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // Manager-mode host selection. Held as a raw user choice; the effective
  // value resolved against the loaded hosts is computed below so a stale
  // selection (host disconnects) falls back to a safe default without an effect.
  const [managerHostSelection, setManagerHostSelection] = useState<string>("");
  const prompt = promptDraft.text;
  const promptInput = useMemo(
    () =>
      promptDraftToInput({
        text: promptDraft.text,
        attachments: promptDraft.attachments,
      }),
    [promptDraft.attachments, promptDraft.text],
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
  const managerDefaultExecutionOptionsQuery = useProjectDefaultExecutionOptions(
    {
      projectId,
      threadType: "manager",
    },
    {
      enabled: mode === "manager" && currentProject !== undefined,
    },
  );
  const managerDefaultExecutionOptions =
    managerDefaultExecutionOptionsQuery.data ?? undefined;
  const standardCreationOptions = useThreadCreationOptions({
    scope: "new-thread",
    projectId,
  });
  const managerCreationOptions = useThreadCreationOptions({
    enabled: mode === "manager",
    initialModel: managerDefaultExecutionOptions?.model,
    initialProviderId: managerDefaultExecutionOptions?.providerId,
    initialReasoningLevel: managerDefaultExecutionOptions?.reasoningLevel,
    initialServiceTier: managerDefaultExecutionOptions?.serviceTier,
    projectId,
    resetKey: projectId,
    scope: "new-manager",
  });
  const creationOptions =
    mode === "manager" ? managerCreationOptions : standardCreationOptions;
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
  const standardExecutionInputSources =
    standardCreationOptions.executionInputSources;
  const managerExecutionInputSources =
    managerCreationOptions.executionInputSources;

  // Seed transient picker state from navigation state:
  // `reuseEnvironmentId` (the "+" affordance on a worktree) seeds the env
  // picker into reuse mode for that env, and `mode` seeds the mode picker.
  // Both are single-use — clear location.state after applying so a refresh
  // starts from persisted root-compose selection.
  useEffect(() => {
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const seededMode = readModeFromLocationState(location.state);
    if (reuseEnvironmentId === null && seededMode === null) return;
    if (reuseEnvironmentId !== null) {
      setEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (seededMode !== null) {
      setMode(seededMode);
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
    setMode,
  ]);

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

  // Standard-project managers need a local-path source on the host. Projectless
  // managers only need a connected host.
  const eligibleManagerHosts = useMemo(
    () =>
      hosts.filter(
        (host) =>
          host.status === "connected" &&
          (isProjectless ||
            findLocalPathProjectSourceForHost(projectSources, host.id) !==
              undefined),
      ),
    [hosts, isProjectless, projectSources],
  );
  const defaultManagerHostId = useMemo(() => {
    const local = eligibleManagerHosts.find((host) => isLocalHost(host.id));
    return local?.id ?? eligibleManagerHosts[0]?.id ?? "";
  }, [eligibleManagerHosts, isLocalHost]);
  const effectiveManagerHostId = useMemo(() => {
    const isEligible = eligibleManagerHosts.some(
      (host) => host.id === managerHostSelection,
    );
    return managerHostSelection && isEligible
      ? managerHostSelection
      : defaultManagerHostId;
  }, [defaultManagerHostId, eligibleManagerHosts, managerHostSelection]);
  const eligibleProjectlessThreadHosts = useMemo(
    () => hosts.filter((host) => host.status === "connected"),
    [hosts],
  );
  const defaultProjectlessThreadHostId = useMemo(() => {
    const local = eligibleProjectlessThreadHosts.find((host) =>
      isLocalHost(host.id),
    );
    return (
      local?.id ?? eligibleProjectlessThreadHosts[0]?.id ?? localHostId ?? ""
    );
  }, [eligibleProjectlessThreadHosts, isLocalHost, localHostId]);

  // Projectless threads choose a host directly, not an environment mode. Keep
  // the underlying persisted value host-shaped for the create-thread contract,
  // but discard reuse/worktree mode when resolving the effective value.
  const effectiveEnvironmentValue = useMemo(() => {
    const parsedSelection = parseEnvironmentValue(environmentSelectionValue);
    if (isProjectless) {
      if (parsedSelection?.type === "host") {
        const selectedHostIsEligible =
          eligibleProjectlessThreadHosts.length === 0 ||
          eligibleProjectlessThreadHosts.some(
            (host) => host.id === parsedSelection.hostId,
          );
        if (selectedHostIsEligible) {
          return encodeHostValue(parsedSelection.hostId, "local");
        }
      }
      if (defaultProjectlessThreadHostId) {
        return encodeHostValue(defaultProjectlessThreadHostId, "local");
      }
      return "";
    }
    if (environmentSelectionValue && parsedSelection) {
      return environmentSelectionValue;
    }
    if (localHostId) {
      return encodeHostValue(localHostId, "local");
    }
    return "";
  }, [
    defaultProjectlessThreadHostId,
    eligibleProjectlessThreadHosts,
    environmentSelectionValue,
    isProjectless,
    localHostId,
  ]);
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(effectiveEnvironmentValue),
    [effectiveEnvironmentValue],
  );
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  useEffect(() => {
    setBranchSearchQuery("");
  }, [effectiveEnvironmentValue, projectId]);
  const isHostMode = parsedEnvironment?.type === "host";
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
  const isHostLocalMode = isHostMode && parsedEnvironment.mode === "local";
  const branchEnvironmentMode: RootComposeBranchEnvironmentMode = isProjectless
    ? "other"
    : isHostLocalMode
      ? "local"
      : isHostMode && parsedEnvironment.mode === "worktree"
        ? "worktree"
        : "other";
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
  const branchOptionsTruncated = Boolean(
    activeBranchesQuery.data?.branchesTruncated ||
    ((branchEnvironmentMode === "local" ||
      branchEnvironmentMode === "worktree") &&
      activeBranchesQuery.data?.remoteBranchesTruncated),
  );
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

  const selectedThreadModel = activeModel?.model ?? selectedModel;
  const handleProjectChange = useCallback<ProjectSelectionChangeHandler>(
    (nextProjectId) => {
      const nextRootComposeProjectId = nextProjectId ?? PERSONAL_PROJECT_ID;
      if (nextRootComposeProjectId === projectId) return;
      setRootComposeProjectId(nextRootComposeProjectId);
    },
    [projectId, setRootComposeProjectId],
  );
  const handleProjectlessThreadHostChange =
    useCallback<HostSelectionChangeHandler>(
      (hostId) => {
        setEnvironmentSelectionValue(encodeHostValue(hostId, "local"));
      },
      [setEnvironmentSelectionValue],
    );

  const shouldFocusPrompt =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusPrompt" in location.state &&
    location.state.focusPrompt === true;

  useEffect(() => {
    if (!shouldFocusPrompt) return;
    const handle = window.requestAnimationFrame(() => {
      const promptEl = document.getElementById("root-compose-prompt");
      if (!(promptEl instanceof HTMLTextAreaElement)) return;
      promptEl.focus();
      const caretIndex = promptEl.value.length;
      promptEl.setSelectionRange(caretIndex, caretIndex);
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
      attachments: promptDraft.attachments,
    };
    const submittedInput = promptDraftToInput(submittedDraft);
    if (!projectId || !selectedProviderId || !selectedThreadModel) {
      return;
    }

    setAttachmentError(null);

    if (mode === "manager") {
      // Managers don't require a prompt — submitting with empty text just
      // falls back to the server's welcome-message template. Host comes
      // from the manager-mode host picker.
      if (
        hireProjectManager.isPending ||
        managerDefaultExecutionOptionsQuery.isLoading ||
        !effectiveManagerHostId
      ) {
        return;
      }
      try {
        const thread = await hireProjectManager.mutateAsync({
          projectId,
          providerId: selectedProviderId,
          model: selectedThreadModel,
          ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
          reasoningLevel,
          executionInputSources: managerExecutionInputSources,
          environment: { type: "host", hostId: effectiveManagerHostId },
          ...(submittedInput.length > 0 ? { input: submittedInput } : {}),
        });
        promptDraft.clearIfCurrentMatches(submittedDraft);
        navigate(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        );
      } catch {
        // Global mutation error handling already surfaced the failure.
      }
      return;
    }

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
        executionInputSources: standardExecutionInputSources,
        environment: selectedEnvironment,
      });
      promptDraft.clearIfCurrentMatches(submittedDraft);
      navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    } catch {
      // Global mutation error handling already surfaced the failure.
    }
  }, [
    createThread,
    effectiveManagerHostId,
    hireProjectManager,
    managerExecutionInputSources,
    managerDefaultExecutionOptionsQuery.isLoading,
    mode,
    navigate,
    permissionMode,
    projectId,
    promptDraft,
    reasoningLevel,
    selectedEnvironment,
    selectedProviderId,
    selectedThreadModel,
    serviceTier,
    standardExecutionInputSources,
    supportsServiceTier,
  ]);

  // Manager-mode submission relaxes the prompt-required and env-resolution
  // checks (managers don't take a prompt or a worktree-shaped env). Both
  // modes still require provider + model and a project; manager mode also
  // needs an eligible host resolved.
  const isSubmitDisabled =
    !selectedProviderId ||
    !selectedThreadModel ||
    (mode === "manager"
      ? hireProjectManager.isPending ||
        managerDefaultExecutionOptionsQuery.isLoading ||
        !effectiveManagerHostId
      : createThread.isPending ||
        promptInput.length === 0 ||
        !selectedEnvironment ||
        (branchEnvironmentMode === "local" &&
          selectedBranch !== null &&
          branchUiState.mutationBlocker !== null));

  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.text],
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
  const mentionsConfig = useMemo(
    () => ({
      suggestions: promptMentions.suggestions,
      threadSectionMode: promptMentions.threadSectionMode,
      isLoading: promptMentions.isLoading,
      isError: promptMentions.isError,
      onQueryChange: promptMentions.setQuery,
    }),
    [
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      promptMentions.threadSectionMode,
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
  const projectlessThreadHostConfig = useMemo(
    (): NewThreadHostConfig => ({
      hosts,
      eligibleHosts: eligibleProjectlessThreadHosts,
      value:
        parsedEnvironment?.type === "host"
          ? parsedEnvironment.hostId
          : defaultProjectlessThreadHostId,
      onChange: handleProjectlessThreadHostChange,
      isLocalHost,
    }),
    [
      defaultProjectlessThreadHostId,
      eligibleProjectlessThreadHosts,
      handleProjectlessThreadHostChange,
      hosts,
      isLocalHost,
      parsedEnvironment,
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
      optionsTruncated: branchOptionsTruncated,
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
      branchOptionsTruncated,
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
            lines up with the mode-selector icon above the card (mode
            selector has `px-1` on its trigger; the pill has `px-2.5`). */}
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

  return (
    <PageShell
      contentClassName={ROOT_COMPOSE_SIDEBAR_ACTION_ALIGNED_TOP_PADDING_CLASS}
    >
      <NewThreadPromptBox
        id="root-compose-prompt"
        value={prompt}
        onChange={promptDraft.setText}
        onSubmit={submitPrompt}
        isSubmitting={
          mode === "manager"
            ? hireProjectManager.isPending
            : createThread.isPending
        }
        disabled={isSubmitDisabled}
        zenModeStorageKey={rootComposeZenModeStorageKey}
        history={historyConfig}
        mentions={mentionsConfig}
        attachments={attachmentsConfig}
        modeConfig={
          mode === "manager"
            ? {
                mode: "manager",
                host: {
                  hosts,
                  eligibleHosts: eligibleManagerHosts,
                  value: effectiveManagerHostId,
                  onChange: setManagerHostSelection,
                  isLocalHost,
                },
              }
            : {
                mode: "thread",
                environment: environmentConfig,
                branch: branchConfig,
                worktree: worktreeConfig,
                permission: permissionConfig,
                header: reuseHeader,
                ...(isProjectless
                  ? { projectlessHost: projectlessThreadHostConfig }
                  : {}),
              }
        }
        onModeChange={setMode}
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
    </PageShell>
  );
}
