import { createContext } from "react";
import type { PromptMentionResource } from "@bb/domain";

/**
 * Resolves the click action for an inserted mention pill, or null when the
 * resource isn't openable in the current context (e.g. a directory mention
 * with nothing to preview). Returning a handler is also the signal that the
 * pill should render as an interactive link.
 */
export type PromptMentionLinkResolver = (
  resource: PromptMentionResource,
) => (() => void) | null;

export const PromptMentionLinkContext =
  createContext<PromptMentionLinkResolver | null>(null);
