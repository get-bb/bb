import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type Host,
  type PermissionMode,
  type ProjectSource,
  type ProviderInfo,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  ThreadResponse,
} from "@bb/server-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildForkThreadRequest,
  buildThreadHandoffPromptDraft,
  type PromptDraftAttachment,
} from "@bb/client-core";
import {
  composerValueFromDraftState,
  composerValueToPromptInput,
  createComposerValue,
  type ComposerValue,
} from "@/composer/model";
import { useComposerDraft, type ComposerDraftScope } from "@/data/composer";
import {
  buildComposeExecutionInputSources,
  buildCreateThreadRequest,
  hasPromptContent,
  buildPermissionModeOptions,
  buildProviderOptions,
  buildReasoningOptions,
  buildReuseEnvironmentOptions,
  formatModelLoadErrorText,
  PROJECT_DEFAULT_ENVIRONMENT,
  readForkSeedFromComposeParams,
  readHandoffSeedFromComposeParams,
  resolveComposeProjectId,
  resolveEffectiveEnvironmentSelection,
  resolveEffectiveProviderId,
  resolveExecutionOptionsRouting,
  resolveModelSelection,
  resolvePermissionModeSelection,
  resolveReasoningLevel,
  resolveSelectedHostId,
  resolveWorktreeDisabledReason,
  selectionToStoredEnvironment,
  storedEnvironmentToSelection,
  THREAD_CREATION_BLOCKER_MESSAGES,
  useComposePreferences,
  type BranchSelection,
  type ComposeExecutionField,
  type ComposeForkSeed,
  type ComposeSeedParams,
  type ModelPickerOption,
  type PermissionModePickerOption,
  type ProviderPickerOption,
  type ReasoningPickerOption,
  type ReuseEnvironmentOption,
  type ThreadEnvironmentSelection,
} from "@/data/compose";
import { selectPrimaryHost, useHosts } from "@/data/hosts";
import {
  useProjectBranches,
  useProjectDefaultExecutionOptions,
} from "@/data/projects";
import {
  stripProjectThreads,
  useSidebarBootstrap,
  type SidebarProject,
} from "@/data/sidebar";
import { useSystemConfig, useSystemExecutionOptions } from "@/data/system";
import { useCreateThread } from "@/data/threads";

/**
 * State and derived options for the new-thread composer (the home dock).
 * Mirrors the web's
 * NewThreadComposer + useThreadCreationOptions (new-thread scope) on top of
 * the mobile data layer: stored preferences win over the project defaults,
 * every selection is resolved against the live catalog, and the environment
 * selection is kept typed. Pickers are fed plain option lists.
 */

export interface ComposeParams extends ComposeSeedParams {
  sectionId?: string;
  initialPrompt?: string;
}

type ComposeHostMode = "local" | "worktree" | "personal" | null;

interface ComposeBranchState {
  mode: "local" | "worktree";
  branches: string[];
  remoteBranches: string[];
  selected: BranchSelection | null;
  defaultBranch: string | null;
  searchQuery: string;
  isLoading: boolean;
  setSearchQuery: (query: string) => void;
  select: (name: string) => void;
  clear: () => void;
  createFrom: (name: string) => void;
}

export interface ComposeController {
  // Prompt (shared composer draft, persisted under the web's new-thread key)
  value: ComposerValue;
  setValue: (value: ComposerValue) => void;
  attachments: PromptDraftAttachment[];
  setAttachments: (attachments: PromptDraftAttachment[]) => void;
  sectionId: string | null;
  /** Set when the screen was opened by "Fork from here" (see compose-seed-params). */
  forkSeed: ComposeForkSeed | null;

  // Project
  projectId: string;
  project: SidebarProject | null;
  projects: SidebarProject[];
  personalProject: SidebarProject | null;
  isPersonalProject: boolean;
  projectsLoading: boolean;
  selectProject: (projectId: string) => void;

  // Provider / model / reasoning / permissions / tier
  providerOptions: ProviderPickerOption[];
  providerId: string;
  selectProvider: (providerId: string) => void;
  modelOptions: ModelPickerOption[];
  moreModelOptions: ModelPickerOption[];
  model: string;
  selectModel: (model: string) => void;
  reasoningOptions: ReasoningPickerOption[];
  reasoningLevel: ReasoningLevel;
  selectReasoningLevel: (level: ReasoningLevel) => void;
  permissionModeOptions: PermissionModePickerOption[];
  permissionMode: PermissionMode;
  selectPermissionMode: (mode: PermissionMode) => void;
  supportsServiceTier: boolean;
  fastMode: boolean;
  setFastMode: (enabled: boolean) => void;
  isLoadingModels: boolean;
  modelLoadErrorMessage: string | null;

  // Environment / machine / branch / path
  environment: ThreadEnvironmentSelection;
  setEnvironment: (selection: ThreadEnvironmentSelection) => void;
  hosts: Host[];
  primaryHostId: string | null;
  selectedHost: Host | null;
  hostHasSource: boolean;
  hostIdsWithSource: ReadonlySet<string> | null;
  selectHost: (hostId: string) => void;
  hostMode: ComposeHostMode;
  reuseOptions: ReuseEnvironmentOption[];
  reuseOptionsLoading: boolean;
  worktreeDisabledReason: string | null;
  branch: ComposeBranchState | null;
  workspacePath: string | null;
  defaultWorkspacePath: string | null;
  setWorkspacePath: (path: string | null) => void;

  // Submit
  navigateAfterCreate: boolean;
  canSubmit: boolean;
  submitBlockerMessage: string | null;
  isSubmitting: boolean;
  submit: () => Promise<ThreadResponse | null>;
}

const NEW_THREAD_DRAFT_SCOPE: ComposerDraftScope = { kind: "new-thread" };
const EMPTY_PROJECTS: ProjectWithThreadsResponse[] = [];
const EMPTY_HOSTS: Host[] = [];
const EMPTY_PROVIDERS: ProviderInfo[] = [];
const EMPTY_SOURCES: ProjectSource[] = [];
const EMPTY_THREADS: ThreadListEntry[] = [];

interface ScopedState<T> {
  scope: string;
  value: T;
}

/** A piece of state that resets whenever its scope key changes (no effect). */
function useScopedState<T>(scope: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<ScopedState<T> | null>(null);
  const value = state !== null && state.scope === scope ? state.value : initial;
  const set = useCallback(
    (next: T) => setState({ scope, value: next }),
    [scope],
  );
  return [value, set];
}

function environmentScope(
  projectId: string,
  environment: ThreadEnvironmentSelection,
): string {
  if (environment.type !== "host") return `${projectId}\0${environment.type}`;
  return `${projectId}\0host:${environment.hostId}:${environment.workspace.type}`;
}

function withHostWorkspaceReset(
  environment: ThreadEnvironmentSelection,
  hostId: string,
): ThreadEnvironmentSelection {
  if (environment.type !== "host") {
    return {
      type: "host",
      hostId,
      workspace: { type: "unmanaged", path: null, branch: null },
    };
  }
  switch (environment.workspace.type) {
    case "personal":
      return { type: "host", hostId, workspace: { type: "personal" } };
    case "managed-worktree":
      return {
        type: "host",
        hostId,
        workspace: { type: "managed-worktree", baseBranch: null },
      };
    case "unmanaged":
      return {
        type: "host",
        hostId,
        workspace: { type: "unmanaged", path: null, branch: null },
      };
  }
}

export function useComposeController(params: ComposeParams): ComposeController {
  const [prefs, prefStore] = useComposePreferences();

  // --- Seeds (fork / handoff) --------------------------------------------
  const forkSeed = useMemo(
    () => readForkSeedFromComposeParams(params),
    // oxlint-disable-next-line react/exhaustive-deps -- route params are stable per screen instance
    [
      params.forkSourceThreadId,
      params.forkSourceSeqEnd,
      params.forkSourceThreadTitle,
      params.projectId,
      params.reuseEnvironmentId,
    ],
  );
  const handoffSeed = useMemo(
    () => readHandoffSeedFromComposeParams(params),
    // oxlint-disable-next-line react/exhaustive-deps -- route params are stable per screen instance
    [
      params.handoffSourceThreadId,
      params.handoffSourceThreadTitle,
      params.projectId,
      params.reuseEnvironmentId,
    ],
  );
  // A handoff seeds the prompt with "Continue from @thread:<id>" (the
  // mention rides along on submit until the shared composer owns mentions).
  const handoffDraft = useMemo(
    () => (handoffSeed ? buildThreadHandoffPromptDraft(handoffSeed) : null),
    [handoffSeed],
  );

  // --- Prompt -------------------------------------------------------------
  // The shared composer's draft (restored from the web-compatible
  // new-thread key). A routed `initialPrompt` or a handoff seed replaces
  // whatever was stored, once per distinct seed: the home dock keeps one
  // controller alive across many "new thread" requests, so the seed is keyed
  // on its params rather than on the component instance.
  const draft = useComposerDraft(NEW_THREAD_DRAFT_SCOPE);
  const seedKey = params.initialPrompt
    ? `prompt:${params.initialPrompt}`
    : handoffDraft
      ? `handoff:${params.handoffSourceThreadId ?? ""}`
      : null;
  const appliedSeedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (seedKey === null || appliedSeedKeyRef.current === seedKey) return;
    appliedSeedKeyRef.current = seedKey;
    if (params.initialPrompt) {
      draft.replace(createComposerValue(params.initialPrompt), []);
    } else if (handoffDraft) {
      const seeded = composerValueFromDraftState(handoffDraft);
      draft.replace(seeded.value, seeded.attachments);
    }
  }, [
    draft,
    handoffDraft,
    params.handoffSourceThreadId,
    params.initialPrompt,
    seedKey,
  ]);
  const promptInput = useMemo(
    () => composerValueToPromptInput(draft.value, draft.attachments),
    [draft.attachments, draft.value],
  );
  const sectionId = params.sectionId?.trim() ? params.sectionId.trim() : null;

  // --- Project ------------------------------------------------------------
  const bootstrap = useSidebarBootstrap();
  const projectsWithThreads = bootstrap.data?.projects ?? EMPTY_PROJECTS;
  const projects = useMemo(
    () => projectsWithThreads.map(stripProjectThreads),
    [projectsWithThreads],
  );
  const personalProjectWithThreads = bootstrap.data?.personalProject ?? null;
  const personalProject = useMemo(
    () =>
      personalProjectWithThreads
        ? stripProjectThreads(personalProjectWithThreads)
        : null,
    [personalProjectWithThreads],
  );
  const knownProjectIds = useMemo(
    () =>
      bootstrap.data
        ? new Set(bootstrap.data.projects.map((project) => project.id))
        : undefined,
    [bootstrap.data],
  );
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  // A routed project (a project's "+", a deep link, a fork / handoff seed)
  // wins over an earlier pick, also when it arrives on a live controller.
  const routedProjectId = params.projectId;
  useEffect(() => {
    if (routedProjectId) setPickedProjectId(routedProjectId);
  }, [routedProjectId]);
  const projectId = resolveComposeProjectId({
    requestedProjectId: pickedProjectId ?? params.projectId,
    storedProjectId: prefs.lastProjectId,
    knownProjectIds,
  });
  const isPersonalProject = projectId === PERSONAL_PROJECT_ID;
  const projectWithThreads = useMemo((): ProjectWithThreadsResponse | null => {
    if (isPersonalProject) return personalProjectWithThreads;
    return (
      projectsWithThreads.find((candidate) => candidate.id === projectId) ??
      null
    );
  }, [
    isPersonalProject,
    personalProjectWithThreads,
    projectId,
    projectsWithThreads,
  ]);
  const project = useMemo(
    () => (projectWithThreads ? stripProjectThreads(projectWithThreads) : null),
    [projectWithThreads],
  );
  const projectSources = project?.sources ?? EMPTY_SOURCES;
  const projectThreads = projectWithThreads?.threads ?? EMPTY_THREADS;
  const selectProject = useCallback(
    (nextProjectId: string) => {
      setPickedProjectId(nextProjectId);
      prefStore.setLastProjectId(nextProjectId);
    },
    [prefStore],
  );

  // Project defaults: inlined by the bootstrap; fetched when it has none.
  const projectDefaultsQuery = useProjectDefaultExecutionOptions(projectId, {
    enabled: project !== null && project.defaultExecutionOptions === null,
  });
  const projectDefaults =
    project?.defaultExecutionOptions ?? projectDefaultsQuery.data ?? null;

  // --- Hosts --------------------------------------------------------------
  const hostsQuery = useHosts();
  const hosts = hostsQuery.data ?? EMPTY_HOSTS;
  const systemConfig = useSystemConfig();
  const primaryHostId =
    selectPrimaryHost(hosts, systemConfig.data?.primaryHostId ?? null)?.id ??
    null;
  const knownHostIds = useMemo(
    () => new Set(hosts.map((host) => host.id)),
    [hosts],
  );
  const hostNameById = useMemo(
    () =>
      hosts.length <= 1
        ? null
        : new Map(hosts.map((host) => [host.id, host.name])),
    [hosts],
  );
  const hostIdsWithSource = useMemo(
    () =>
      isPersonalProject
        ? null
        : new Set(projectSources.map((source) => source.hostId)),
    [isPersonalProject, projectSources],
  );

  // --- Environment --------------------------------------------------------
  const reuseOptions = useMemo(
    () => buildReuseEnvironmentOptions(projectThreads, hostNameById),
    [hostNameById, projectThreads],
  );
  const reuseOptionsLoading = bootstrap.isLoading;
  // Revision-dependent read: the store bumps `revision` on every write.
  const storedEnvironment = useMemo(
    () => prefStore.getProjectEnvironment(projectId),
    // oxlint-disable-next-line react/exhaustive-deps -- revision is the cache key
    [prefStore, projectId, prefs.revision],
  );
  const seededEnvironment = useMemo((): ThreadEnvironmentSelection => {
    if (params.reuseEnvironmentId) {
      return { type: "reuse", environmentId: params.reuseEnvironmentId };
    }
    return storedEnvironment
      ? storedEnvironmentToSelection(storedEnvironment)
      : PROJECT_DEFAULT_ENVIRONMENT;
  }, [params.reuseEnvironmentId, storedEnvironment]);
  const [pickedEnvironment, setPickedEnvironment] =
    useScopedState<ThreadEnvironmentSelection | null>(projectId, null);
  const rawEnvironment = pickedEnvironment ?? seededEnvironment;
  const resolvedEnvironment = useMemo(
    () =>
      resolveEffectiveEnvironmentSelection({
        selection: rawEnvironment,
        projectId,
        knownHostIds,
        projectSources,
        reuseOptions,
        reuseOptionsLoading,
      }),
    [
      knownHostIds,
      projectId,
      projectSources,
      rawEnvironment,
      reuseOptions,
      reuseOptionsLoading,
    ],
  );
  const setEnvironment = useCallback(
    (selection: ThreadEnvironmentSelection) => {
      setPickedEnvironment(selection);
      prefStore.setProjectEnvironment(
        projectId,
        selectionToStoredEnvironment(selection),
      );
    },
    [prefStore, projectId, setPickedEnvironment],
  );

  const selectedHostId = resolveSelectedHostId(
    resolvedEnvironment,
    primaryHostId,
  );
  const selectedHost = hosts.find((host) => host.id === selectedHostId) ?? null;
  const hostHasSource =
    isPersonalProject ||
    (selectedHostId !== null &&
      findLocalPathProjectSourceForHost(projectSources, selectedHostId) !==
        undefined);
  const selectHost = useCallback(
    (hostId: string) => {
      setEnvironment(withHostWorkspaceReset(resolvedEnvironment, hostId));
    },
    [resolvedEnvironment, setEnvironment],
  );

  // --- Branches (host modes) ---------------------------------------------
  const branchHostId =
    resolvedEnvironment.type === "host" &&
    resolvedEnvironment.workspace.type !== "personal"
      ? resolvedEnvironment.hostId
      : null;
  const envScope = environmentScope(projectId, resolvedEnvironment);
  const [branchSearchQuery, setBranchSearchQuery] = useScopedState(
    envScope,
    "",
  );
  const pickedBranch = useMemo((): BranchSelection | null => {
    if (resolvedEnvironment.type !== "host") return null;
    if (resolvedEnvironment.workspace.type === "unmanaged") {
      return resolvedEnvironment.workspace.branch;
    }
    if (
      resolvedEnvironment.workspace.type === "managed-worktree" &&
      resolvedEnvironment.workspace.baseBranch !== null
    ) {
      return { name: resolvedEnvironment.workspace.baseBranch, isNew: false };
    }
    return null;
  }, [resolvedEnvironment]);
  const branchesQuery = useProjectBranches(projectId, branchHostId, {
    enabled: branchHostId !== null && !isPersonalProject,
    query: branchSearchQuery,
    selectedBranch: pickedBranch?.name ?? "",
  });
  const worktreeDisabledReason = resolveWorktreeDisabledReason(
    branchesQuery.data,
  );
  // A checkout that cannot host worktrees demotes the selection to the
  // checkout itself (web parity); the stored preference is left alone.
  const environment = useMemo((): ThreadEnvironmentSelection => {
    if (
      worktreeDisabledReason !== null &&
      resolvedEnvironment.type === "host" &&
      resolvedEnvironment.workspace.type === "managed-worktree"
    ) {
      return {
        type: "host",
        hostId: resolvedEnvironment.hostId,
        workspace: { type: "unmanaged", path: null, branch: null },
      };
    }
    return resolvedEnvironment;
  }, [resolvedEnvironment, worktreeDisabledReason]);
  const hostMode: ComposeHostMode =
    environment.type !== "host"
      ? null
      : environment.workspace.type === "managed-worktree"
        ? "worktree"
        : environment.workspace.type === "unmanaged"
          ? "local"
          : "personal";

  const setBranchSelection = useCallback(
    (selection: BranchSelection | null) => {
      if (environment.type !== "host") return;
      if (environment.workspace.type === "unmanaged") {
        setEnvironment({
          ...environment,
          workspace: { ...environment.workspace, branch: selection },
        });
      } else if (environment.workspace.type === "managed-worktree") {
        setEnvironment({
          ...environment,
          workspace: {
            type: "managed-worktree",
            baseBranch: selection?.name ?? null,
          },
        });
      }
    },
    [environment, setEnvironment],
  );
  const branch = useMemo((): ComposeBranchState | null => {
    if (hostMode !== "local" && hostMode !== "worktree") return null;
    const data = branchesQuery.data;
    const selectedRef = data?.selectedBranch;
    const localBranches = data?.branches ?? [];
    const remoteBranches = data?.remoteBranches ?? [];
    return {
      mode: hostMode,
      branches:
        selectedRef?.kind === "local" &&
        !localBranches.includes(selectedRef.name)
          ? [selectedRef.name, ...localBranches]
          : [...localBranches],
      remoteBranches:
        selectedRef?.kind === "remote" &&
        !remoteBranches.includes(selectedRef.name)
          ? [selectedRef.name, ...remoteBranches]
          : [...remoteBranches],
      selected: pickedBranch,
      defaultBranch:
        hostMode === "local"
          ? data?.checkout.kind === "branch"
            ? data.checkout.branchName
            : null
          : (data?.defaultWorktreeBaseBranch ?? data?.defaultBranch ?? null),
      searchQuery: branchSearchQuery,
      isLoading: branchesQuery.isLoading,
      setSearchQuery: setBranchSearchQuery,
      select: (name) => setBranchSelection({ name, isNew: false }),
      clear: () => setBranchSelection(null),
      createFrom: (name) => setBranchSelection({ name, isNew: true }),
    };
  }, [
    branchSearchQuery,
    branchesQuery.data,
    branchesQuery.isLoading,
    hostMode,
    pickedBranch,
    setBranchSearchQuery,
    setBranchSelection,
  ]);

  const workspacePath =
    environment.type === "host" && environment.workspace.type === "unmanaged"
      ? environment.workspace.path
      : null;
  const defaultWorkspacePath =
    selectedHostId !== null
      ? (findLocalPathProjectSourceForHost(projectSources, selectedHostId)
          ?.path ?? null)
      : null;
  const setWorkspacePath = useCallback(
    (path: string | null) => {
      if (
        environment.type !== "host" ||
        environment.workspace.type !== "unmanaged"
      ) {
        return;
      }
      setEnvironment({
        ...environment,
        workspace: { ...environment.workspace, path },
      });
    },
    [environment, setEnvironment],
  );

  // --- Provider / model ---------------------------------------------------
  const touchedRef = useRef<Set<ComposeExecutionField>>(new Set());
  const routing = resolveExecutionOptionsRouting(environment);
  const rawProviderId = prefs.providerId || projectDefaults?.providerId || "";
  const executionOptions = useSystemExecutionOptions({
    ...routing,
    ...(rawProviderId ? { providerId: rawProviderId } : {}),
  });
  const providers = executionOptions.data?.providers ?? EMPTY_PROVIDERS;
  const providerOptions = useMemo(
    () => buildProviderOptions(providers),
    [providers],
  );
  const providerId = resolveEffectiveProviderId(providers, rawProviderId);
  const providerInfo = providers.find((provider) => provider.id === providerId);
  const storedProviderSelection = useMemo(
    () => prefStore.getProviderSelection(providerId),
    // oxlint-disable-next-line react/exhaustive-deps -- revision is the cache key
    [prefStore, providerId, prefs.revision],
  );
  const providerMatchesDefaults =
    providerId.length > 0 && providerId === projectDefaults?.providerId;
  const rawModel =
    storedProviderSelection.model ||
    (providerMatchesDefaults ? (projectDefaults?.model ?? "") : "");
  const isLoadingModels =
    executionOptions.isLoading ||
    (executionOptions.isPlaceholderData &&
      (executionOptions.data?.models.length ?? 0) === 0);
  const modelLoadError = executionOptions.data?.modelLoadError ?? null;
  const catalogVerified =
    executionOptions.isSuccess &&
    !executionOptions.isPlaceholderData &&
    modelLoadError === null;
  const modelSelection = useMemo(
    () =>
      resolveModelSelection({
        executionOptions: executionOptions.data,
        selectedModel: rawModel,
        catalogVerified,
      }),
    [catalogVerified, executionOptions.data, rawModel],
  );
  const reasoningOptions = useMemo(
    () => buildReasoningOptions(modelSelection.activeModel),
    [modelSelection.activeModel],
  );
  const preferredReasoning: ReasoningLevel | undefined =
    storedProviderSelection.reasoningLevel ||
    (providerMatchesDefaults ? projectDefaults?.reasoningLevel : undefined);
  const reasoningLevel = resolveReasoningLevel(
    preferredReasoning,
    reasoningOptions,
  );

  const supportsServiceTier =
    providerInfo?.capabilities.supportsServiceTier ?? false;
  const serviceTier: ServiceTier | undefined =
    prefs.serviceTier || projectDefaults?.serviceTier || undefined;
  const fastMode = supportsServiceTier && serviceTier === "fast";

  const permissionModes = providerInfo?.capabilities.permissionModes;
  const routedCeiling = executionOptions.isPlaceholderData
    ? undefined
    : executionOptions.data?.permissionCeiling;
  const ceiling: PermissionMode =
    routedCeiling ?? selectedHost?.maxPermissionMode ?? "full";
  const permissionModeOptions = useMemo(
    () => buildPermissionModeOptions({ permissionModes, ceiling }),
    [ceiling, permissionModes],
  );
  const permissionMode = resolvePermissionModeSelection(
    prefs.permissionMode || projectDefaults?.permissionMode,
    { permissionModes, ceiling },
  );

  const selectProvider = useCallback(
    (nextProviderId: string) => {
      touchedRef.current.add("providerId");
      prefStore.setProviderId(nextProviderId);
    },
    [prefStore],
  );
  const selectModel = useCallback(
    (nextModel: string) => {
      touchedRef.current.add("model");
      prefStore.setProviderSelection(providerId, { model: nextModel });
    },
    [prefStore, providerId],
  );
  const selectReasoningLevel = useCallback(
    (level: ReasoningLevel) => {
      touchedRef.current.add("reasoningLevel");
      prefStore.setProviderSelection(providerId, { reasoningLevel: level });
    },
    [prefStore, providerId],
  );
  const selectPermissionMode = useCallback(
    (mode: PermissionMode) => {
      touchedRef.current.add("permissionMode");
      prefStore.setPermissionMode(mode);
    },
    [prefStore],
  );
  const setFastMode = useCallback(
    (enabled: boolean) => {
      touchedRef.current.add("serviceTier");
      prefStore.setServiceTier(enabled ? "fast" : "default");
    },
    [prefStore],
  );

  // --- Submit -------------------------------------------------------------
  const createThread = useCreateThread();
  const navigateAfterCreate = prefs.navigateAfterCreate;
  const submitBlockerMessage = !hasPromptContent(promptInput)
    ? THREAD_CREATION_BLOCKER_MESSAGES["empty-prompt"]
    : environment.type === "reuse" && environment.environmentId === null
      ? THREAD_CREATION_BLOCKER_MESSAGES["reuse-environment-required"]
      : isLoadingModels
        ? "Loading models…"
        : null;
  const canSubmit = submitBlockerMessage === null && !createThread.isPending;

  const submit = useCallback(async (): Promise<ThreadResponse | null> => {
    const touched = touchedRef.current;
    const effectiveServiceTier = supportsServiceTier ? serviceTier : undefined;
    const executionInputSources = buildComposeExecutionInputSources(
      {
        providerId: {
          value: providerId,
          stored: prefs.providerId,
          touched: touched.has("providerId"),
        },
        model: {
          value: modelSelection.selectedModel,
          stored: storedProviderSelection.model,
          touched: touched.has("model"),
        },
        serviceTier: {
          value: effectiveServiceTier,
          stored: prefs.serviceTier,
          touched: touched.has("serviceTier"),
        },
        reasoningLevel: {
          value: reasoningLevel,
          stored: storedProviderSelection.reasoningLevel,
          touched: touched.has("reasoningLevel"),
        },
        permissionMode: {
          value: permissionMode,
          stored: prefs.permissionMode,
          touched: touched.has("permissionMode"),
        },
      },
      { forceExplicitModel: modelSelection.isRecovery },
    );
    const result = buildCreateThreadRequest({
      projectId,
      input: promptInput,
      providerId: providerId || null,
      model: modelSelection.selectedModel || null,
      reasoningLevel: reasoningOptions.length > 0 ? reasoningLevel : null,
      permissionMode,
      serviceTier: effectiveServiceTier ?? null,
      environment,
      sectionId,
      executionInputSources:
        Object.keys(executionInputSources).length > 0
          ? executionInputSources
          : undefined,
      defaultBranch: branchesQuery.data?.defaultBranch,
      defaultWorktreeBaseBranch: branchesQuery.data?.defaultWorktreeBaseBranch,
    });
    if (result.request === null) {
      throw new Error(THREAD_CREATION_BLOCKER_MESSAGES[result.blocker]);
    }
    // A fork reuses the source environment and clones the provider history up
    // to the forked message; the picked execution options still apply.
    const request =
      forkSeed === null
        ? result.request
        : buildForkThreadRequest({
            ...forkSeed,
            input: result.request.input,
            model: modelSelection.selectedModel,
            permissionMode,
            providerId,
            providerSupportsFork:
              providerInfo?.capabilities.supportsFork ?? false,
            reasoningLevel,
            serviceTier: effectiveServiceTier,
          });
    if (request === null) {
      throw new Error(THREAD_CREATION_BLOCKER_MESSAGES["fork-unsupported"]);
    }
    const thread = await createThread.mutateAsync(request);
    draft.clear();
    return thread;
  }, [
    branchesQuery.data?.defaultBranch,
    branchesQuery.data?.defaultWorktreeBaseBranch,
    createThread,
    environment,
    draft,
    forkSeed,
    modelSelection.isRecovery,
    modelSelection.selectedModel,
    permissionMode,
    prefs.permissionMode,
    prefs.providerId,
    prefs.serviceTier,
    projectId,
    providerId,
    providerInfo?.capabilities.supportsFork,
    reasoningLevel,
    reasoningOptions.length,
    sectionId,
    serviceTier,
    storedProviderSelection.model,
    storedProviderSelection.reasoningLevel,
    promptInput,
    supportsServiceTier,
  ]);

  return {
    value: draft.value,
    setValue: draft.setValue,
    attachments: draft.attachments,
    setAttachments: draft.setAttachments,
    sectionId,
    forkSeed,
    projectId,
    project,
    projects,
    personalProject,
    isPersonalProject,
    projectsLoading: bootstrap.isLoading,
    selectProject,
    providerOptions,
    providerId,
    selectProvider,
    modelOptions: modelSelection.options,
    moreModelOptions: modelSelection.moreOptions,
    model: modelSelection.selectedModel,
    selectModel,
    reasoningOptions,
    reasoningLevel,
    selectReasoningLevel,
    permissionModeOptions,
    permissionMode,
    selectPermissionMode,
    supportsServiceTier,
    fastMode,
    setFastMode,
    isLoadingModels,
    modelLoadErrorMessage:
      modelLoadError === null
        ? null
        : formatModelLoadErrorText(
            modelLoadError,
            providers.find(
              (provider) => provider.id === modelLoadError.providerId,
            )?.displayName ?? modelLoadError.providerId,
          ),
    environment,
    setEnvironment,
    hosts,
    primaryHostId,
    selectedHost,
    hostHasSource,
    hostIdsWithSource,
    selectHost,
    hostMode,
    reuseOptions,
    reuseOptionsLoading,
    worktreeDisabledReason,
    branch,
    workspacePath,
    defaultWorkspacePath,
    setWorkspacePath,
    navigateAfterCreate,
    canSubmit,
    submitBlockerMessage,
    isSubmitting: createThread.isPending,
    submit,
  };
}
