import type { PromptMentionResource } from "@bb/domain";
import {
  composerMentionTargetFromResource,
  parsePromptMentionClipboardElement,
  PROMPT_MENTION_PILL_CLASS,
  promptMentionClipboardDataAttributes,
  promptMentionDisplayLabel,
  promptMentionResourceFromComposerMention,
  promptMentionTooltipLabel,
  type ComposerMentionTargetShape,
} from "@bb/client-core";

export interface PromptMentionPresentation {
  className: string;
  title: string;
  text: string;
}

const resourcesByMention = new WeakMap<
  ComposerMentionTargetShape,
  PromptMentionResource
>();

export function composerMentionResource(
  mention: ComposerMentionTargetShape,
): PromptMentionResource {
  const cached = resourcesByMention.get(mention);
  if (cached !== undefined) return cached;
  const resource = promptMentionResourceFromComposerMention(mention);
  resourcesByMention.set(mention, resource);
  return resource;
}

export function describePromptMention(
  mention: ComposerMentionTargetShape,
): PromptMentionPresentation {
  const resource = composerMentionResource(mention);
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
    resource: composerMentionResource(mention),
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
