import type { PromptMentionResource } from "@bb/domain";

export type PromptMentionLinkResolver = (
  resource: PromptMentionResource,
) => (() => void) | null;
