import { memo } from "react";
import type { PermissionMode, ReasoningLevel, ServiceTier } from "@bb/domain";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import { type PickerOption } from "@/components/pickers/OptionPicker";

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
  /** Models behind the picker's collapsed "More models" section. */
  moreOptions: readonly PickerOption<string>[];
  isLoading: boolean;
  loadFailed: boolean;
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
  const selectedProviderId = provider.selectedId ?? "";

  // A disabled picker still renders (showing the inherited model) even though
  // its provider can't be switched — the side chat lists a single model option
  // for the inherited model so the picker has something to display.
  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    model.isLoading ||
    model.loadFailed ||
    model.options.length > 0 ||
    canSwitchProviders ||
    selectedProviderId.length > 0;

  return (
    <>
      {showModelPicker ? (
        <ModelReasoningPicker
          providerOptions={provider.options ?? []}
          selectedProviderId={selectedProviderId}
          onSelectedProviderChange={provider.onChange}
          hasMultipleProviders={provider.hasMultiple ?? false}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          moreModelOptions={model.moreOptions}
          modelIsLoading={model.isLoading}
          modelLoadFailed={model.loadFailed}
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
    </>
  );
});
