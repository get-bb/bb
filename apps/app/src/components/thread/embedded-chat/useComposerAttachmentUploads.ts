import { useCallback, useRef, useState } from "react";
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
  addDraftAttachment: (attachment: PromptDraftAttachment) => void;
  inlineEditSessionId: number | null;
  inlineSessionRef: React.RefObject<InlineComposerDraftSession | null>;
}

interface UseComposerAttachmentUploadsResult {
  bottomAttachmentError: string | null;
  setBottomAttachmentError: (error: string | null) => void;
  handleAttachBottomFiles: (files: File[]) => Promise<void>;
  isAttachingBottomFiles: boolean;
  bottomPendingUploads: readonly PendingAttachmentUpload[];
  inlineAttachmentError: string | null;
  setInlineAttachmentError: (error: string | null) => void;
  handleAttachInlineFiles: (files: File[]) => Promise<void>;
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

interface UseDraftAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachFiles: (files: File[]) => Promise<void>;
  isAttachingFiles: boolean;
  pendingUploads: readonly PendingAttachmentUpload[];
}

interface DraftAttachmentOperationState {
  error: string | null;
  pendingCount: number;
  targetKey: string | null;
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

export function useDraftAttachmentUploads({
  projectId,
  target,
}: UseDraftAttachmentUploadsArgs): UseDraftAttachmentUploadsResult {
  const uploadPromptAttachment = useUploadPromptAttachment();
  const targetRef = useRef(target);
  targetRef.current = target;
  const [operation, setOperation] = useState<DraftAttachmentOperationState>({
    error: null,
    pendingCount: 0,
    targetKey: null,
  });
  const targetKey = target?.key ?? null;
  const isCurrentOperation = operation.targetKey === targetKey;
  const { pendingUploads, startUploads, finishUploads } = usePendingAttachmentUploads(
    targetKey === null ? null : `${projectId}\0${targetKey}`,
  );

  const setAttachmentError = useCallback(
    (error: string | null) => {
      setOperation((current) => ({
        error,
        pendingCount:
          current.targetKey === targetKey ? current.pendingCount : 0,
        targetKey,
      }));
    },
    [targetKey],
  );
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      const activeTarget = targetRef.current;
      if (!activeTarget || files.length === 0) return;
      const capturedTargetKey = activeTarget.key;
      setOperation((current) => ({
        error: null,
        pendingCount:
          current.targetKey === capturedTargetKey
            ? current.pendingCount + 1
            : 1,
        targetKey: capturedTargetKey,
      }));
      const uploads = startUploads(files);
      const failedFiles: string[] = [];
      let rejectionReason: string | null = null;
      try {
        for (const upload of uploads) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file: upload.file,
            });
            const currentTarget = targetRef.current;
            if (currentTarget?.key === capturedTargetKey) {
              currentTarget.addAttachment(uploaded);
            }
          } catch (error) {
            failedFiles.push(upload.file.name);
            rejectionReason ??= uploadRejectionReason(error);
          } finally {
            finishUploads([upload]);
          }
        }
      } finally {
        setOperation((current) =>
          current.targetKey === capturedTargetKey
            ? {
                error:
                  failedFiles.length > 0 &&
                  targetRef.current?.key === capturedTargetKey
                    ? attachFailureMessage(failedFiles, rejectionReason)
                    : current.error,
                pendingCount: Math.max(0, current.pendingCount - 1),
                targetKey: capturedTargetKey,
              }
            : current,
        );
      }
    },
    [projectId, uploadPromptAttachment, startUploads, finishUploads],
  );

  return {
    attachmentError: isCurrentOperation ? operation.error : null,
    setAttachmentError,
    handleAttachFiles,
    isAttachingFiles: isCurrentOperation && operation.pendingCount > 0,
    pendingUploads,
  };
}

export function useComposerAttachmentUploads({
  projectId,
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
    target: { key: "bottom", addAttachment: addDraftAttachment },
  });
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
            key: String(inlineEditSessionId),
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
