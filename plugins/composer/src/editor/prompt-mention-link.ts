import { createContext } from "react";
import type { MentionTarget } from "./composer-mentions";

export type PromptMentionLinkResolver = (
  mention: MentionTarget,
) => (() => void) | null;

export const PromptMentionLinkContext =
  createContext<PromptMentionLinkResolver | null>(null);
