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
  commitInlineQueuedMessage: (
    next: InlineQueuedMessageEditState | null,
  ) => void;
}

export interface UseComposerAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachBottomFiles: (files: File[]) => Promise<void>;
  handleAttachInlineFiles: (files: File[]) => Promise<void>;
  isAttaching: boolean;
}

/**
 * Uploads dropped/picked files for either independently mounted composer. The
 * inline owner is captured per invocation so a dismissed edit session cannot
 * receive a late upload.
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

  const uploadFiles = useCallback(
    async (
      files: File[],
      attachmentOwner:
        | { addAttachment: typeof addDraftAttachment; kind: "bottom" }
        | {
            editSessionId: number;
            kind: "queued";
            ownerThreadId: string;
            queuedMessageId: string;
          },
    ) => {
      if (files.length === 0) {
        return;
      }
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
      commitInlineQueuedMessage,
      inlineEditingQueuedMessageRef,
      projectId,
      uploadPromptAttachment,
    ],
  );
  const handleAttachBottomFiles = useCallback(
    (files: File[]) =>
      uploadFiles(files, {
        addAttachment: addDraftAttachment,
        kind: "bottom",
      }),
    [addDraftAttachment, uploadFiles],
  );
  const handleAttachInlineFiles = useCallback(
    (files: File[]) => {
      if (!inlineEditingQueuedMessage) {
        return Promise.resolve();
      }
      return uploadFiles(files, {
        editSessionId: inlineEditingQueuedMessage.editSessionId,
        kind: "queued",
        ownerThreadId: inlineEditingQueuedMessage.ownerThreadId,
        queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
      });
    },
    [inlineEditingQueuedMessage, uploadFiles],
  );

  return {
    attachmentError,
    setAttachmentError,
    handleAttachBottomFiles,
    handleAttachInlineFiles,
    isAttaching: uploadPromptAttachment.isPending,
  };
}
