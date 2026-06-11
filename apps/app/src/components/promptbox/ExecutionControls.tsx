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
  /** Omit to render the model as a locked, read-only label (used by surfaces that inherit a parent thread's model, e.g. side chats). */
  onChange?: (value: string) => void;
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
  /** Omit to render the permission as a locked, read-only label (used by surfaces with a fixed permission mode, e.g. always-readonly side chats). */
  onChange?: (value: PermissionMode) => void;
  supported: boolean;
}

export interface ExecutionControlsProps {
  provider: ExecutionProviderConfig;
  model: ExecutionModelConfig;
  serviceTier?: ExecutionServiceTierConfig;
  /** Required for interactive (editable-model) surfaces. Omit on locked surfaces (model.onChange undefined), where the reasoning picker never renders. */
  reasoning?: ExecutionReasoningConfig;
}

export const ExecutionControls = memo(function ExecutionControls({
  provider,
  model,
  serviceTier,
  reasoning,
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

  // A locked model (no onChange) inherits its value from elsewhere (e.g. a side
  // chat inheriting the parent thread's model). Render it as a static label
  // instead of the interactive picker, mirroring the locked-provider treatment.
  const onModelChange = model.onChange;
  const lockedModelValue = model.active?.model ?? model.selected;
  const showReadOnlyModel =
    onModelChange === undefined && lockedModelValue.length > 0;

  const canSwitchProviders = Boolean(
    provider.hasMultiple &&
    provider.onChange &&
    provider.options &&
    provider.options.length > 1,
  );
  const showModelPicker =
    onModelChange !== undefined &&
    (model.options.length > 0 || canSwitchProviders);
  const selectedProviderModelLoadError =
    model.loadError?.providerId === selectedProviderId ? model.loadError : null;
  const showModelLoadError =
    !showModelPicker &&
    !showReadOnlyModel &&
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
      {showReadOnlyModel ? (
        <OptionDisplay
          label="Model"
          value={formatModelLabel(lockedModelValue)}
          compactValue={formatModelLabel(lockedModelValue)}
          muted
        />
      ) : null}
      {showModelPicker && reasoning ? (
        <ModelReasoningPicker
          providerOptions={provider.options ?? []}
          selectedProviderId={selectedProviderId}
          onSelectedProviderChange={provider.onChange}
          hasMultipleProviders={provider.hasMultiple ?? false}
          modelValue={model.active?.model ?? model.selected}
          modelOptions={model.options}
          modelLoadError={model.loadError}
          onModelChange={onModelChange}
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
