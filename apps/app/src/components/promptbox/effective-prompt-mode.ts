import {
  promptInputHasCommandMention,
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
