import type {
  ProviderComposerCommand,
  PromptMentionCommandTrigger,
  ProviderComposerAction,
} from "@bb/domain";

export type ProviderPromptActionCommand = ProviderComposerCommand;

export interface ProviderPromptAction {
  kind: "goal" | "plan" | "skills";
  text: string;
  command?: ProviderPromptActionCommand;
}

export interface ProviderPromptActionProps {
  skillsTrigger: PromptMentionCommandTrigger | null;
  promptActions: readonly ProviderPromptAction[];
}

/**
 * Maps provider-owned composer metadata into the prompt action shape consumed
 * by app hosts.
 */
export function buildProviderPromptActionProps(
  composerActions: readonly ProviderComposerAction[],
): ProviderPromptActionProps {
  const promptActions: ProviderPromptAction[] = [];
  let skillsTrigger: PromptMentionCommandTrigger | null = null;

  for (const action of composerActions) {
    switch (action.kind) {
      case "skills":
        skillsTrigger = action.trigger;
        promptActions.push({
          kind: action.kind,
          text: action.trigger,
        });
        break;
      case "goal":
      case "plan":
        promptActions.push({
          kind: action.kind,
          command: action.command,
          text: serializedProviderCommand(action.command),
        });
        break;
    }
  }

  return { skillsTrigger, promptActions };
}

export function serializedProviderCommand(
  command: ProviderComposerCommand,
): string {
  return `${command.trigger}${command.name}${command.trailingText}`;
}

export function commandTriggerForComposerActions(
  composerActions: readonly ProviderComposerAction[],
): PromptMentionCommandTrigger | null {
  return buildProviderPromptActionProps(composerActions).skillsTrigger;
}

/**
 * A selected command is a one-position mention atom in the editor doc. The
 * dismissed range is based on that rendered node width plus any space inserted
 * after it, not on the serialized provider token length (`/review`, etc.).
 */
export function commandPillDismissedRangeEnd({
  triggerPosition,
  trailingText,
}: {
  triggerPosition: number;
  trailingText: string;
}): number {
  return triggerPosition + 1 + trailingText.length;
}
