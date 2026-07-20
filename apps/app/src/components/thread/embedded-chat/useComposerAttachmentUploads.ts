import { useCallback, useState } from "react";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import type { PromptDraftAttachment } from "@/lib/prompt-draft";
import type { InlineQueuedMessageEditState } from "./useInlineQueuedMessageEditing";

interface UseComposerAttachmentUploadsArgs {
  projectId: string;
  /** Appends an uploaded attachment to the bottom composer draft. */
  addDraftAttachment: (attachment: PromptDraftAttachment) => void;
  inlineEditingQueuedMessage: InlineQueuedMessageEditState | null;
  inlineEditingQueuedMessageRef: React.RefObject<InlineQueuedMessageEditState | null>;
  commitInlineQueuedMessage: (next: InlineQueuedMessageEditState | null) => void;
}

export interface UseComposerAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachFiles: (files: File[]) => Promise<void>;
  isAttaching: boolean;
}

/**
 * Uploads dropped/picked files and appends them to whichever draft owns the
 * composer at upload time: the bottom draft, or — captured per invocation so a
 * dismissed edit session can't receive a late upload — the inline queued-message
 * edit draft.
 */
export function useComposerAttachmentUploads({
  projectId,
  addDraftAttachment,
  inlineEditingQueuedMessage,
  inlineEditingQueuedMessageRef,
  commitInlineQueuedMessage,
}: UseComposerAttachmentUploadsArgs): UseComposerAttachmentUploadsResult {
  const uploadPromptAttachment = useUploadPromptAttachment();
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const attachmentOwner = inlineEditingQueuedMessage
        ? {
            kind: "queued" as const,
            editSessionId: inlineEditingQueuedMessage.editSessionId,
            ownerThreadId: inlineEditingQueuedMessage.ownerThreadId,
            queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
          }
        : {
            addAttachment: addDraftAttachment,
            kind: "bottom" as const,
          };
      setAttachmentError(null);
      const failedFiles: string[] = [];
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId,
            file,
          });
          if (attachmentOwner.kind === "bottom") {
            attachmentOwner.addAttachment(uploaded);
          } else {
            const current = inlineEditingQueuedMessageRef.current;
            if (
              current &&
              current.editSessionId === attachmentOwner.editSessionId &&
              current.ownerThreadId === attachmentOwner.ownerThreadId &&
              current.queuedMessageId === attachmentOwner.queuedMessageId &&
              !current.draft.attachments.some(
                (existing) => existing.path === uploaded.path,
              )
            ) {
              commitInlineQueuedMessage({
                ...current,
                draft: {
                  ...current.draft,
                  attachments: [...current.draft.attachments, uploaded],
                },
              });
            }
          }
        } catch {
          failedFiles.push(file.name);
        }
      }
      if (failedFiles.length > 0) {
        setAttachmentError(`Failed to attach: ${failedFiles.join(", ")}`);
      }
    },
    [
      addDraftAttachment,
      commitInlineQueuedMessage,
      inlineEditingQueuedMessage,
      inlineEditingQueuedMessageRef,
      projectId,
      uploadPromptAttachment,
    ],
  );

  return {
    attachmentError,
    setAttachmentError,
    handleAttachFiles,
    isAttaching: uploadPromptAttachment.isPending,
  };
}
