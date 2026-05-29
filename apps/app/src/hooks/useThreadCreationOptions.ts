import { useAtom } from "jotai";
import {
  type ComponentType,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  PermissionMode,
  ProviderInfo,
  ReasoningLevel,
  ServiceTier,
} from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import {
  createLocalStorageEnumStorage,
  createProjectScopedStorageAtomFamily,
  rawStringLocalStorage,
} from "@/lib/browser-storage";
import { useRootComposeReuseEnvironment } from "@/lib/root-compose-selection";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { reconcileReasoningLevel } from "@bb/domain";
import { useSystemExecutionOptions } from "./queries/system-queries";

const MODEL_STORAGE_KEY = "bb.promptbox.model";
const SERVICE_TIER_STORAGE_KEY = "bb.promptbox.service-tier";
const REASONING_STORAGE_KEY = "bb.promptbox.reasoning";
const PERMISSION_MODE_STORAGE_KEY = "bb.promptbox.permission-mode";
const ENVIRONMENT_STORAGE_KEY = "bb.promptbox.environment";
const PROVIDER_STORAGE_KEY = "bb.promptbox.provider";
type StoredServiceTier = "" | ServiceTier;
const EMPTY_PROVIDERS: ProviderInfo[] = [];

const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
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

type ThreadCreationOptionsScope =
  | "new-thread"
  | "new-manager"
  | "component-local";

interface UsePromptModelReasoningOptions {
  enabled?: boolean;
  environmentId?: string;
  scope?: ThreadCreationOptionsScope;
  projectId?: string | null;
  resetKey?: string | number | null;
  initialProviderId?: string;
  initialModel?: string;
  initialServiceTier?: ServiceTier;
  initialReasoningLevel?: ReasoningLevel;
  initialPermissionMode?: PermissionMode;
  initialEnvironmentSelectionValue?: string;
}

interface ThreadPromptSelections {
  selectedProviderId: string;
  selectedModel: string;
  serviceTier: ServiceTier | undefined;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  environmentSelectionValue: string;
}

type ThreadPromptField = keyof ThreadPromptSelections;

interface SyncThreadPromptSelectionsArgs {
  currentSelections: ThreadPromptSelections;
  nextSelections: ThreadPromptSelections;
  touchedFields: ReadonlySet<ThreadPromptField>;
}

interface UpdateThreadPromptSelectionsArgs {
  currentSelections: ThreadPromptSelections;
  field: ThreadPromptField;
  value: ThreadPromptSelections[ThreadPromptField];
}

interface ResolvePermissionModeSelectionArgs {
  rawPermissionMode: PermissionMode;
  supportedPermissionModes: readonly PermissionMode[];
}

const NO_MODEL_LOAD_ERROR: SystemExecutionOptionsModelLoadError | null = null;

function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    value === "readonly" || value === "workspace-write" || value === "full"
  );
}

function isServiceTier(value: unknown): value is ServiceTier {
  return value === "fast" || value === "default";
}

function isStoredServiceTier(value: string): value is StoredServiceTier {
  return value === "" || isServiceTier(value);
}

const storedServiceTierStorage =
  createLocalStorageEnumStorage<StoredServiceTier>(isStoredServiceTier);
const reasoningLevelStorage = createLocalStorageEnumStorage<ReasoningLevel>(
  (value): value is ReasoningLevel => isReasoningLevel(value),
);
const permissionModeStorage = createLocalStorageEnumStorage<PermissionMode>(
  (value): value is PermissionMode => isPermissionMode(value),
);
const providerIdAtomFamily = createProjectScopedStorageAtomFamily(
  PROVIDER_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);
const modelAtomFamily = createProjectScopedStorageAtomFamily(
  MODEL_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);
const serviceTierAtomFamily =
  createProjectScopedStorageAtomFamily<StoredServiceTier>(
    SERVICE_TIER_STORAGE_KEY,
    "",
    storedServiceTierStorage,
  );
const reasoningLevelAtomFamily = createProjectScopedStorageAtomFamily(
  REASONING_STORAGE_KEY,
  "medium",
  reasoningLevelStorage,
);
const permissionModeAtomFamily = createProjectScopedStorageAtomFamily(
  PERMISSION_MODE_STORAGE_KEY,
  "full",
  permissionModeStorage,
);
const environmentSelectionAtomFamily = createProjectScopedStorageAtomFamily(
  ENVIRONMENT_STORAGE_KEY,
  "",
  rawStringLocalStorage,
);

function getInitialThreadPromptSelections(
  options?: UsePromptModelReasoningOptions,
): ThreadPromptSelections {
  return {
    selectedProviderId: options?.initialProviderId ?? "",
    selectedModel: options?.initialModel ?? "",
    serviceTier: options?.initialServiceTier,
    reasoningLevel: options?.initialReasoningLevel ?? "medium",
    permissionMode: options?.initialPermissionMode ?? "full",
    environmentSelectionValue: options?.initialEnvironmentSelectionValue ?? "",
  };
}

function syncUntouchedThreadPromptSelections({
  currentSelections,
  nextSelections,
  touchedFields,
}: SyncThreadPromptSelectionsArgs): ThreadPromptSelections {
  let changed = false;
  const updatedSelections = { ...currentSelections };

  if (
    !touchedFields.has("selectedProviderId") &&
    currentSelections.selectedProviderId !== nextSelections.selectedProviderId
  ) {
    updatedSelections.selectedProviderId = nextSelections.selectedProviderId;
    changed = true;
  }
  if (
    !touchedFields.has("selectedModel") &&
    currentSelections.selectedModel !== nextSelections.selectedModel
  ) {
    updatedSelections.selectedModel = nextSelections.selectedModel;
    changed = true;
  }
  if (
    !touchedFields.has("serviceTier") &&
    currentSelections.serviceTier !== nextSelections.serviceTier
  ) {
    updatedSelections.serviceTier = nextSelections.serviceTier;
    changed = true;
  }
  if (
    !touchedFields.has("reasoningLevel") &&
    currentSelections.reasoningLevel !== nextSelections.reasoningLevel
  ) {
    updatedSelections.reasoningLevel = nextSelections.reasoningLevel;
    changed = true;
  }
  if (
    !touchedFields.has("permissionMode") &&
    currentSelections.permissionMode !== nextSelections.permissionMode
  ) {
    updatedSelections.permissionMode = nextSelections.permissionMode;
    changed = true;
  }
  if (
    !touchedFields.has("environmentSelectionValue") &&
    currentSelections.environmentSelectionValue !==
      nextSelections.environmentSelectionValue
  ) {
    updatedSelections.environmentSelectionValue =
      nextSelections.environmentSelectionValue;
    changed = true;
  }

  return changed ? updatedSelections : currentSelections;
}

function updateThreadPromptSelections({
  currentSelections,
  field,
  value,
}: UpdateThreadPromptSelectionsArgs): ThreadPromptSelections {
  if (currentSelections[field] === value) {
    return currentSelections;
  }

  return {
    ...currentSelections,
    [field]: value,
  };
}

export function resolvePermissionModeSelection({
  rawPermissionMode,
  supportedPermissionModes,
}: ResolvePermissionModeSelectionArgs): PermissionMode {
  if (supportedPermissionModes.includes(rawPermissionMode)) {
    return rawPermissionMode;
  }
  if (supportedPermissionModes.includes("full")) {
    return "full";
  }
  return supportedPermissionModes[0] ?? "full";
}

export function formatModelLabel(value: string): string {
  // Case-normalises a raw model id into a displayable label. The brand prefix
  // strip ("Claude " / "GPT-") is a presentation rule applied by the picker
  // itself (see `stripModelBrandPrefix`) so stories and prod render identically
  // without anyone having to remember to format.
  return value
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt") return "GPT";
      if (/^\d+(\.\d+)*$/.test(part)) return part;
      if (/^[a-z]+$/i.test(part)) {
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      return part;
    })
    .join("-");
}

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
  options?: UsePromptModelReasoningOptions,
) {
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
  const [storedProviderId, setStoredProviderId] = useAtom(
    providerIdAtomFamily(projectId),
  );
  const [storedSelectedModel, setStoredSelectedModel] = useAtom(
    modelAtomFamily(projectId),
  );
  const [storedServiceTier, setStoredServiceTier] = useAtom(
    serviceTierAtomFamily(projectId),
  );
  const [storedReasoningLevel, setStoredReasoningLevel] = useAtom(
    reasoningLevelAtomFamily(projectId),
  );
  const [storedPermissionMode, setStoredPermissionMode] = useAtom(
    permissionModeAtomFamily(projectId),
  );
  const [storedEnvironmentSelectionValue, setStoredEnvironmentSelectionValue] =
    useAtom(environmentSelectionAtomFamily(projectId));
  // Reuse env values are intentionally NEVER persisted to localStorage —
  // they represent a transient "create one thread in this worktree" intent,
  // not a project default. Held in shared root-compose state so all mode
  // entry points clear it when switching to manager mode.
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
      return threadSelections;
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

  const rawSelectedProviderId =
    scope === "new-thread"
      ? storedProviderId
      : renderedThreadSelections.selectedProviderId;
  const rawSelectedModel =
    scope === "new-thread"
      ? storedSelectedModel
      : renderedThreadSelections.selectedModel;
  const rawServiceTier =
    scope === "new-thread"
      ? storedServiceTier || undefined
      : renderedThreadSelections.serviceTier;
  const rawReasoningLevel =
    scope === "new-thread"
      ? storedReasoningLevel
      : renderedThreadSelections.reasoningLevel;
  const rawPermissionMode =
    scope === "new-thread"
      ? storedPermissionMode
      : renderedThreadSelections.permissionMode;
  const rawEnvironmentSelectionValue =
    scope === "new-thread"
      ? (rootComposeReuseValue ??
        sanitizeStoredEnvironmentValue(storedEnvironmentSelectionValue))
      : renderedThreadSelections.environmentSelectionValue;

  // --- Provider selection ---
  const executionOptionsEnvironmentId =
    scope === "component-local" ? environmentId : undefined;
  const executionOptionsQuery = useSystemExecutionOptions({
    enabled:
      enabled &&
      (scope !== "component-local" ||
        executionOptionsEnvironmentId !== undefined),
    environmentId: executionOptionsEnvironmentId,
    providerId: rawSelectedProviderId || undefined,
  });
  const providers = executionOptionsQuery.data?.providers ?? EMPTY_PROVIDERS;
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
      if (scope === "new-thread") {
        setStoredProviderId(value);
        return;
      }
      touchedThreadFieldsRef.current.add("selectedProviderId");
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
    [scope, setStoredProviderId],
  );

  const setSelectedModel = useCallback(
    (value: string) => {
      if (scope === "new-thread") {
        setStoredSelectedModel(value);
        return;
      }
      touchedThreadFieldsRef.current.add("selectedModel");
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "selectedModel",
          value,
        }),
      );
    },
    [scope, setStoredSelectedModel],
  );
  const setServiceTier = useCallback(
    (value: ServiceTier | undefined) => {
      if (scope === "new-thread") {
        setStoredServiceTier(value ?? "");
        return;
      }
      touchedThreadFieldsRef.current.add("serviceTier");
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "serviceTier",
          value,
        }),
      );
    },
    [scope, setStoredServiceTier],
  );
  const setReasoningLevel = useCallback(
    (value: ReasoningLevel) => {
      if (scope === "new-thread") {
        setStoredReasoningLevel(value);
        return;
      }
      touchedThreadFieldsRef.current.add("reasoningLevel");
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "reasoningLevel",
          value,
        }),
      );
    },
    [scope, setStoredReasoningLevel],
  );
  const setPermissionMode = useCallback(
    (value: PermissionMode) => {
      if (scope === "new-thread") {
        setStoredPermissionMode(value);
        return;
      }
      touchedThreadFieldsRef.current.add("permissionMode");
      setThreadSelections((currentSelections) =>
        updateThreadPromptSelections({
          currentSelections,
          field: "permissionMode",
          value,
        }),
      );
    },
    [scope, setStoredPermissionMode],
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
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  };
}
