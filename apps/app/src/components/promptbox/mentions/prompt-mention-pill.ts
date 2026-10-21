import {
  composerMentionTargetFromResource,
  promptMentionResourceFromComposerMention,
  type ComposerMentionTargetShape,
} from "@bb/client-core";
import {
  PROMPT_MENTION_PILL_CLASS,
  promptMentionDisplayLabel,
  promptMentionTooltipLabel,
} from "./prompt-mention-display";
import {
  parsePromptMentionClipboardElement,
  promptMentionClipboardDataAttributes,
} from "./prompt-mention-clipboard";

export interface PromptMentionPresentation {
  className: string;
  title: string;
  text: string;
}

export function describePromptMention(
  mention: ComposerMentionTargetShape,
): PromptMentionPresentation {
  const resource = promptMentionResourceFromComposerMention(mention);
  return {
    className: PROMPT_MENTION_PILL_CLASS,
    title: promptMentionTooltipLabel(resource),
    text: promptMentionDisplayLabel(resource),
  };
}

export function promptMentionClipboardAttributes(
  mention: ComposerMentionTargetShape,
  text: string,
) {
  return promptMentionClipboardDataAttributes({
    resource: promptMentionResourceFromComposerMention(mention),
    serializedText: text,
  });
}

export function readPromptMentionClipboard(
  element: Element,
): { mention: ComposerMentionTargetShape; text: string } | null {
  const pill = parsePromptMentionClipboardElement({ element });
  return pill === null
    ? null
    : {
        mention: composerMentionTargetFromResource(pill.resource),
        text: pill.serializedText,
      };
}
