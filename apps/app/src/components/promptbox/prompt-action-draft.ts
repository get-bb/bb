import type { PromptMentionCommandTrigger, PromptTextMention } from "@bb/domain";
import type { ProviderCommandSuggestion } from "@bb/client-core";
import { promptCommandResourceFromSuggestion } from "./editor/prompt-editor-serialization";
import type { PromptBoxAction } from "./PromptBoxActionsMenu";

/**
 * Prompt-action → draft translation shared by the mounted editor's
 * editorless fallback (PromptBoxInternal) and the pre-handoff shell
 * (PromptBox). Deliberately tiptap-free: prompt-editor-serialization's
 * tiptap imports are type-only, so this module stays in the light route
 * closure while the editor chunk loads on demand.
 */

export interface PromptActionCommand {
  serializedText: string;
  trailingText: string;
  trigger: PromptMentionCommandTrigger;
  suggestion: ProviderCommandSuggestion;
}

export function promptActionCommandSerializedText(
  action: PromptBoxAction,
): string {
  if (!action.command) {
    return action.text;
  }
  return `${action.command.trigger}${action.command.name}`;
}

export function promptActionCommandFromAction(
  action: PromptBoxAction,
): PromptActionCommand | null {
  if (action.kind === "skills" || !action.command) {
    return null;
  }

  const { trigger, name, trailingText } = action.command;
  const serializedText = `${trigger}${name}`;
  return {
    serializedText,
    trailingText,
    trigger,
    suggestion: {
      kind: "command",
      name,
      source: "command",
      origin: "user",
      description: null,
      argumentHint: null,
    },
  };
}

export interface AppendPromptActionToDraftArgs {
  action: PromptBoxAction;
  text: string;
  mentions: readonly PromptTextMention[];
}

export interface AppendedPromptActionDraft {
  text: string;
  mentions: PromptTextMention[];
}

/**
 * Applies a prompt action to a draft without an editor: append the action's
 * text (or its command pill serialization plus mention range) at the end.
 * Returns null when the action is a no-op — empty text, or the draft already
 * ends with it.
 */
export function appendPromptActionToDraft({
  action,
  text,
  mentions,
}: AppendPromptActionToDraftArgs): AppendedPromptActionDraft | null {
  if (action.text.length === 0) return null;
  if (text.endsWith(action.text)) return null;

  const commandAction = promptActionCommandFromAction(action);
  if (commandAction) {
    const start = text.length;
    return {
      text: `${text}${commandAction.serializedText}${commandAction.trailingText}`,
      mentions: [
        ...mentions,
        {
          start,
          end: start + commandAction.serializedText.length,
          resource: promptCommandResourceFromSuggestion({
            suggestion: commandAction.suggestion,
            trigger: commandAction.trigger,
          }),
        },
      ],
    };
  }

  return {
    text: `${text}${action.text}`,
    mentions: [...mentions],
  };
}
