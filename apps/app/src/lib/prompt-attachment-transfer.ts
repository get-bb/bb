import type { UploadedPromptAttachment } from "@bb/server-contract";
import type { PromptDraftAttachment } from "./prompt-draft";

export interface TransferredPromptAttachment {
  sourcePath: string;
  sourceProjectId: string;
  targetAttachment: PromptDraftAttachment;
}

export interface FailedPromptAttachmentTransfer {
  attachment: PromptDraftAttachment;
  error: Error;
}

export interface PromptAttachmentTransferResult {
  failedAttachments: FailedPromptAttachmentTransfer[];
  transferredAttachments: TransferredPromptAttachment[];
}

interface TransferPromptAttachmentsArgs {
  attachments: readonly PromptDraftAttachment[];
  targetProjectId: string;
  readAttachment: (args: { path: string; projectId: string }) => Promise<Blob>;
  uploadAttachment: (args: {
    file: File;
    projectId: string;
  }) => Promise<UploadedPromptAttachment>;
}

interface CleanupStalePromptAttachmentCopiesArgs {
  currentAttachments: readonly PromptDraftAttachment[];
  currentProjectId: string;
  deleteAttachment: (args: {
    path: string;
    projectId: string;
  }) => Promise<void>;
  targetProjectId: string;
  transferredAttachments: readonly TransferredPromptAttachment[];
}

export interface CleanupStalePromptAttachmentCopiesResult {
  deletedAttachments: TransferredPromptAttachment[];
  failedAttachments: FailedPromptAttachmentTransfer[];
}

interface ReconcileTransferredPromptAttachmentsArgs {
  currentProjectId: string;
  currentAttachments: readonly PromptDraftAttachment[];
  targetProjectId: string;
  transferredAttachments: readonly TransferredPromptAttachment[];
}

interface HasPromptDraftAttachmentsOutsideProjectArgs {
  attachments: readonly PromptDraftAttachment[];
  projectId: string;
}

export function hasPromptDraftAttachmentsOutsideProject({
  attachments,
  projectId,
}: HasPromptDraftAttachmentsOutsideProjectArgs): boolean {
  return attachments.some(
    (attachment) =>
      attachment.sourceProjectId !== undefined &&
      attachment.sourceProjectId !== projectId,
  );
}

/**
 * Copies project-scoped draft uploads into the newly selected project.
 * Attachments already owned by the destination stay untouched.
 */
export async function transferPromptAttachments({
  attachments,
  targetProjectId,
  readAttachment,
  uploadAttachment,
}: TransferPromptAttachmentsArgs): Promise<PromptAttachmentTransferResult> {
  const attachmentsToTransfer = attachments.filter(
    (attachment) => attachment.sourceProjectId !== targetProjectId,
  );

  const transferredAttachments: TransferredPromptAttachment[] = [];
  const failedAttachments: FailedPromptAttachmentTransfer[] = [];

  // Transfers can include several large files. Keep the network and browser
  // memory footprint bounded, while allowing an earlier failure to leave later
  // attachments eligible for transfer and retry.
  for (const attachment of attachmentsToTransfer) {
    try {
      const sourceProjectId = attachment.sourceProjectId;
      if (!sourceProjectId) {
        throw new Error("Attachment source project is missing");
      }

      const content = await readAttachment({
        projectId: sourceProjectId,
        path: attachment.path,
      });
      const uploaded = await uploadAttachment({
        projectId: targetProjectId,
        file: new File([content], attachment.name, {
          type: attachment.mimeType ?? content.type,
        }),
      });
      transferredAttachments.push({
        sourcePath: attachment.path,
        sourceProjectId,
        targetAttachment: {
          ...uploaded,
          sourceProjectId: targetProjectId,
        },
      });
    } catch (error) {
      failedAttachments.push({
        attachment,
        error:
          error instanceof Error
            ? error
            : new Error("Attachment transfer failed"),
      });
    }
  }

  return { failedAttachments, transferredAttachments };
}

/**
 * Delete destination copies produced by a transfer that finished after the
 * selection moved on. A copy is retained when it is now part of the live draft
 * or when its destination became current again. Cleanup is intentionally
 * sequential for the same bounded-resource behavior as transfer.
 */
export async function cleanupStalePromptAttachmentCopies({
  currentAttachments,
  currentProjectId,
  deleteAttachment,
  targetProjectId,
  transferredAttachments,
}: CleanupStalePromptAttachmentCopiesArgs): Promise<CleanupStalePromptAttachmentCopiesResult> {
  if (currentProjectId === targetProjectId) {
    return { deletedAttachments: [], failedAttachments: [] };
  }

  const liveDestinationPaths = new Set(
    currentAttachments
      .filter((attachment) => attachment.sourceProjectId === targetProjectId)
      .map((attachment) => attachment.path),
  );
  const deletedAttachments: TransferredPromptAttachment[] = [];
  const failedAttachments: FailedPromptAttachmentTransfer[] = [];

  for (const transferredAttachment of transferredAttachments) {
    const targetAttachment = transferredAttachment.targetAttachment;
    if (liveDestinationPaths.has(targetAttachment.path)) {
      continue;
    }

    try {
      await deleteAttachment({
        path: targetAttachment.path,
        projectId: targetProjectId,
      });
      deletedAttachments.push(transferredAttachment);
    } catch (error) {
      failedAttachments.push({
        attachment: targetAttachment,
        error:
          error instanceof Error
            ? error
            : new Error("Stale attachment cleanup failed"),
      });
    }
  }

  return { deletedAttachments, failedAttachments };
}

/**
 * Rebase completed copies onto the live draft so removing or adding another
 * attachment while the network request was pending is never overwritten.
 * A completed copy from an older project selection returns `null` rather than
 * replacing an attachment in the newly selected project.
 */
export function reconcileTransferredPromptAttachments({
  currentProjectId,
  currentAttachments,
  targetProjectId,
  transferredAttachments,
}: ReconcileTransferredPromptAttachmentsArgs): PromptDraftAttachment[] | null {
  if (currentProjectId !== targetProjectId) {
    return null;
  }

  const transferredBySource = new Map(
    transferredAttachments.map((transferred) => [
      `${transferred.sourceProjectId}:${transferred.sourcePath}`,
      transferred.targetAttachment,
    ]),
  );

  return currentAttachments.map((attachment) => {
    const sourceProjectId = attachment.sourceProjectId;
    if (!sourceProjectId) {
      return attachment;
    }
    return (
      transferredBySource.get(`${sourceProjectId}:${attachment.path}`) ??
      attachment
    );
  });
}
