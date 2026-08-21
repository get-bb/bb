import type { ExecutionControlsProps } from "@/composer";
import type { ComposeController } from "./useComposeController";

/**
 * The agent pills (provider, model + reasoning (+ Fast), permissions) as the
 * shared composer's execution-controls props. The where-it-runs pickers
 * (project, environment, machine, branch, folder) sit on the composer's top
 * row instead (see ComposeDock).
 */
export function composeExecutionControls(
  controller: ComposeController,
  options: { disabled?: boolean } = {},
): ExecutionControlsProps {
  const c = controller;
  return {
    provider: {
      options: c.providerOptions,
      value: c.providerId,
      onChange: c.selectProvider,
      loading: c.isLoadingModels && c.providerOptions.length === 0,
    },
    model: {
      options: c.modelOptions,
      moreOptions: c.moreModelOptions,
      value: c.model,
      onChange: c.selectModel,
      isLoading: c.isLoadingModels,
      loadErrorMessage: c.modelLoadErrorMessage,
    },
    reasoning: {
      options: c.reasoningOptions,
      value: c.reasoningLevel,
      onChange: c.selectReasoningLevel,
    },
    fastMode: c.supportsServiceTier
      ? { enabled: c.fastMode, onChange: c.setFastMode }
      : null,
    permission: {
      options: c.permissionModeOptions,
      value: c.permissionMode,
      onChange: c.selectPermissionMode,
    },
    disabled: options.disabled,
    testID: "compose-controls",
  };
}
