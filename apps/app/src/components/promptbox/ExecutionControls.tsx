import { memo, useEffect, useState } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { ModelLoadErrorMessage } from "@/components/pickers/model-load-error-message";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import {
  OptionDisplay,
  type PickerOption,
} from "@/components/pickers/OptionPicker";

const MODEL_LOADING_VISIBLE_DELAY_MS = 180;

export interface ExecutionProviderConfig {
  options?: readonly PickerOption<string>[];
  selectedId?: string;
  /** Omit to render the provider as locked (used by FollowUp where the thread is committed). */
  onChange?: (value: string) => void;
  hasMultiple?: boolean;
  displayName?: string;
}

export interface ExecutionModelConfig {
  active?: { model: string } | null;
  selected: string;
  options: readonly PickerOption<string>[];
  isLoading: boolean;
  loadError?: SystemExecutionOptionsModelLoadError | null;
  onChange: (value: string) => void;
}

export interface ExecutionServiceTierConfig {
  value?: ServiceTier;
  onChange: (value: ServiceTier | undefined) => void;
  supported: boolean;
  supportByProvider?: Record<string, boolean>;
}

export interface ExecutionReasoningConfig {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
}

export interface ExecutionPermissionConfig {
  value?: PermissionMode;
  options: readonly PickerOption<PermissionMode>[];
  onChange: (value: PermissionMode) => void;
  supported: boolean;
}

export interface ExecutionControlsProps {
  provider: ExecutionProviderConfig;
  model: ExecutionModelConfig;
  serviceTier?: ExecutionServiceTierConfig;
  reasoning: ExecutionReasoningConfig;
}

interface UseDelayedVisibleArgs {
  visible: boolean;
  delayMs: number;
}

function useDelayedVisible({
  visible,
  delayMs,
}: UseDelayedVisibleArgs): boolean {
  const [delayedVisible, setDelayedVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setDelayedVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDelayedVisible(true);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, visible]);

  return delayedVisible;
}

export const ExecutionControls = memo(function ExecutionControls({
  provider,
  model,
  serviceTier,
  reasoning,
}: ExecutionControlsProps) {
  const showModelLoading = useDelayedVisible({
    visible: model.isLoading,
    delayMs: MODEL_LOADING_VISIBLE_DELAY_MS,
  });
  const handleServiceTierChange = serviceTier?.onChange ?? (() => {});
  const isProviderLocked = provider.onChange === undefined;
  const selectedProviderId = provider.selectedId ?? "";
  const selectedProviderOption = provider.options?.find(
    (candidate) => candidate.value === selectedProviderId,
  );
  const selectedProviderLabel =
    provider.displayName ?? selectedProviderOption?.label ?? selectedProviderId;

  // Show read-only provider label when provider is locked (thread follow-up)
  // and there's no model list to show in the unified picker.
  const showReadOnlyProvider =
    provider.hasMultiple &&
    isProviderLocked &&
    provider.displayName &&
    model.options.length === 0;

  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    !model.isLoading && (model.options.length > 0 || canSwitchProviders);
  const selectedProviderModelLoadError =
    model.loadError?.providerId === selectedProviderId ? model.loadError : null;
  const showModelLoadError =
    !model.isLoading &&
    !showModelPicker &&
    selectedProviderModelLoadError !== null;

  return (
    <>
      {showReadOnlyProvider ? (
        <OptionDisplay
          label="Provider"
          value={provider.displayName}
          icon={selectedProviderOption?.icon}
          muted
        />
      ) : null}
      {showModelLoading ? (
        <OptionDisplay
          label="Model"
          value={
            <span className="animate-shine whitespace-nowrap">
              Loading models...
            </span>
          }
          compactValue={
            <span className="animate-shine whitespace-nowrap">Loading</span>
          }
          title="Loading models..."
          muted
        />
      ) : null}
      {showModelPicker ? (
        <ModelReasoningPicker
          providerOptions={provider.options ?? []}
          selectedProviderId={selectedProviderId}
          onSelectedProviderChange={provider.onChange}
          hasMultipleProviders={provider.hasMultiple ?? false}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          modelLoadError={model.loadError}
          onModelChange={model.onChange}
          formatModelLabel={formatModelLabel}
          reasoningValue={reasoning.value}
          reasoningOptions={reasoning.options}
          onReasoningChange={reasoning.onChange}
          fastModeEnabled={serviceTier?.value === "fast"}
          onFastModeChange={(enabled) =>
            handleServiceTierChange(enabled ? "fast" : undefined)
          }
          showFastModeToggle={serviceTier?.supported ?? false}
          serviceTierSupportByProvider={serviceTier?.supportByProvider}
          muted
        />
      ) : null}
      {showModelLoadError ? (
        <span className="inline-flex min-w-0 items-center text-xs text-muted-foreground">
          <ModelLoadErrorMessage
            error={selectedProviderModelLoadError}
            providerLabel={selectedProviderLabel}
          />
        </span>
      ) : null}
    </>
  );
});
