import {
  type ComponentType,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AvailableModel,
  PermissionMode,
  ProviderInfo,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type {
  CreateExecutionInputSources,
  ExistingThreadExecutionInputSources,
  SystemExecutionOptionsModelLoadError,
} from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import { useRootComposeReuseEnvironment } from "@/lib/root-compose-selection";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { reconcileReasoningLevel } from "@bb/domain";
import { useSystemExecutionOptions } from "./queries/system-queries";
import {
  usePersistedEnvironmentSelection,
  usePersistedModelSelection,
  usePersistedPermissionModeSelection,
  usePersistedProviderSelection,
  usePersistedReasoningLevelSelection,
  usePersistedServiceTierSelection,
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

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  ultracode: "Ultracode",
  max: "Max",
};

const PERMISSION_MODE_OPTIONS: PickerOption<PermissionMode>[] = [
  {
    value: "full",
    label: "Full Access",
    tone: "warning",
  },
  {
    value: "workspace-write",
    label: "Workspace Write",
  },
  {
    value: "readonly",
    label: "Readonly",
  },
];

const DEFAULT_SUPPORTED_PERMISSION_MODES: readonly PermissionMode[] = ["full"];

interface PickerOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  tone?: "default" | "warning";
  icon?: ComponentType<{ className?: string }>;
}

type StringSelectionSetter = (value: string) => void;
type ServiceTierSelectionSetter = (value: ServiceTier | undefined) => void;
type ReasoningLevelSelectionSetter = (value: ReasoningLevel) => void;
type PermissionModeSelectionSetter = (value: PermissionMode) => void;
type ClearSelectionHandler = () => void;

interface UseThreadCreationOptionsResult<TExecutionInputSources> {
  selectedProviderId: string;
  setSelectedProviderId: StringSelectionSetter;
  providerOptions: PickerOption<string>[];
  hasMultipleProviders: boolean;
  selectedProviderDisplayName: string;
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
  modelOptions: PickerOption<string>[];
  isLoadingModels: boolean;
  modelLoadError: SystemExecutionOptionsModelLoadError | null;
  reasoningOptions: PickerOption<ReasoningLevel>[];
  permissionModeOptions: PickerOption<PermissionMode>[];
  supportsPermissionModeSelection: boolean;
  supportsServiceTier: boolean;
  serviceTierSupportByProvider: Record<string, boolean>;
  executionInputSources: TExecutionInputSources;
}

const NO_MODEL_LOAD_ERROR: SystemExecutionOptionsModelLoadError | null = null;

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
  options?: UsePromptModelReasoningOptions,
): UseThreadCreationOptionsResult<ScopedExecutionInputSources> {
  const {
    enabled = true,
    environmentId,
    initialEnvironmentSelectionValue,
    initialModel,
    initialProviderId,
    initialPermissionMode,
    initialReasoningLevel,
    initialServiceTier,
    projectId,
    resetKey,
    scope = "new-thread",
  } = options ?? {};
  const { setValue: setStoredProviderId, value: storedProviderId } =
    usePersistedProviderSelection(projectId);
  const { setValue: setStoredSelectedModel, value: storedSelectedModel } =
    usePersistedModelSelection(projectId);
  const { setValue: setStoredServiceTier, value: storedServiceTier } =
    usePersistedServiceTierSelection(projectId);
  const { setValue: setStoredReasoningLevel, value: storedReasoningLevel } =
    usePersistedReasoningLevelSelection(projectId);
  const { setValue: setStoredPermissionMode, value: storedPermissionMode } =
    usePersistedPermissionModeSelection(projectId);
  const {
    setValue: setStoredEnvironmentSelectionValue,
    value: storedEnvironmentSelectionValue,
  } = usePersistedEnvironmentSelection(projectId);
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

  const rawSelectedProviderId = usesStoredCreateSelections
    ? storedProviderId || renderedThreadSelections.selectedProviderId
    : renderedThreadSelections.selectedProviderId;
  const rawSelectedModel = usesStoredCreateSelections
    ? storedSelectedModel || renderedThreadSelections.selectedModel
    : renderedThreadSelections.selectedModel;
  const rawServiceTier = usesStoredCreateSelections
    ? storedServiceTier || renderedThreadSelections.serviceTier
    : renderedThreadSelections.serviceTier;
  const rawReasoningLevel = usesStoredCreateSelections
    ? storedReasoningLevel || renderedThreadSelections.reasoningLevel
    : renderedThreadSelections.reasoningLevel;
  const rawPermissionMode = usesStoredCreateSelections
    ? storedPermissionMode || renderedThreadSelections.permissionMode
    : renderedThreadSelections.permissionMode;
  const rawEnvironmentSelectionValue =
    scope === "new-thread"
      ? (rootComposeReuseValue ??
        sanitizeStoredEnvironmentValue(storedEnvironmentSelectionValue))
      : renderedThreadSelections.environmentSelectionValue;

  // --- Provider selection ---
  const executionOptionsQueryEnabled =
    enabled && (scope !== "component-local" || environmentId !== undefined);
  const executionOptionsEnvironmentId =
    scope === "component-local" && executionOptionsQueryEnabled
      ? environmentId
      : undefined;
  const executionOptionsProviderId = executionOptionsQueryEnabled
    ? rawSelectedProviderId || undefined
    : undefined;
  const executionOptionsQuery = useSystemExecutionOptions({
    enabled: executionOptionsQueryEnabled,
    environmentId: executionOptionsEnvironmentId,
    providerId: executionOptionsProviderId,
  });
  const providers = executionOptionsQuery.data?.providers ?? EMPTY_PROVIDERS;
  const isLoadingModels =
    executionOptionsQueryEnabled && executionOptionsQuery.isLoading;
  const modelLoadError =
    executionOptionsQuery.data?.modelLoadError ?? NO_MODEL_LOAD_ERROR;
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

  const selectedProviderInfo = useMemo(
    () => providers.find((p) => p.id === effectiveProviderId),
    [effectiveProviderId, providers],
  );

  const providerOptions = useMemo(
    (): PickerOption<string>[] =>
      providers.map((p) => ({
        value: p.id,
        label: p.displayName,
        icon: getProviderIconInfo(p.id)?.icon,
      })),
    [providers],
  );

  const activeProviderCapabilities = selectedProviderInfo?.capabilities;

  const supportsServiceTier =
    activeProviderCapabilities?.supportsServiceTier ?? false;
  const supportedPermissionModes: readonly PermissionMode[] =
    activeProviderCapabilities?.supportedPermissionModes ??
    DEFAULT_SUPPORTED_PERMISSION_MODES;
  const supportsPermissionModeSelection = supportedPermissionModes.length > 1;
  const permissionModeOptions = useMemo(
    () =>
      PERMISSION_MODE_OPTIONS.filter((option) =>
        supportedPermissionModes.includes(option.value),
      ),
    [supportedPermissionModes],
  );

  const serviceTierSupportByProvider = useMemo(() => {
    const supportByProvider: Record<string, boolean> = {};
    for (const provider of providers) {
      supportByProvider[provider.id] =
        provider.capabilities.supportsServiceTier;
    }
    return supportByProvider;
  }, [providers]);

  // Merge the user's currently-stored selection from the selected-only pool
  // when it isn't in the active list. This preserves a previously-selected
  // model after it has been retired so the picker can render its label and
  // the user isn't silently moved to a different model.
  const availableModels = useMemo(() => {
    const activeModels = executionOptionsQuery.data?.models ?? [];
    if (!rawSelectedModel) return activeModels;
    if (activeModels.some((model) => model.model === rawSelectedModel)) {
      return activeModels;
    }
    const selectedOnly = executionOptionsQuery.data?.selectedOnlyModels ?? [];
    const match = selectedOnly.find(
      (model) => model.model === rawSelectedModel,
    );
    return match ? [match, ...activeModels] : activeModels;
  }, [
    executionOptionsQuery.data?.models,
    executionOptionsQuery.data?.selectedOnlyModels,
    rawSelectedModel,
  ]);
  const selectedModel = useMemo(() => {
    if (availableModels.length === 0) {
      return rawSelectedModel;
    }
    if (availableModels.some((model) => model.model === rawSelectedModel)) {
      return rawSelectedModel;
    }
    return (
      availableModels.find((model) => model.isDefault)?.model ??
      availableModels[0].model
    );
  }, [availableModels, rawSelectedModel]);

  const modelOptions = useMemo(
    (): PickerOption<string>[] =>
      availableModels.map((model) => ({
        value: model.model,
        label: formatModelLabel(model.displayName || model.model),
      })),
    [availableModels],
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
    if (reasoningOptions.length === 0) {
      return rawReasoningLevel;
    }
    // Carry the user's previous reasoning level across model switches when
    // the new model supports it; otherwise pick the closest supported level
    // (tie-break upward). See reconcileReasoningLevel in @bb/domain for the policy.
    return reconcileReasoningLevel(
      rawReasoningLevel,
      reasoningOptions.map((option) => option.value),
    );
  }, [rawReasoningLevel, reasoningOptions]);

  const permissionMode = resolvePermissionModeSelection({
    rawPermissionMode,
    supportedPermissionModes,
  });
  const environmentSelectionValue = rawEnvironmentSelectionValue;
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
        scope,
        storedValues: {
          selectedProviderId: storedProviderId,
          selectedModel: storedSelectedModel,
          serviceTier: storedServiceTier,
          reasoningLevel: storedReasoningLevel,
          permissionMode: storedPermissionMode,
        },
        touchedFields: touchedThreadFieldsRef.current,
      }),
    [
      effectiveProviderId,
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
    ],
  );

  useLayoutEffect(() => {
    if (!usesLocalThreadSelections) return;
    if (threadResetKeyRef.current !== resetKey) {
      threadResetKeyRef.current = resetKey;
      touchedThreadFieldsRef.current = new Set();
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
        setStoredProviderId(value);
        return;
      }
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "selectedProviderId",
          value,
        }),
      );
      // Don't eagerly reset the model here — the effect that watches
      // derived values will fall back to the default if the current
      // selection isn't in the new provider's model list.
    },
    [setStoredProviderId, usesStoredCreateSelections],
  );

  const setSelectedModel = useCallback(
    (value: string) => {
      touchedThreadFieldsRef.current.add("selectedModel");
      if (usesStoredCreateSelections) {
        setStoredSelectedModel(value);
        return;
      }
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "selectedModel",
          value,
        }),
      );
    },
    [setStoredSelectedModel, usesStoredCreateSelections],
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
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "reasoningLevel",
          value,
        }),
      );
    },
    [setStoredReasoningLevel, usesStoredCreateSelections],
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
    setRootComposeReuseValue(null);
  }, [setRootComposeReuseValue]);

  return {
    selectedProviderId: effectiveProviderId,
    setSelectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName:
      selectedProviderInfo?.displayName ?? effectiveProviderId,
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
    isLoadingModels,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
    executionInputSources,
  };
}
