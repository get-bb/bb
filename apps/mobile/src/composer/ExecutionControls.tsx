import type { PermissionMode, ReasoningLevel } from "@bb/domain";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import type {
  ModelPickerOption,
  PermissionModePickerOption,
  ProviderPickerOption,
  ReasoningPickerOption,
} from "@/data/compose";
import {
  ModelReasoningPicker,
  PermissionModePicker,
  ProviderPicker,
} from "@/screens/pickers";

/**
 * Controller-shaped props for the execution pills under the prompt: the
 * home dock maps `useComposeController` onto them; the thread screen
 * maps its thread execution options. Pure presentation over the Phase 3
 * picker sheets; `null` sections are not rendered.
 */
export interface ExecutionControlsProps {
  provider?: {
    options: readonly ProviderPickerOption[];
    value: string;
    onChange: (providerId: string) => void;
    loading?: boolean;
  } | null;
  model: {
    options: readonly ModelPickerOption[];
    moreOptions: readonly ModelPickerOption[];
    value: string;
    onChange: (model: string) => void;
    isLoading?: boolean;
    loadErrorMessage?: string | null;
  };
  reasoning: {
    options: readonly ReasoningPickerOption[];
    value: ReasoningLevel;
    onChange: (level: ReasoningLevel) => void;
  };
  /** Service tier "Fast" toggle; omit when the provider has no tiers. */
  fastMode?: { enabled: boolean; onChange: (enabled: boolean) => void } | null;
  permission?: {
    options: readonly PermissionModePickerOption[];
    value: PermissionMode;
    onChange: (mode: PermissionMode) => void;
  } | null;
  disabled?: boolean;
  trailing?: ReactNode;
  testID?: string;
}

export function ExecutionControls({
  provider,
  model,
  reasoning,
  fastMode,
  permission,
  disabled = false,
  trailing,
  testID = "composer-execution-controls",
}: ExecutionControlsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 8, alignItems: "center" }}
      style={{ flexGrow: 1, flexShrink: 1 }}
      testID={testID}
    >
      {provider && (provider.options.length > 1 || provider.value) ? (
        <ProviderPicker
          options={provider.options}
          value={provider.value}
          onChange={provider.onChange}
          disabled={disabled}
          loading={provider.loading}
        />
      ) : null}
      <ModelReasoningPicker
        modelOptions={model.options}
        moreModelOptions={model.moreOptions}
        modelValue={model.value}
        onModelChange={model.onChange}
        reasoningOptions={reasoning.options}
        reasoningValue={reasoning.value}
        onReasoningChange={reasoning.onChange}
        fastMode={fastMode ?? undefined}
        isLoading={model.isLoading}
        loadErrorMessage={model.loadErrorMessage}
        disabled={disabled}
      />
      {permission ? (
        <PermissionModePicker
          options={permission.options}
          value={permission.value}
          onChange={permission.onChange}
          disabled={disabled}
        />
      ) : null}
      {trailing}
    </ScrollView>
  );
}
