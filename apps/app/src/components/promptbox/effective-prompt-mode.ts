import {
  promptInputHasCommandMention,
  type ThreadTimelineActivePromptMode,
  type PromptTextMention,
} from "@bb/domain";

export interface PromptModeInput {
  mentionRanges: readonly PromptTextMention[];
  providerId: string | undefined;
  value: string;
}

export interface PermissionDisplayOverride {
  label: string;
  compactLabel?: string;
  description?: string;
  title?: string;
}

const CLAUDE_PLAN_PERMISSION_DISPLAY: PermissionDisplayOverride = {
  label: "Plan Mode",
  compactLabel: "Plan",
  description: "Claude Code will plan without normal full-access execution.",
};

export function isClaudePlanModePrompt({
  mentionRanges,
  providerId,
  value,
}: PromptModeInput): boolean {
  return (
    providerId === "claude-code" &&
    promptInputHasCommandMention(
      [{ type: "text", text: value, mentions: [...mentionRanges] }],
      { trigger: "/", name: "plan" },
    )
  );
}

export function permissionDisplayForPromptMode(
  args: PromptModeInput,
): PermissionDisplayOverride | undefined {
  if (!isClaudePlanModePrompt(args)) {
    return undefined;
  }
  return CLAUDE_PLAN_PERMISSION_DISPLAY;
}

export function permissionDisplayForActivePromptMode(
  activePromptMode: ThreadTimelineActivePromptMode | null | undefined,
): PermissionDisplayOverride | undefined {
  if (
    activePromptMode?.mode === "plan" &&
    activePromptMode.providerId === "claude-code"
  ) {
    return CLAUDE_PLAN_PERMISSION_DISPLAY;
  }
  return undefined;
}

export function shouldDisablePermissionPickerForPromptMode(
  args: PromptModeInput,
): boolean {
  return isClaudePlanModePrompt(args);
}

export function shouldDisablePermissionPickerForActivePromptMode(
  activePromptMode: ThreadTimelineActivePromptMode | null | undefined,
): boolean {
  return activePromptMode?.mode === "plan";
}
