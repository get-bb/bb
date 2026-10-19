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

interface UseDraftAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachFiles: (files: File[]) => Promise<PromptDraftAttachment[]>;
  isAttachingFiles: boolean;
  pendingUploads: readonly PendingAttachmentUpload[];
}

export interface DraftAttachmentOperationState {
  error: string | null;
  pendingCount: number;
  targetKey: string | null;
}

export const IDLE_DRAFT_ATTACHMENT_OPERATION: DraftAttachmentOperationState = {
  error: null,
  pendingCount: 0,
  targetKey: null,
};

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

export function beginDraftAttachmentOperation(
  current: DraftAttachmentOperationState,
  targetKey: string,
): DraftAttachmentOperationState {
  return {
    error: null,
    pendingCount:
      current.targetKey === targetKey ? current.pendingCount + 1 : 1,
    targetKey,
  };
}

export function setDraftAttachmentOperationError(
  current: DraftAttachmentOperationState,
  targetKey: string | null,
  error: string | null,
): DraftAttachmentOperationState {
  return {
    error,
    pendingCount: current.targetKey === targetKey ? current.pendingCount : 0,
    targetKey,
  };
}

export function finishDraftAttachmentOperation(
  current: DraftAttachmentOperationState,
  targetKey: string,
  failureMessage: string | null,
  currentTargetKey: string | null,
): DraftAttachmentOperationState {
  if (current.targetKey !== targetKey) return current;
  return {
    error:
      failureMessage !== null && currentTargetKey === targetKey
        ? failureMessage
        : current.error,
    pendingCount: Math.max(0, current.pendingCount - 1),
    targetKey,
  };
}

export function viewDraftAttachmentOperation(
  operation: DraftAttachmentOperationState,
  targetKey: string | null,
): { attachmentError: string | null; isAttachingFiles: boolean } {
  const isCurrentOperation = operation.targetKey === targetKey;
  return {
    attachmentError: isCurrentOperation ? operation.error : null,
    isAttachingFiles: isCurrentOperation && operation.pendingCount > 0,
  };
}

export async function uploadDraftAttachments({
  uploads,
  targetKey,
  upload,
  getCurrentTarget,
  onUploadSettled,
}: {
  uploads: readonly PendingAttachmentUpload[];
  targetKey: string;
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
      const currentTarget = getCurrentTarget();
      if (currentTarget?.key === targetKey) {
        currentTarget.addAttachment(uploaded);
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
  const [operation, setOperation] = useState<DraftAttachmentOperationState>(
    IDLE_DRAFT_ATTACHMENT_OPERATION,
  );
  const targetKey = target?.key ?? null;
  const { pendingUploads, startUploads, finishUploads } =
    usePendingAttachmentUploads(
      targetKey === null ? null : `${projectId}\0${targetKey}`,
    );

  const setAttachmentError = useCallback(
    (error: string | null) => {
      setOperation((current) =>
        setDraftAttachmentOperationError(current, targetKey, error),
      );
    },
    [targetKey],
  );
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      const activeTarget = targetRef.current;
      if (!activeTarget || files.length === 0) return [];
      const capturedTargetKey = activeTarget.key;
      setOperation((current) =>
        beginDraftAttachmentOperation(current, capturedTargetKey),
      );
      const uploads = startUploads(files);
      let failureMessage: string | null = null;
      try {
        const result = await uploadDraftAttachments({
          uploads,
          targetKey: capturedTargetKey,
          upload: (file) =>
            uploadPromptAttachment.mutateAsync({ projectId, file }),
          getCurrentTarget: () => targetRef.current,
          onUploadSettled: (upload) => finishUploads([upload]),
        });
        failureMessage = result.failureMessage;
        return result.added;
      } finally {
        setOperation((current) =>
          finishDraftAttachmentOperation(
            current,
            capturedTargetKey,
            failureMessage,
            targetRef.current?.key ?? null,
          ),
        );
      }
    },
    [projectId, uploadPromptAttachment, startUploads, finishUploads],
  );

  return {
    ...viewDraftAttachmentOperation(operation, targetKey),
    setAttachmentError,
    handleAttachFiles,
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
