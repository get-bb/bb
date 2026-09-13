import { useMemo } from "react";
import type {
  PromptTextMention,
  ThreadTimelineActivePromptMode,
} from "@bb/domain";
import {
  isPlanModePrompt,
  permissionDisplayForActivePromptMode,
  permissionDisplayForPromptMode,
  shouldDisablePermissionPickerForActivePromptMode,
} from "@bb/client-core";
import type { ExecutionControlsProps } from "@/components/promptbox/ExecutionControls";

interface UsePromptModePermissionDisplayArgs {
  execution: ExecutionControlsProps;
  value: string;
  mentionRanges: readonly PromptTextMention[];
  activePromptMode: ThreadTimelineActivePromptMode | null;
}

export function usePromptModePermissionDisplay({
  execution,
  value,
  mentionRanges,
  activePromptMode,
}: UsePromptModePermissionDisplayArgs) {
  const selectedProviderPlanModeCopy = execution.provider.options?.find(
    (option) => option.value === execution.provider.selectedId,
  )?.planModeCopy;
  const promptModeInput = useMemo(
    () => ({
      planModeCopy: selectedProviderPlanModeCopy,
      value,
      mentionRanges,
    }),
    [mentionRanges, selectedProviderPlanModeCopy, value],
  );
  const permissionDisplayOverride = useMemo(
    () =>
      permissionDisplayForActivePromptMode(
        activePromptMode,
        selectedProviderPlanModeCopy,
      ) ?? permissionDisplayForPromptMode(promptModeInput),
    [activePromptMode, promptModeInput, selectedProviderPlanModeCopy],
  );
  const permissionPickerDisabledByPlanMode =
    shouldDisablePermissionPickerForActivePromptMode(activePromptMode) ||
    isPlanModePrompt(promptModeInput);
  return { permissionDisplayOverride, permissionPickerDisabledByPlanMode };
}
