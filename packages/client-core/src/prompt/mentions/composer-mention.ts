import type { PromptMentionResource, PromptTextMention } from "@bb/domain";
import type {
  PromptDraftAttachment,
  PromptDraftState,
} from "../prompt-draft.js";

type PluginMentionResource = Extract<PromptMentionResource, { kind: "plugin" }>;

interface MentionRange {
  from: number;
  to: number;
}

export type ComposerMentionTargetShape =
  | Exclude<PromptMentionResource, { kind: "plugin" }>
  | (Omit<PluginMentionResource, "itemId"> & { provider: string; id: string });

export type ComposerMentionShape = MentionRange & ComposerMentionTargetShape;

export interface ComposerDraftShape {
  text: string;
  mentions: readonly ComposerMentionShape[];
  attachments: readonly PromptDraftAttachment[];
}

export function splitPluginMentionItemId(
  pluginId: string,
  itemId: string,
): { provider: string; id: string } {
  const separator = itemId.indexOf(":");
  return separator === -1
    ? { provider: pluginId, id: itemId }
    : { provider: itemId.slice(0, separator), id: itemId.slice(separator + 1) };
}

export function composerMentionTargetFromResource(
  resource: PromptMentionResource,
): ComposerMentionTargetShape {
  if (resource.kind !== "plugin") return resource;
  const { itemId, ...plugin } = resource;
  return {
    ...plugin,
    ...splitPluginMentionItemId(resource.pluginId, itemId),
  };
}

export function composerMentionFromPromptTextMention({
  start,
  end,
  resource,
}: PromptTextMention): ComposerMentionShape {
  return {
    from: start,
    to: end,
    ...composerMentionTargetFromResource(resource),
  };
}

export function promptMentionResourceFromComposerMention(
  mention: ComposerMentionTargetShape | ComposerMentionShape,
): PromptMentionResource {
  const target = composerMentionTarget(mention);
  if (target.kind !== "plugin") return target;
  const { provider, id, ...plugin } = target;
  return { ...plugin, itemId: `${provider}:${id}` };
}

function composerMentionTarget(
  mention: ComposerMentionTargetShape | ComposerMentionShape,
): ComposerMentionTargetShape {
  if (!("from" in mention)) return mention;
  const { from: _from, to: _to, ...target } = mention;
  return target;
}

export function promptTextMentionFromComposerMention(
  mention: ComposerMentionShape,
): PromptTextMention {
  return {
    start: mention.from,
    end: mention.to,
    resource: promptMentionResourceFromComposerMention(mention),
  };
}

export function composerDraftFromPromptDraft(
  draft: PromptDraftState,
): ComposerDraftShape {
  return {
    text: draft.text,
    mentions: draft.mentions.map(composerMentionFromPromptTextMention),
    attachments: draft.attachments,
  };
}

export function promptDraftFromComposerDraft(
  draft: ComposerDraftShape,
): PromptDraftState {
  return {
    text: draft.text,
    mentions: draft.mentions.map(promptTextMentionFromComposerMention),
    attachments: [...draft.attachments],
  };
}
