import { createContext } from "react";
import type {
  PromptDraftAttachment,
  PromptMentionLinkResolver,
} from "@bb/client-core";
import type { OpenAttachmentRequest } from "@/components/secondary-panel/AttachmentOpenerContext";
import { isProjectAttachmentPath } from "@/lib/file-content-urls";
import { composerMentionResource } from "../mentions/prompt-mention-pill";
import type { MentionTarget } from "./composer-mentions";

export type ComposerMentionLinkResolver = (
  mention: MentionTarget,
) => (() => void) | null;

export const PromptMentionLinkContext =
  createContext<ComposerMentionLinkResolver | null>(null);

interface MentionLinkSources {
  resolveLink: PromptMentionLinkResolver | undefined;
  attachments: readonly PromptDraftAttachment[];
  attachmentProjectId: string | undefined;
  openAttachment: ((request: OpenAttachmentRequest) => void) | null;
}

export function mentionLinkResolver({
  resolveLink,
  attachments,
  attachmentProjectId,
  openAttachment,
}: MentionLinkSources): ComposerMentionLinkResolver {
  return (mention) => {
    if (mention.kind !== "attachment") {
      return resolveLink?.(composerMentionResource(mention)) ?? null;
    }
    const attachment = attachments.find((item) => item.path === mention.path);
    const projectId = attachment?.sourceProjectId ?? attachmentProjectId;
    if (
      !attachment ||
      !openAttachment ||
      !projectId ||
      !isProjectAttachmentPath(attachment)
    ) {
      return null;
    }
    return () =>
      openAttachment({
        name: attachment.name,
        path: attachment.path,
        projectId,
      });
  };
}
