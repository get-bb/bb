import { useCallback, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  usePendingAttachmentUploads,
  type PendingAttachmentUpload,
} from "@/components/promptbox/usePendingAttachmentUploads";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { BbHttpError } from "@/lib/sdk";
import type { PromptDraftAttachment } from "@bb/client-core";
import type { InlineComposerDraftSession } from "./useActiveComposerDraft";

interface UseComposerAttachmentUploadsArgs {
  projectId: string;
  draftStorageKey: string;
  addDraftAttachment: (attachment: PromptDraftAttachment) => void;
  inlineEditSessionId: number | null;
  inlineSessionRef: React.RefObject<InlineComposerDraftSession | null>;
}

interface UseComposerAttachmentUploadsResult {
  bottomAttachmentError: string | null;
  setBottomAttachmentError: (error: string | null) => void;
  handleAttachBottomFiles: (files: File[]) => Promise<PromptDraftAttachment[]>;
  isAttachingBottomFiles: boolean;
  bottomPendingUploads: readonly PendingAttachmentUpload[];
  inlineAttachmentError: string | null;
  setInlineAttachmentError: (error: string | null) => void;
  handleAttachInlineFiles: (files: File[]) => Promise<PromptDraftAttachment[]>;
  isAttachingInlineFiles: boolean;
  inlinePendingUploads: readonly PendingAttachmentUpload[];
}

interface DraftAttachmentUploadTarget {
  key: string;
  addAttachment: (attachment: PromptDraftAttachment) => void;
}

interface UseDraftAttachmentUploadsArgs {
  projectId: string;
  target: DraftAttachmentUploadTarget | null;
}

interface DraftAttachmentFailure {
  targetKey: string | null;
  message: string | null;
}

interface UseDraftAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachFiles: (files: File[]) => Promise<PromptDraftAttachment[]>;
  isAttachingFiles: boolean;
  pendingUploads: readonly PendingAttachmentUpload[];
}

function uploadRejectionReason(error: unknown): string | null {
  return error instanceof BbHttpError
    ? getMutationErrorMessage({ error, fallbackMessage: "Request failed" })
    : null;
}

function attachFailureMessage(
  failedFiles: readonly string[],
  reason: string | null,
): string {
  const names = failedFiles.join(", ");
  return reason === null
    ? `Failed to attach: ${names}`
    : `Failed to attach ${names}: ${reason}`;
}

export async function uploadDraftAttachments({
  uploads,
  target,
  upload,
  getCurrentTarget,
  onUploadSettled,
}: {
  uploads: readonly PendingAttachmentUpload[];
  target: DraftAttachmentUploadTarget;
  upload: (file: File) => Promise<PromptDraftAttachment>;
  getCurrentTarget: () => DraftAttachmentUploadTarget | null;
  onUploadSettled: (upload: PendingAttachmentUpload) => void;
}): Promise<{
  added: PromptDraftAttachment[];
  failureMessage: string | null;
}> {
  const added: PromptDraftAttachment[] = [];
  const failedFiles: string[] = [];
  let rejectionReason: string | null = null;
  for (const pendingUpload of uploads) {
    try {
      const uploaded = await upload(pendingUpload.file);
      target.addAttachment(uploaded);
      if (getCurrentTarget()?.key === target.key) {
        added.push(uploaded);
      }
    } catch (error) {
      failedFiles.push(pendingUpload.file.name);
      rejectionReason ??= uploadRejectionReason(error);
    } finally {
      onUploadSettled(pendingUpload);
    }
  }
  return {
    added,
    failureMessage:
      failedFiles.length > 0
        ? attachFailureMessage(failedFiles, rejectionReason)
        : null,
  };
}

export function useDraftAttachmentUploads({
  projectId,
  target,
}: UseDraftAttachmentUploadsArgs): UseDraftAttachmentUploadsResult {
  const uploadPromptAttachment = useUploadPromptAttachment();
  const targetRef = useRef(target);
  targetRef.current = target;
  const [failure, setFailure] = useState<DraftAttachmentFailure>({
    targetKey: null,
    message: null,
  });
  const targetKey = target?.key ?? null;
  const { pendingUploads, startUploads, finishUploads } =
    usePendingAttachmentUploads(
      targetKey === null ? null : `${projectId}\0${targetKey}`,
    );

  const setAttachmentError = useCallback(
    (message: string | null) => setFailure({ targetKey, message }),
    [targetKey],
  );
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      const activeTarget = targetRef.current;
      if (!activeTarget || files.length === 0) return [];
      setFailure({ targetKey: activeTarget.key, message: null });
      const result = await uploadDraftAttachments({
        uploads: startUploads(files),
        target: activeTarget,
        upload: (file) =>
          uploadPromptAttachment.mutateAsync({ projectId, file }),
        getCurrentTarget: () => targetRef.current,
        onUploadSettled: (upload) => finishUploads([upload]),
      });
      if (
        result.failureMessage !== null &&
        targetRef.current?.key === activeTarget.key
      ) {
        setFailure({
          targetKey: activeTarget.key,
          message: result.failureMessage,
        });
      }
      return result.added;
    },
    [projectId, uploadPromptAttachment, startUploads, finishUploads],
  );

  return {
    attachmentError: failure.targetKey === targetKey ? failure.message : null,
    isAttachingFiles: pendingUploads.length > 0,
    setAttachmentError,
    handleAttachFiles,
    pendingUploads,
  };
}

export function useComposerAttachmentUploads({
  projectId,
  draftStorageKey,
  addDraftAttachment,
  inlineEditSessionId,
  inlineSessionRef,
}: UseComposerAttachmentUploadsArgs): UseComposerAttachmentUploadsResult {
  const {
    attachmentError: bottomAttachmentError,
    setAttachmentError: setBottomAttachmentError,
    handleAttachFiles: handleAttachBottomFiles,
    isAttachingFiles: isAttachingBottomFiles,
    pendingUploads: bottomPendingUploads,
  } = useDraftAttachmentUploads({
    projectId,
    target: { key: draftStorageKey, addAttachment: addDraftAttachment },
  });
  const [inlineUploadScope] = useState(nanoid);
  const addInlineAttachment = useCallback(
    (uploaded: PromptDraftAttachment) => {
      const current = inlineSessionRef.current;
      if (current === null || current.editSessionId !== inlineEditSessionId) {
        return;
      }
      current.setDraft((draft) =>
        draft.attachments.some((existing) => existing.path === uploaded.path)
          ? draft
          : { ...draft, attachments: [...draft.attachments, uploaded] },
      );
    },
    [inlineEditSessionId, inlineSessionRef],
  );
  const {
    attachmentError: inlineAttachmentError,
    setAttachmentError: setInlineAttachmentError,
    handleAttachFiles: handleAttachInlineFiles,
    isAttachingFiles: isAttachingInlineFiles,
    pendingUploads: inlinePendingUploads,
  } = useDraftAttachmentUploads({
    projectId,
    target:
      inlineEditSessionId !== null
        ? {
            key: `${inlineUploadScope}:${inlineEditSessionId}`,
            addAttachment: addInlineAttachment,
          }
        : null,
  });

  return {
    bottomAttachmentError,
    setBottomAttachmentError,
    handleAttachBottomFiles,
    isAttachingBottomFiles,
    bottomPendingUploads,
    inlineAttachmentError,
    setInlineAttachmentError,
    handleAttachInlineFiles,
    isAttachingInlineFiles,
    inlinePendingUploads,
  };
}
