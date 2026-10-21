import { createContext } from "react";
import type { PromptMentionResource } from "@bb/domain";
import type { MentionTarget } from "./composer-mentions";

export type PromptMentionLinkResolver = (
  resource: PromptMentionResource,
) => (() => void) | null;

export type ComposerMentionLinkResolver = (
  mention: MentionTarget,
) => (() => void) | null;

export const PromptMentionLinkContext =
  createContext<ComposerMentionLinkResolver | null>(null);
