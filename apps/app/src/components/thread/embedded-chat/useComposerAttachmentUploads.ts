import { useCallback, useRef, useState } from "react";
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
  bottomAttachmentError: string | null;
  setBottomAttachmentError: (error: string | null) => void;
  handleAttachBottomFiles: (files: File[]) => Promise<void>;
  isAttachingBottomFiles: boolean;
  inlineAttachmentError: string | null;
  setInlineAttachmentError: (error: string | null) => void;
  handleAttachInlineFiles: (files: File[]) => Promise<void>;
  isAttachingInlineFiles: boolean;
}

interface AttachmentOperationState {
  error: string | null;
  pendingCount: number;
}

export interface DraftAttachmentUploadTarget {
  /** Changes whenever a newly mounted draft must not receive older uploads. */
  key: string;
  addAttachment: (attachment: PromptDraftAttachment) => void;
}

interface UseDraftAttachmentUploadsArgs {
  projectId: string;
  target: DraftAttachmentUploadTarget | null;
}

export interface UseDraftAttachmentUploadsResult {
  attachmentError: string | null;
  setAttachmentError: (error: string | null) => void;
  handleAttachFiles: (files: File[]) => Promise<void>;
  isAttachingFiles: boolean;
}

interface DraftAttachmentOperationState extends AttachmentOperationState {
  targetKey: string | null;
}

interface InlineAttachmentOperationState extends AttachmentOperationState {
  editSessionId: number | null;
}

/** Upload state for one independently mounted composer draft. */
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
      const failedFiles: string[] = [];
      try {
        for (const file of files) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file,
            });
            const currentTarget = targetRef.current;
            if (currentTarget?.key === capturedTargetKey) {
              currentTarget.addAttachment(uploaded);
            }
          } catch {
            failedFiles.push(file.name);
          }
        }
      } finally {
        setOperation((current) =>
          current.targetKey === capturedTargetKey
            ? {
                error:
                  failedFiles.length > 0 &&
                  targetRef.current?.key === capturedTargetKey
                    ? `Failed to attach: ${failedFiles.join(", ")}`
                    : current.error,
                pendingCount: Math.max(0, current.pendingCount - 1),
                targetKey: capturedTargetKey,
              }
            : current,
        );
      }
    },
    [projectId, uploadPromptAttachment],
  );

  return {
    attachmentError: isCurrentOperation ? operation.error : null,
    setAttachmentError,
    handleAttachFiles,
    isAttachingFiles: isCurrentOperation && operation.pendingCount > 0,
  };
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
  const {
    attachmentError: bottomAttachmentError,
    setAttachmentError: setBottomAttachmentError,
    handleAttachFiles: handleAttachBottomFiles,
    isAttachingFiles: isAttachingBottomFiles,
  } = useDraftAttachmentUploads({
    projectId,
    target: { key: "bottom", addAttachment: addDraftAttachment },
  });
  const [inlineOperation, setInlineOperation] =
    useState<InlineAttachmentOperationState>({
      editSessionId: null,
      error: null,
      pendingCount: 0,
    });

  const setInlineAttachmentError = useCallback(
    (error: string | null) => {
      const editSessionId = inlineEditingQueuedMessage?.editSessionId ?? null;
      setInlineOperation((current) => ({
        editSessionId,
        error,
        pendingCount:
          current.editSessionId === editSessionId ? current.pendingCount : 0,
      }));
    },
    [inlineEditingQueuedMessage?.editSessionId],
  );

  const handleAttachInlineFiles = useCallback(
    async (files: File[]) => {
      if (!inlineEditingQueuedMessage || files.length === 0) return;
      const { editSessionId, ownerThreadId, queuedMessageId } =
        inlineEditingQueuedMessage;
      setInlineOperation((current) => ({
        editSessionId,
        error: null,
        pendingCount:
          current.editSessionId === editSessionId
            ? current.pendingCount + 1
            : 1,
      }));
      const failedFiles: string[] = [];
      try {
        for (const file of files) {
          try {
            const uploaded = await uploadPromptAttachment.mutateAsync({
              projectId,
              file,
            });
            const current = inlineEditingQueuedMessageRef.current;
            if (
              current?.editSessionId === editSessionId &&
              current.ownerThreadId === ownerThreadId &&
              current.queuedMessageId === queuedMessageId &&
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
          } catch {
            failedFiles.push(file.name);
          }
        }
      } finally {
        setInlineOperation((current) =>
          current.editSessionId === editSessionId
            ? {
                editSessionId,
                error:
                  failedFiles.length > 0 &&
                  inlineEditingQueuedMessageRef.current?.editSessionId ===
                    editSessionId
                    ? `Failed to attach: ${failedFiles.join(", ")}`
                    : current.error,
                pendingCount: Math.max(0, current.pendingCount - 1),
              }
            : current,
        );
      }
    },
    [
      commitInlineQueuedMessage,
      inlineEditingQueuedMessage,
      inlineEditingQueuedMessageRef,
      projectId,
      uploadPromptAttachment,
    ],
  );

  const currentInlineEditSessionId =
    inlineEditingQueuedMessage?.editSessionId ?? null;
  const isCurrentInlineOperation =
    inlineOperation.editSessionId === currentInlineEditSessionId;

  return {
    bottomAttachmentError,
    setBottomAttachmentError,
    handleAttachBottomFiles,
    isAttachingBottomFiles,
    inlineAttachmentError: isCurrentInlineOperation
      ? inlineOperation.error
      : null,
    setInlineAttachmentError,
    handleAttachInlineFiles,
    isAttachingInlineFiles:
      isCurrentInlineOperation && inlineOperation.pendingCount > 0,
  };
}
