import {
  resolveDefaultExecutionOptionsState,
  type DefaultExecutionOptionsState,
  type FollowUpExecutionSelection,
} from "@bb/client-core";
import type {
  PermissionMode,
  ReasoningLevel,
  ResolvedThreadExecutionOptions,
  ServiceTier,
  ThreadTimelineModelFallback,
} from "@bb/domain";
import type { ThreadResponse } from "@bb/server-contract";
import { useCallback, useMemo, useState } from "react";
import type { ExecutionControlsProps } from "@/composer";
import {
  buildPermissionModeOptions,
  buildReasoningOptions,
  formatModelLoadErrorText,
  PROJECT_DEFAULT_ENVIRONMENT,
  resolveExecutionOptionsRouting,
  resolveModelSelection,
  resolvePermissionModeSelection,
  resolveReasoningLevel,
} from "@/data/compose";
import { useSystemExecutionOptions } from "@/data/system";
import { buildFollowUpExecutionInputSources } from "./follow-up-submission";

interface UseThreadExecutionOptionsArgs {
  thread: ThreadResponse | undefined;
  /** `useThreadDefaultExecutionOptions` data: undefined while loading, null when unavailable. */
  defaultExecutionOptions: ResolvedThreadExecutionOptions | null | undefined;
  defaultExecutionOptionsError: boolean;
  modelFallback: ThreadTimelineModelFallback | null;
  enabled: boolean;
}

interface ThreadExecutionOptionsState {
  /** Footer pills for the follow-up composer; null until the defaults resolve. */
  controls: ExecutionControlsProps | null;
  /** What the next request carries (null while the defaults are unknown). */
  selection: FollowUpExecutionSelection;
  defaultsState: DefaultExecutionOptionsState;
}

interface ExecutionPicks {
  model: string | null;
  reasoningLevel: ReasoningLevel | null;
  permissionMode: PermissionMode | null;
  serviceTier: ServiceTier | null;
  /** Identity (`threadId:sourceSeq`) of the model fallback the user overrode. */
  overriddenFallbackIdentity: string | null;
  /** Any control changed on this screen (all fields then go out explicit). */
  touched: boolean;
}

const INITIAL_PICKS: ExecutionPicks = {
  model: null,
  reasoningLevel: null,
  permissionMode: null,
  serviceTier: null,
  overriddenFallbackIdentity: null,
  touched: false,
};

/**
 * The follow-up composer's execution controls for one thread (mirrors the
 * `component-local` scope of the web useThreadCreationOptions as used by
 * ThreadDetailPromptArea): the thread's resolved defaults seed every pill,
 * the catalog comes from `GET /system/execution-options` routed through the
 * thread's environment, picks live in component state for the screen's
 * lifetime, and an active model fallback shows as the selected model until
 * the user picks another. Picks ride along with the next message as
 * execution overrides (the server persists them as the new defaults).
 */
export function useThreadExecutionOptions({
  thread,
  defaultExecutionOptions,
  defaultExecutionOptionsError,
  modelFallback,
  enabled,
}: UseThreadExecutionOptionsArgs): ThreadExecutionOptionsState {
  const [picks, setPicks] = useState<ExecutionPicks>(INITIAL_PICKS);
  const threadId = thread?.id ?? null;
  const providerId = thread?.providerId ?? "";
  const environmentId = thread?.environmentId ?? null;

  const executionOptions = useSystemExecutionOptions({
    ...resolveExecutionOptionsRouting(
      environmentId !== null
        ? { type: "reuse", environmentId }
        : PROJECT_DEFAULT_ENVIRONMENT,
    ),
    ...(providerId ? { providerId } : {}),
    enabled: enabled && thread !== undefined && thread.archivedAt === null,
  });
  const catalog = executionOptions.data;
  const providerInfo = catalog?.providers.find(
    (provider) => provider.id === providerId,
  );

  const defaultsState = resolveDefaultExecutionOptionsState({
    hasConcreteDefaultExecutionOptions:
      defaultExecutionOptions !== undefined && defaultExecutionOptions !== null,
    hasResolvedDefaultExecutionOptions: defaultExecutionOptions !== undefined,
    isError: defaultExecutionOptionsError,
  });
  const defaults = defaultExecutionOptions ?? null;

  // --- Model (with the fallback override) ------------------------------------
  const fallbackIdentity =
    modelFallback && threadId ? `${threadId}:${modelFallback.sourceSeq}` : null;
  const isFallbackModelActive =
    modelFallback !== null &&
    fallbackIdentity !== null &&
    picks.overriddenFallbackIdentity !== fallbackIdentity;
  const rawModel =
    picks.model ??
    (isFallbackModelActive ? modelFallback.fallbackModel : defaults?.model) ??
    "";
  const isLoadingModels =
    executionOptions.isLoading ||
    (executionOptions.isPlaceholderData && (catalog?.models.length ?? 0) === 0);
  const modelLoadError = catalog?.modelLoadError ?? null;
  const catalogVerified =
    executionOptions.isSuccess &&
    !executionOptions.isPlaceholderData &&
    modelLoadError === null;
  const modelSelection = useMemo(
    () =>
      resolveModelSelection({
        executionOptions: catalog,
        selectedModel: rawModel,
        catalogVerified,
      }),
    [catalog, catalogVerified, rawModel],
  );
  const effectiveModel = isFallbackModelActive
    ? modelFallback.fallbackModel
    : modelSelection.selectedModel;

  // --- Reasoning / permission / tier ------------------------------------------
  const reasoningOptions = useMemo(
    () => buildReasoningOptions(modelSelection.activeModel),
    [modelSelection.activeModel],
  );
  const reasoningLevel = resolveReasoningLevel(
    picks.reasoningLevel ?? defaults?.reasoningLevel,
    reasoningOptions,
  );
  const permissionModes = providerInfo?.capabilities.permissionModes;
  const ceiling: PermissionMode =
    (executionOptions.isPlaceholderData
      ? undefined
      : catalog?.permissionCeiling) ?? "full";
  const permissionModeOptions = useMemo(
    () => buildPermissionModeOptions({ permissionModes, ceiling }),
    [ceiling, permissionModes],
  );
  const permissionMode = resolvePermissionModeSelection(
    picks.permissionMode ?? defaults?.permissionMode,
    { permissionModes, ceiling },
  );
  const supportsServiceTier =
    providerInfo?.capabilities.supportsServiceTier ?? false;
  const serviceTier: ServiceTier | undefined =
    picks.serviceTier ?? defaults?.serviceTier ?? undefined;

  // --- Setters ------------------------------------------------------------------
  const selectModel = useCallback(
    (model: string) =>
      setPicks((current) => ({
        ...current,
        model,
        overriddenFallbackIdentity: fallbackIdentity,
        touched: true,
      })),
    [fallbackIdentity],
  );
  const selectReasoningLevel = useCallback(
    (level: ReasoningLevel) =>
      setPicks((current) => ({
        ...current,
        reasoningLevel: level,
        touched: true,
      })),
    [],
  );
  const selectPermissionMode = useCallback(
    (mode: PermissionMode) =>
      setPicks((current) => ({
        ...current,
        permissionMode: mode,
        touched: true,
      })),
    [],
  );
  const setFastMode = useCallback(
    (enabled: boolean) =>
      setPicks((current) => ({
        ...current,
        serviceTier: enabled ? "fast" : "default",
        touched: true,
      })),
    [],
  );

  const hasConcreteDefaults = defaultsState === "available";
  const selection = useMemo<FollowUpExecutionSelection>(() => {
    if (!hasConcreteDefaults) return null;
    return {
      model: effectiveModel,
      supportsServiceTier,
      serviceTier,
      reasoningLevel,
      permissionMode,
      executionInputSources: buildFollowUpExecutionInputSources({
        touched: picks.touched,
        forceExplicitModel: modelSelection.isRecovery,
        hasServiceTier: supportsServiceTier && serviceTier !== undefined,
      }),
    };
  }, [
    effectiveModel,
    hasConcreteDefaults,
    modelSelection.isRecovery,
    permissionMode,
    picks.touched,
    reasoningLevel,
    serviceTier,
    supportsServiceTier,
  ]);

  const modelLoadErrorMessage = useMemo(
    () =>
      modelLoadError === null
        ? null
        : formatModelLoadErrorText(
            modelLoadError,
            catalog?.providers.find(
              (provider) => provider.id === modelLoadError.providerId,
            )?.displayName ?? modelLoadError.providerId,
          ),
    [catalog?.providers, modelLoadError],
  );

  const controls = useMemo<ExecutionControlsProps | null>(() => {
    if (!hasConcreteDefaults) return null;
    return {
      provider: null,
      model: {
        options: modelSelection.options,
        moreOptions: modelSelection.moreOptions,
        value: effectiveModel,
        onChange: selectModel,
        isLoading: isLoadingModels,
        loadErrorMessage: modelLoadErrorMessage,
      },
      reasoning: {
        options: reasoningOptions,
        value: reasoningLevel,
        onChange: selectReasoningLevel,
      },
      fastMode: supportsServiceTier
        ? { enabled: serviceTier === "fast", onChange: setFastMode }
        : null,
      permission: {
        options: permissionModeOptions,
        value: permissionMode,
        onChange: selectPermissionMode,
      },
      testID: "thread-execution-controls",
    };
  }, [
    effectiveModel,
    hasConcreteDefaults,
    isLoadingModels,
    modelLoadErrorMessage,
    modelSelection.moreOptions,
    modelSelection.options,
    permissionMode,
    permissionModeOptions,
    reasoningLevel,
    reasoningOptions,
    selectModel,
    selectPermissionMode,
    selectReasoningLevel,
    serviceTier,
    setFastMode,
    supportsServiceTier,
  ]);

  return { controls, selection, defaultsState };
}
