import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AvailableModel,
  PermissionMode,
  ProviderComposerAction,
  ProviderInfo,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type {
  CreateExecutionInputSources,
  ExecutionInputFieldSource,
  ExistingThreadExecutionInputSources,
  SystemExecutionOptionsModelLoadError,
  SystemProvidersQuery,
} from "@bb/server-contract";
import type { PickerOption } from "@/components/pickers/OptionPicker";
import type { ModelPickerOption } from "@/components/pickers/model-picker-option";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { useRootComposeReuseEnvironment } from "@/lib/root-compose-selection";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { REASONING_LABELS } from "@/lib/reasoning-labels";
import {
  permissionModeRank,
  providerModelCatalogDependsOnWorkspace,
  reconcileReasoningLevel,
} from "@bb/domain";
import { selectPrimaryHost, useHosts } from "./queries/host-queries";
import {
  useSystemProviderStates,
  useSystemConfig,
  useSystemExecutionOptions,
} from "./queries/system-queries";
import {
  usePromptBoxEnvironmentPreference,
  usePromptBoxModelPreference,
  usePromptBoxPermissionModePreference,
  usePromptBoxProviderPreference,
  usePromptBoxReasoningLevelPreference,
  usePromptBoxServiceTierPreference,
  useSetPromptBoxProviderModelReasoningPreference,
} from "./thread-creation-options/persisted-selection-fields";
import {
  buildExecutionInputSources,
  formatModelLabel,
  getInitialThreadPromptSelections,
  resolvePermissionModeSelection,
  syncUntouchedThreadPromptSelections,
  type ScopedExecutionInputSources,
  type ThreadPromptField,
  type ThreadPromptSelections,
  type UseComponentLocalCreationOptions,
  type UseNewThreadCreationOptions,
  type UsePromptModelReasoningOptions,
  updateThreadPromptSelections,
} from "./thread-creation-options/selection-state";

export { formatModelLabel, resolvePermissionModeSelection };

const EMPTY_PROVIDERS: ProviderInfo[] = [];
const EMPTY_COMPOSER_ACTIONS: ProviderComposerAction[] = [];

const DEFAULT_SUPPORTED_PERMISSION_MODES: readonly PermissionMode[] = ["full"];

const PERMISSION_CEILING_REASON =
  "Above the selected machine's permission limit. Change it in Settings → Machines.";

type StringSelectionSetter = (value: string) => void;
type ServiceTierSelectionSetter = (value: ServiceTier | undefined) => void;
type ReasoningLevelSelectionSetter = (value: ReasoningLevel) => void;
type PermissionModeSelectionSetter = (value: PermissionMode) => void;
type ClearSelectionHandler = () => void;

interface ModelReasoningSelection {
  model: string;
  reasoningLevel: ReasoningLevel;
}

export interface ProviderModelReasoningSelection extends ModelReasoningSelection {
  providerId: string;
}

type ProviderModelReasoningSelectionSetter = (
  selection: ProviderModelReasoningSelection,
) => void;

export interface UseThreadCreationOptionsResult<TExecutionInputSources> {
  executionOptionsRouting: SystemProvidersQuery;
  selectedProviderId: string;
  setSelectedProviderId: StringSelectionSetter;
  setProviderModelReasoning: ProviderModelReasoningSelectionSetter;
  providerOptions: PickerOption<string>[];
  hasMultipleProviders: boolean;
  selectedProviderDisplayName: string;
  selectedProviderComposerActions: readonly ProviderComposerAction[];
  selectedModel: string;
  setSelectedModel: StringSelectionSetter;
  serviceTier: ServiceTier | undefined;
  setServiceTier: ServiceTierSelectionSetter;
  reasoningLevel: ReasoningLevel;
  setReasoningLevel: ReasoningLevelSelectionSetter;
  permissionMode: PermissionMode;
  setPermissionMode: PermissionModeSelectionSetter;
  environmentSelectionValue: string;
  setEnvironmentSelectionValue: StringSelectionSetter;
  clearReuseEnvironment: ClearSelectionHandler;
  activeModel: AvailableModel | undefined;
  modelOptions: ModelPickerOption[];
  moreModelOptions: ModelPickerOption[];
  isLoadingModels: boolean;
  modelLoadFailed: boolean;
  modelLoadError: SystemExecutionOptionsModelLoadError | null;
  reasoningOptions: PickerOption<ReasoningLevel>[];
  permissionModeOptions: PickerOption<PermissionMode>[];
  supportsPermissionModeSelection: boolean;
  supportsServiceTier: boolean;
  serviceTierSupportByProvider: Record<string, boolean>;
  executionInputSources: TExecutionInputSources;
}

interface ResolveThreadCreationProviderRoutingArgs {
  environmentId?: string;
  environmentHostId?: string;
  environmentSelectionValue: string;
  providerId: string;
  scope: "component-local" | "new-thread";
}

export function resolveThreadCreationProviderRouting({
  environmentId,
  environmentHostId,
  environmentSelectionValue,
  providerId,
  scope,
}: ResolveThreadCreationProviderRoutingArgs): SystemProvidersQuery {
  if (scope === "component-local") {
    if (environmentId === undefined) {
      return {};
    }
    // A host-scoped catalog is the same for every environment on the machine,
    // so route by host: opening threads in different environments then shares
    // one cached query instead of issuing a probe per environment. Workspace-
    // scoped catalogs (and providers whose scope is unknown) keep the
    // environment so the server can pass the workspace path through.
    if (
      environmentHostId !== undefined &&
      !providerModelCatalogDependsOnWorkspace(providerId)
    ) {
      return { hostId: environmentHostId };
    }
    return { environmentId };
  }
  const parsed = parseEnvironmentValue(environmentSelectionValue);
  if (parsed?.type === "host") {
    return { hostId: parsed.hostId };
  }
  if (parsed?.type === "reuse" && parsed.environmentId !== null) {
    return { environmentId: parsed.environmentId };
  }
  return {};
}

const NO_MODEL_LOAD_ERROR: SystemExecutionOptionsModelLoadError | null = null;

type InitialReadyProviderResolution =
  | { status: "unresolved" }
  | { status: "resolved"; providerId: string | null };

function sanitizeStoredEnvironmentValue(stored: string): string {
  // Legacy guard: earlier iterations briefly persisted `reuse:<envId>` to
  // localStorage. Treat any persisted reuse value as absent so the picker
  // never resurrects a stale reuse selection across sessions.
  if (!stored) return "";
  const parsed = parseEnvironmentValue(stored);
  if (parsed?.type === "reuse") return "";
  return stored;
}

export function useThreadCreationOptions(
  options: UseComponentLocalCreationOptions,
): UseThreadCreationOptionsResult<ExistingThreadExecutionInputSources>;
export function useThreadCreationOptions(
  options?: UseNewThreadCreationOptions,
): UseThreadCreationOptionsResult<CreateExecutionInputSources>;
export function useThreadCreationOptions(
  options: UsePromptModelReasoningOptions,
): UseThreadCreationOptionsResult<ScopedExecutionInputSources>;
export function useThreadCreationOptions(
  options?: UsePromptModelReasoningOptions,
): UseThreadCreationOptionsResult<ScopedExecutionInputSources> {
  const {
    enabled = true,
    environmentId,
    environmentHostId,
    initialEnvironmentSelectionValue,
    initialModel,
    initialProviderId,
    initialPermissionMode,
    initialReasoningLevel,
    initialServiceTier,
    preferReadyProviderWhenUnset = false,
    preferenceProjectId,
    resolveProviderRouting,
    resetKey,
    scope = "new-thread",
  } = options ?? {};
  const { setValue: setStoredProviderId, value: storedProviderId } =
    usePromptBoxProviderPreference();
  const setStoredProviderModelReasoning =
    useSetPromptBoxProviderModelReasoningPreference();
  const { setValue: setStoredServiceTier, value: storedServiceTier } =
    usePromptBoxServiceTierPreference();
  const { setValue: setStoredPermissionMode, value: storedPermissionMode } =
    usePromptBoxPermissionModePreference();
  const {
    setValue: setStoredEnvironmentSelectionValue,
    value: storedEnvironmentSelectionValue,
  } = usePromptBoxEnvironmentPreference(preferenceProjectId);
  // Reuse env values are intentionally NEVER persisted to localStorage —
  // they represent a transient "create one thread in this worktree" intent,
  // not a project default.
  const [rootComposeReuseValue, setRootComposeReuseValue] =
    useRootComposeReuseEnvironment();
  const [threadSelections, setThreadSelections] =
    useState<ThreadPromptSelections>(() =>
      getInitialThreadPromptSelections({
        initialEnvironmentSelectionValue,
        initialModel,
        initialProviderId,
        initialPermissionMode,
        initialReasoningLevel,
        initialServiceTier,
      }),
    );
  const [initialReadyProvider, setInitialReadyProvider] =
    useState<InitialReadyProviderResolution>({ status: "unresolved" });
  const localProviderSelectionsRef = useRef<
    Map<string, ModelReasoningSelection>
  >(new Map());
  const [localProvidersUsingDefaults, setLocalProvidersUsingDefaults] =
    useState<ReadonlySet<string>>(() => new Set());
  const touchedThreadFieldsRef = useRef<Set<ThreadPromptField>>(new Set());
  const threadResetKeyRef = useRef<string | number | null | undefined>(
    resetKey,
  );
  const usesLocalThreadSelections = scope !== "new-thread";
  const usesStoredCreateSelections = scope === "new-thread";
  const nextThreadSelections = useMemo(
    () =>
      getInitialThreadPromptSelections({
        initialEnvironmentSelectionValue,
        initialModel,
        initialProviderId,
        initialPermissionMode,
        initialReasoningLevel,
        initialServiceTier,
      }),
    [
      initialEnvironmentSelectionValue,
      initialModel,
      initialProviderId,
      initialPermissionMode,
      initialReasoningLevel,
      initialServiceTier,
    ],
  );
  const renderedThreadSelections = useMemo(() => {
    if (!usesLocalThreadSelections) {
      // New-thread scope writes user picks to atoms, never to `threadSelections`,
      // so the useState seed cannot reflect late-arriving project defaults.
      // Track `nextThreadSelections` directly — the seed becomes the empty
      // baseline before any initial values resolve, and updates as they do.
      return nextThreadSelections;
    }
    if (threadResetKeyRef.current !== resetKey) {
      return nextThreadSelections;
    }
    return syncUntouchedThreadPromptSelections({
      currentSelections: threadSelections,
      nextSelections: nextThreadSelections,
      touchedFields: touchedThreadFieldsRef.current,
    });
  }, [
    nextThreadSelections,
    resetKey,
    threadSelections,
    usesLocalThreadSelections,
  ]);

  const selectedProviderIdBeforeReadyFallback = usesStoredCreateSelections
    ? storedProviderId || renderedThreadSelections.selectedProviderId
    : renderedThreadSelections.selectedProviderId;
  const rawServiceTier = usesStoredCreateSelections
    ? storedServiceTier || renderedThreadSelections.serviceTier
    : renderedThreadSelections.serviceTier;
  const rawPermissionMode = usesStoredCreateSelections
    ? storedPermissionMode || renderedThreadSelections.permissionMode
    : renderedThreadSelections.permissionMode;
  const rawEnvironmentSelectionValue =
    scope === "new-thread"
      ? (rootComposeReuseValue ??
        sanitizeStoredEnvironmentValue(storedEnvironmentSelectionValue))
      : renderedThreadSelections.environmentSelectionValue;

  // --- Provider selection ---
  const executionOptionsQueryEnabled = enabled;
  const executionOptionsRouting = resolveProviderRouting
    ? resolveProviderRouting(rawEnvironmentSelectionValue)
    : resolveThreadCreationProviderRouting({
        environmentId,
        environmentHostId,
        environmentSelectionValue: rawEnvironmentSelectionValue,
        providerId: selectedProviderIdBeforeReadyFallback,
        scope,
      });
  const canResolveReadyProvider =
    executionOptionsQueryEnabled &&
    scope === "new-thread" &&
    preferReadyProviderWhenUnset &&
    selectedProviderIdBeforeReadyFallback.length === 0;
  const shouldResolveReadyProvider =
    canResolveReadyProvider && initialReadyProvider.status === "unresolved";
  const providerStatesQuery = useSystemProviderStates({
    enabled: shouldResolveReadyProvider,
    ...executionOptionsRouting,
  });
  const queriedReadyProviderId = shouldResolveReadyProvider
    ? providerStatesQuery.data?.providers.find(
        (provider) => provider.status === "ready",
      )?.providerId
    : undefined;
  const readyProviderId =
    initialReadyProvider.status === "resolved"
      ? (initialReadyProvider.providerId ?? undefined)
      : queriedReadyProviderId;
  // This is an initial default, not a host-scoped live selection. Once the
  // first routed probe settles, retain its answer so changing machines does
  // not silently reselect the provider or repeat provider health probes.
  useEffect(() => {
    if (!shouldResolveReadyProvider || providerStatesQuery.isPending) {
      return;
    }
    setInitialReadyProvider((current) =>
      current.status === "resolved"
        ? current
        : {
            status: "resolved",
            providerId: queriedReadyProviderId ?? null,
          },
    );
  }, [
    providerStatesQuery.isPending,
    queriedReadyProviderId,
    shouldResolveReadyProvider,
  ]);
  const rawSelectedProviderId =
    selectedProviderIdBeforeReadyFallback || readyProviderId || "";
  // Omission delegates the no-selection fallback to the server, whose product
  // default comes from the same provider catalog that orders the picker.
  const executionOptionsProviderId = executionOptionsQueryEnabled
    ? rawSelectedProviderId || undefined
    : undefined;
  const executionOptionsQuery = useSystemExecutionOptions({
    enabled: executionOptionsQueryEnabled,
    ...executionOptionsRouting,
    providerId: executionOptionsProviderId,
  });
  const hostsQuery = useHosts();
  const systemConfig = useSystemConfig();
  const providers = executionOptionsQuery.data?.providers ?? EMPTY_PROVIDERS;
  const isLoadingModels =
    executionOptionsQueryEnabled &&
    (executionOptionsQuery.isLoading ||
      (executionOptionsQuery.isPlaceholderData &&
        (executionOptionsQuery.data?.models.length ?? 0) === 0));
  const modelLoadError =
    executionOptionsQuery.data?.modelLoadError ?? NO_MODEL_LOAD_ERROR;
  const modelLoadFailed =
    executionOptionsQuery.isError || modelLoadError !== null;
  // Preloaded placeholder rows and the server's probe-failure fallback are both
  // provisional catalogs. Only a successful probe proves a stored model is gone,
  // so recovery is gated on the catalog being verified. Placeholder data is not
  // a failure, so it deliberately stays out of `modelLoadFailed`.
  const modelCatalogIsUnverified =
    modelLoadError !== null || executionOptionsQuery.isPlaceholderData;
  const hasMultipleProviders = providers.length >= 2;

  // Resolve the effective provider: use selectedProviderId if it matches a known
  // provider, otherwise fall back to the first provider in the list.
  const effectiveProviderId = useMemo(() => {
    if (
      rawSelectedProviderId &&
      providers.some((provider) => provider.id === rawSelectedProviderId)
    ) {
      return rawSelectedProviderId;
    }
    return providers[0]?.id ?? "";
  }, [providers, rawSelectedProviderId]);

  const { setValue: setStoredSelectedModel, value: storedSelectedModel } =
    usePromptBoxModelPreference(effectiveProviderId);
  const { setValue: setStoredReasoningLevel, value: storedReasoningLevel } =
    usePromptBoxReasoningLevelPreference(effectiveProviderId);
  const effectiveProviderMatchesInitialProvider =
    effectiveProviderId.length > 0 &&
    effectiveProviderId === renderedThreadSelections.selectedProviderId;
  const rawSelectedModel = usesStoredCreateSelections
    ? storedSelectedModel ||
      (effectiveProviderMatchesInitialProvider
        ? renderedThreadSelections.selectedModel
        : "")
    : renderedThreadSelections.selectedModel;
  const preferredReasoningLevel: ReasoningLevel | undefined =
    usesStoredCreateSelections
      ? storedReasoningLevel ||
        (effectiveProviderMatchesInitialProvider
          ? initialReasoningLevel
          : undefined)
      : localProvidersUsingDefaults.has(effectiveProviderId)
        ? undefined
        : renderedThreadSelections.reasoningLevel;

  const selectedProviderInfo = useMemo(
    () => providers.find((p) => p.id === effectiveProviderId),
    [effectiveProviderId, providers],
  );

  const providerOptions = useMemo(
    (): PickerOption<string>[] =>
      providers.map((p) => ({
        value: p.id,
        label: p.displayName,
        icon: getProviderIconInfo(p.id, p.logoUrl ?? null)?.icon,
      })),
    [providers],
  );

  const activeProviderCapabilities = selectedProviderInfo?.capabilities;
  const selectedProviderComposerActions =
    selectedProviderInfo?.composerActions ?? EMPTY_COMPOSER_ACTIONS;

  const supportsServiceTier =
    activeProviderCapabilities?.supportsServiceTier ?? false;
  const permissionModes: readonly PermissionMode[] =
    activeProviderCapabilities?.permissionModes ??
    DEFAULT_SUPPORTED_PERMISSION_MODES;
  const supportsPermissionModeSelection = permissionModes.length > 1;
  // The machine's permission limit (Settings → Machines). Modes above it stay
  // listed but unselectable, so the picker never offers a mode the server
  // would resolve back down. Before the routed answer lands (cold load, or the
  // Claude preload placeholder) the cached machine list stands in, so the
  // picker never briefly offers a mode this machine has already ruled out.
  const routedHostCeiling = useMemo(() => {
    const hosts = hostsQuery.data;
    if (!hosts) return null;
    const routedHostId =
      executionOptionsRouting.hostId ??
      selectPrimaryHost(hosts, systemConfig.data?.primaryHostId ?? null)?.id ??
      null;
    if (routedHostId === null) return null;
    return (
      hosts.find((host) => host.id === routedHostId)?.maxPermissionMode ?? null
    );
  }, [
    executionOptionsRouting.hostId,
    hostsQuery.data,
    systemConfig.data?.primaryHostId,
  ]);
  const routedCeiling = executionOptionsQuery.isPlaceholderData
    ? undefined
    : executionOptionsQuery.data?.permissionCeiling;
  const permissionCeiling: PermissionMode =
    routedCeiling ?? routedHostCeiling ?? "full";
  const allowedPermissionModes = useMemo(
    () =>
      permissionModes.filter(
        (mode) =>
          permissionModeRank(mode) <= permissionModeRank(permissionCeiling),
      ),
    [permissionCeiling, permissionModes],
  );
  const permissionModeOptions = useMemo(
    () =>
      PERMISSION_MODE_OPTIONS.filter((option) =>
        permissionModes.includes(option.value),
      ).map((option) =>
        permissionModeRank(option.value) > permissionModeRank(permissionCeiling)
          ? {
              ...option,
              disabled: true,
              disabledReason: PERMISSION_CEILING_REASON,
            }
          : option,
      ),
    [permissionCeiling, permissionModes],
  );

  const serviceTierSupportByProvider = useMemo(() => {
    const supportByProvider: Record<string, boolean> = {};
    for (const provider of providers) {
      supportByProvider[provider.id] =
        provider.capabilities.supportsServiceTier;
    }
    return supportByProvider;
  }, [providers]);

  // Pi model ids gained a provider prefix, so a thread can hold
  // `deepseek/deepseek-v4-flash` where the catalog now lists
  // `openrouter/deepseek/deepseek-v4-flash`. Re-point the stored selection at
  // that row, otherwise the recovery path below falls back to the catalog
  // default and the next message persists it, which permanently moves the
  // thread to another model and another vendor. Only a unique match is safe:
  // two providers can serve one id, and the stored string does not say which
  // one was meant.
  const selectedModelSelection = useMemo(() => {
    if (!rawSelectedModel) return rawSelectedModel;
    const catalog = [
      ...(executionOptionsQuery.data?.models ?? []),
      ...(executionOptionsQuery.data?.selectedOnlyModels ?? []),
    ];
    if (catalog.some((model) => model.model === rawSelectedModel)) {
      return rawSelectedModel;
    }
    const prefixed = catalog.filter((model) =>
      model.model.endsWith(`/${rawSelectedModel}`),
    );
    return prefixed.length === 1 ? prefixed[0].model : rawSelectedModel;
  }, [
    executionOptionsQuery.data?.models,
    executionOptionsQuery.data?.selectedOnlyModels,
    rawSelectedModel,
  ]);

  // Merge the user's currently-stored selection from the selected-only pool
  // when it isn't in the active list. This preserves a previously-selected
  // model after it has been retired so the picker can render its label and
  // the user isn't silently moved to a different model.
  const availableModels = useMemo(() => {
    const activeModels = executionOptionsQuery.data?.models ?? [];
    if (!selectedModelSelection) return activeModels;
    if (activeModels.some((model) => model.model === selectedModelSelection)) {
      return activeModels;
    }
    const selectedOnly = executionOptionsQuery.data?.selectedOnlyModels ?? [];
    const match = selectedOnly.find(
      (model) => model.model === selectedModelSelection,
    );
    return match ? [match, ...activeModels] : activeModels;
  }, [
    executionOptionsQuery.data?.models,
    executionOptionsQuery.data?.selectedOnlyModels,
    selectedModelSelection,
  ]);
  const selectedModel = useMemo(() => {
    // An unverified catalog (discovery error, or preloaded placeholder rows) is
    // temporary: keep an existing explicit selection instead of treating a
    // partial/provisional catalog as proof that it disappeared. Once discovery
    // succeeds, absence is definitive and the catalog default becomes a recovery
    // selection.
    if (modelCatalogIsUnverified && selectedModelSelection) {
      return selectedModelSelection;
    }
    if (availableModels.length === 0) {
      return selectedModelSelection;
    }
    if (
      availableModels.some((model) => model.model === selectedModelSelection)
    ) {
      return selectedModelSelection;
    }
    return (
      availableModels.find((model) => model.isDefault)?.model ??
      availableModels[0].model
    );
  }, [availableModels, modelCatalogIsUnverified, selectedModelSelection]);
  // True when the stored string is not what will run: either the model is gone
  // and the catalog default replaces it, or a prefix-free Pi id resolved to its
  // canonical row. Both cases send the model explicitly, so the stored value
  // catches up with what the turn actually used.
  const isUnavailableModelRecovery =
    !modelCatalogIsUnverified &&
    rawSelectedModel.length > 0 &&
    selectedModel !== rawSelectedModel;

  const modelOptions = useMemo(
    (): ModelPickerOption[] =>
      availableModels.map((model) => ({
        value: model.model,
        label: formatModelLabel(model.displayName || model.model),
        ...(model.routeProviderId
          ? { routeProviderId: model.routeProviderId }
          : {}),
      })),
    [availableModels],
  );

  // Models behind the picker's collapsed "More models" section. A promoted
  // current selection already lives in `availableModels`, so it is excluded
  // here rather than listed twice.
  const moreModelOptions = useMemo(
    (): ModelPickerOption[] =>
      (executionOptionsQuery.data?.selectedOnlyModels ?? [])
        .filter(
          (model) =>
            !availableModels.some((active) => active.model === model.model),
        )
        .map((model) => ({
          value: model.model,
          label: formatModelLabel(model.displayName || model.model),
          ...(model.routeProviderId
            ? { routeProviderId: model.routeProviderId }
            : {}),
        })),
    [executionOptionsQuery.data?.selectedOnlyModels, availableModels],
  );

  const activeModel = useMemo(
    () =>
      availableModels.find((model) => model.model === selectedModel) ??
      availableModels.find((model) => model.isDefault) ??
      availableModels[0],
    [availableModels, selectedModel],
  );

  const reasoningOptions = useMemo((): PickerOption<ReasoningLevel>[] => {
    if (!activeModel) {
      return [];
    }

    const options: PickerOption<ReasoningLevel>[] = [];
    const seen = new Set<ReasoningLevel>();
    const efforts = activeModel.supportedReasoningEfforts;

    for (const effort of efforts) {
      if (seen.has(effort.reasoningEffort)) continue;
      seen.add(effort.reasoningEffort);
      options.push({
        value: effort.reasoningEffort,
        label: REASONING_LABELS[effort.reasoningEffort],
      });
    }

    if (options.length === 0) {
      return [];
    }

    return options;
  }, [activeModel]);
  const serviceTier = useMemo(
    () => (supportsServiceTier ? rawServiceTier : undefined),
    [rawServiceTier, supportsServiceTier],
  );
  const reasoningLevel = useMemo(() => {
    const preferredLevel = preferredReasoningLevel ?? "medium";
    if (reasoningOptions.length === 0) {
      return preferredLevel;
    }
    // Carry the user's previous reasoning level across model switches when
    // the new model supports it; otherwise pick the closest supported level
    // (tie-break upward). See reconcileReasoningLevel in @bb/domain for the policy.
    return reconcileReasoningLevel(
      preferredLevel,
      reasoningOptions.map((option) => option.value),
    );
  }, [preferredReasoningLevel, reasoningOptions]);

  const permissionMode = resolvePermissionModeSelection({
    rawPermissionMode,
    // A stored preference above the machine's limit shows as the mode that
    // will actually run, not the one that would be resolved away.
    permissionModes:
      allowedPermissionModes.length > 0
        ? allowedPermissionModes
        : permissionModes,
  });
  const environmentSelectionValue = rawEnvironmentSelectionValue;
  // A resetKey change clears touched fields in a layout effect, which runs
  // after this render's provenance is computed. Treat the pending reset as
  // "nothing touched" here — the same render-time rule
  // `renderedThreadSelections` applies — so the reset render never reports
  // stale explicit provenance.
  const touchedFieldsPendingReset =
    usesLocalThreadSelections && threadResetKeyRef.current !== resetKey;
  const effectiveInitialProviderSource: ExecutionInputFieldSource | undefined =
    canResolveReadyProvider &&
    readyProviderId !== undefined &&
    effectiveProviderId === readyProviderId
      ? "client-preference"
      : undefined;
  const executionInputSources = useMemo(
    () =>
      buildExecutionInputSources({
        effectiveValues: {
          selectedProviderId: effectiveProviderId,
          selectedModel,
          serviceTier,
          reasoningLevel,
          permissionMode,
        },
        forceExplicitModel: isUnavailableModelRecovery,
        initialProviderSource: effectiveInitialProviderSource,
        scope,
        storedValues: {
          selectedProviderId: storedProviderId,
          selectedModel: storedSelectedModel,
          serviceTier: storedServiceTier,
          reasoningLevel: storedReasoningLevel,
          permissionMode: storedPermissionMode,
        },
        touchedFields: touchedFieldsPendingReset
          ? new Set<ThreadPromptField>()
          : touchedThreadFieldsRef.current,
      }),
    [
      effectiveProviderId,
      effectiveInitialProviderSource,
      isUnavailableModelRecovery,
      permissionMode,
      reasoningLevel,
      scope,
      selectedModel,
      serviceTier,
      storedPermissionMode,
      storedProviderId,
      storedReasoningLevel,
      storedSelectedModel,
      storedServiceTier,
      touchedFieldsPendingReset,
    ],
  );

  useLayoutEffect(() => {
    if (!usesLocalThreadSelections) return;
    if (threadResetKeyRef.current !== resetKey) {
      threadResetKeyRef.current = resetKey;
      touchedThreadFieldsRef.current = new Set();
      localProviderSelectionsRef.current = new Map();
      setLocalProvidersUsingDefaults(new Set());
      setThreadSelections(nextThreadSelections);
      return;
    }
    setThreadSelections((currentSelections) =>
      syncUntouchedThreadPromptSelections({
        currentSelections,
        nextSelections: nextThreadSelections,
        touchedFields: touchedThreadFieldsRef.current,
      }),
    );
  }, [nextThreadSelections, resetKey, usesLocalThreadSelections]);

  const setSelectedProviderId = useCallback(
    (value: string) => {
      touchedThreadFieldsRef.current.add("selectedProviderId");
      if (usesStoredCreateSelections) {
        if (effectiveProviderId.length > 0) {
          // Materialize legacy/current defaults under the provider being left
          // before the provider setter retires the old unscoped storage keys.
          setStoredSelectedModel(selectedModel);
          setStoredReasoningLevel(reasoningLevel);
        }
        setStoredProviderId(value);
        return;
      }
      touchedThreadFieldsRef.current.add("selectedModel");
      touchedThreadFieldsRef.current.add("reasoningLevel");
      if (effectiveProviderId.length > 0) {
        localProviderSelectionsRef.current.set(effectiveProviderId, {
          model: selectedModel,
          reasoningLevel,
        });
      }
      const rememberedSelection = localProviderSelectionsRef.current.get(value);
      setLocalProvidersUsingDefaults((current) => {
        const next = new Set(current);
        if (rememberedSelection) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
      setThreadSelections((currentSelections) => ({
        ...currentSelections,
        selectedProviderId: value,
        selectedModel: rememberedSelection?.model ?? "",
        reasoningLevel:
          rememberedSelection?.reasoningLevel ??
          currentSelections.reasoningLevel,
      }));
    },
    [
      effectiveProviderId,
      reasoningLevel,
      selectedModel,
      setStoredReasoningLevel,
      setStoredSelectedModel,
      setStoredProviderId,
      usesStoredCreateSelections,
    ],
  );

  const setProviderModelReasoning = useCallback(
    ({
      providerId,
      model,
      reasoningLevel: nextReasoningLevel,
    }: ProviderModelReasoningSelection) => {
      touchedThreadFieldsRef.current.add("selectedProviderId");
      touchedThreadFieldsRef.current.add("selectedModel");
      touchedThreadFieldsRef.current.add("reasoningLevel");
      if (usesStoredCreateSelections) {
        if (
          effectiveProviderId.length > 0 &&
          effectiveProviderId !== providerId
        ) {
          setStoredSelectedModel(selectedModel);
          setStoredReasoningLevel(reasoningLevel);
        }
        setStoredProviderModelReasoning({
          providerId,
          model,
          reasoningLevel: nextReasoningLevel,
        });
        setStoredProviderId(providerId);
        return;
      }
      if (
        effectiveProviderId.length > 0 &&
        effectiveProviderId !== providerId
      ) {
        localProviderSelectionsRef.current.set(effectiveProviderId, {
          model: selectedModel,
          reasoningLevel,
        });
      }
      localProviderSelectionsRef.current.set(providerId, {
        model,
        reasoningLevel: nextReasoningLevel,
      });
      setLocalProvidersUsingDefaults((current) => {
        if (!current.has(providerId)) return current;
        const next = new Set(current);
        next.delete(providerId);
        return next;
      });
      setThreadSelections((currentSelections) => ({
        ...currentSelections,
        selectedProviderId: providerId,
        selectedModel: model,
        reasoningLevel: nextReasoningLevel,
      }));
    },
    [
      effectiveProviderId,
      reasoningLevel,
      selectedModel,
      setStoredProviderId,
      setStoredProviderModelReasoning,
      setStoredReasoningLevel,
      setStoredSelectedModel,
      usesStoredCreateSelections,
    ],
  );

  const setSelectedModel = useCallback(
    (value: string) => {
      touchedThreadFieldsRef.current.add("selectedModel");
      if (usesStoredCreateSelections) {
        setStoredSelectedModel(value);
        return;
      }
      setLocalProvidersUsingDefaults((current) => {
        if (!current.has(effectiveProviderId)) return current;
        const next = new Set(current);
        next.delete(effectiveProviderId);
        return next;
      });
      localProviderSelectionsRef.current.set(effectiveProviderId, {
        model: value,
        reasoningLevel,
      });
      setThreadSelections((currentSelections) => ({
        ...currentSelections,
        selectedModel: value,
        reasoningLevel,
      }));
    },
    [
      effectiveProviderId,
      reasoningLevel,
      setStoredSelectedModel,
      usesStoredCreateSelections,
    ],
  );
  const setServiceTier = useCallback(
    (value: ServiceTier | undefined) => {
      touchedThreadFieldsRef.current.add("serviceTier");
      if (usesStoredCreateSelections) {
        setStoredServiceTier(value ?? "");
        return;
      }
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "serviceTier",
          value,
        }),
      );
    },
    [setStoredServiceTier, usesStoredCreateSelections],
  );
  const setReasoningLevel = useCallback(
    (value: ReasoningLevel) => {
      touchedThreadFieldsRef.current.add("reasoningLevel");
      if (usesStoredCreateSelections) {
        setStoredReasoningLevel(value);
        return;
      }
      setLocalProvidersUsingDefaults((current) => {
        if (!current.has(effectiveProviderId)) return current;
        const next = new Set(current);
        next.delete(effectiveProviderId);
        return next;
      });
      localProviderSelectionsRef.current.set(effectiveProviderId, {
        model: selectedModel,
        reasoningLevel: value,
      });
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "reasoningLevel",
          value,
        }),
      );
    },
    [
      effectiveProviderId,
      selectedModel,
      setStoredReasoningLevel,
      usesStoredCreateSelections,
    ],
  );
  const setPermissionMode = useCallback(
    (value: PermissionMode) => {
      touchedThreadFieldsRef.current.add("permissionMode");
      if (usesStoredCreateSelections) {
        setStoredPermissionMode(value);
        return;
      }
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "permissionMode",
          value,
        }),
      );
    },
    [setStoredPermissionMode, usesStoredCreateSelections],
  );
  const setEnvironmentSelectionValue = useCallback(
    (value: string) => {
      if (scope === "new-thread") {
        const parsed = parseEnvironmentValue(value);
        if (parsed?.type === "reuse") {
          // Reuse intent is transient. Hold it in root-compose state so the
          // picker reflects the user's choice without overwriting their
          // persisted host-mode default.
          setRootComposeReuseValue(value);
          return;
        }
        setRootComposeReuseValue(null);
        setStoredEnvironmentSelectionValue(value);
        return;
      }
      touchedThreadFieldsRef.current.add("environmentSelectionValue");
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "environmentSelectionValue",
          value,
        }),
      );
    },
    [scope, setRootComposeReuseValue, setStoredEnvironmentSelectionValue],
  );
  // Dismissing the reuse banner reverts to whatever the user's persisted
  // host-mode default is — no localStorage write needed, just clear the
  // transient override.
  const clearReuseEnvironment = useCallback(() => {
    if (scope !== "new-thread") return;
    setRootComposeReuseValue(null);
  }, [scope, setRootComposeReuseValue]);

  return {
    executionOptionsRouting,
    selectedProviderId: effectiveProviderId,
    setSelectedProviderId,
    setProviderModelReasoning,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName:
      selectedProviderInfo?.displayName ?? effectiveProviderId,
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
    executionInputSources,
  };
}
