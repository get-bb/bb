import { memo } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { ModelLoadErrorMessage } from "@/components/pickers/model-load-error-message";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import {
  OptionDisplay,
  type PickerOption,
} from "@/components/pickers/OptionPicker";

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
  /**
   * Render the model/reasoning picker as a non-interactive, dimmed label
   * (read-only surfaces, e.g. the side chat inheriting the parent thread's
   * model). The same picker renders, just disabled.
   */
  disabled?: boolean;
}

export const ExecutionControls = memo(function ExecutionControls({
  provider,
  model,
  serviceTier,
  reasoning,
  disabled,
}: ExecutionControlsProps) {
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

  // A disabled picker still renders (showing the inherited model) even though
  // its provider can't be switched — the side chat lists a single model option
  // for the inherited model so the picker has something to display.
  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker = model.options.length > 0 || canSwitchProviders;
  const selectedProviderModelLoadError =
    model.loadError?.providerId === selectedProviderId ? model.loadError : null;
  const showModelLoadError =
    !showModelPicker && selectedProviderModelLoadError !== null;

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
          disabled={disabled}
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
