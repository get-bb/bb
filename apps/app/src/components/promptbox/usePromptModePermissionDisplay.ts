import { useCallback, useMemo } from "react";
import type { ThreadTimelineActivePromptMode } from "@bb/domain";
import {
  isPlanModePrompt,
  permissionDisplayForActivePromptMode,
  planPermissionDisplay,
  shouldDisablePermissionPickerForActivePromptMode,
  type PromptDraftState,
} from "@bb/client-core";
import type { ExecutionControlsProps } from "@/components/promptbox/ExecutionControls";
import {
  useComposerDraftSelector,
  type ComposerDraftSource,
} from "@/components/plugin/plugin-composer-host";

interface UsePromptModePermissionDisplayArgs {
  execution: ExecutionControlsProps;
  draft: ComposerDraftSource;
  activePromptMode: ThreadTimelineActivePromptMode | null;
}

export function usePromptModePermissionDisplay({
  execution,
  draft,
  activePromptMode,
}: UsePromptModePermissionDisplayArgs) {
  const selectedProviderPlanModeCopy = execution.provider.options?.find(
    (option) => option.value === execution.provider.selectedId,
  )?.planModeCopy;
  const selectIsPlanModePrompt = useCallback(
    (current: PromptDraftState) =>
      isPlanModePrompt({
        planModeCopy: selectedProviderPlanModeCopy,
        value: current.text,
        mentionRanges: current.mentions,
      }),
    [selectedProviderPlanModeCopy],
  );
  const planModePrompt = useComposerDraftSelector(
    draft,
    selectIsPlanModePrompt,
  );
  const permissionDisplayOverride = useMemo(
    () =>
      permissionDisplayForActivePromptMode(
        activePromptMode,
        selectedProviderPlanModeCopy,
      ) ??
      (planModePrompt && selectedProviderPlanModeCopy !== undefined
        ? planPermissionDisplay(selectedProviderPlanModeCopy)
        : undefined),
    [activePromptMode, planModePrompt, selectedProviderPlanModeCopy],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForActivePromptMode(activePromptMode) ||
    planModePrompt;
  return { permissionDisplayOverride, permissionPickerDisabledByPlanMode };
}
