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

export type PromptAttachmentTransferKeyRegistry = Map<string, Set<string>>;

interface ClaimPromptAttachmentTransfersArgs {
  attachments: readonly PromptDraftAttachment[];
  completedTransfers: PromptAttachmentTransferKeyRegistry;
  failedTransfers: PromptAttachmentTransferKeyRegistry;
  inFlightTransfers: PromptAttachmentTransferKeyRegistry;
  retryFailed: boolean;
  targetProjectId: string;
}

interface PruneCompletedPromptAttachmentTransfersArgs {
  attachments: readonly PromptDraftAttachment[];
  completedTransfers: PromptAttachmentTransferKeyRegistry;
  targetProjectId: string;
}

interface PruneFailedPromptAttachmentTransfersArgs {
  attachments: readonly PromptDraftAttachment[];
  failedTransfers: PromptAttachmentTransferKeyRegistry;
  targetProjectId: string;
}

interface RecordCompletedPromptAttachmentTransfersArgs {
  completedTransfers: PromptAttachmentTransferKeyRegistry;
  targetProjectId: string;
  transferredAttachments: readonly TransferredPromptAttachment[];
}

interface ReleasePromptAttachmentTransfersArgs {
  attachments: readonly PromptDraftAttachment[];
  inFlightTransfers: PromptAttachmentTransferKeyRegistry;
  targetProjectId: string;
}

interface RecordPromptAttachmentTransferFailuresArgs {
  attemptedAttachments: readonly PromptDraftAttachment[];
  failedAttachments: readonly FailedPromptAttachmentTransfer[];
  failedTransfers: PromptAttachmentTransferKeyRegistry;
  targetProjectId: string;
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
  deleteAttachment: (args: {
    path: string;
    projectId: string;
  }) => Promise<void>;
  getCurrentState: () => {
    attachments: readonly PromptDraftAttachment[];
    projectId: string;
  };
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

interface ShouldSchedulePromptAttachmentTransferArgs {
  attachments: readonly PromptDraftAttachment[];
  currentProjectId: string;
  releasedTargetProjectId: string;
}

function promptAttachmentTransferKey(
  attachment: PromptDraftAttachment,
): string | null {
  return attachment.sourceProjectId
    ? `${attachment.sourceProjectId}:${attachment.path}`
    : null;
}

/** Claims destination copies synchronously so concurrent transfer paths dedupe. */
export function claimPromptAttachmentTransfers({
  attachments,
  completedTransfers,
  failedTransfers,
  inFlightTransfers,
  retryFailed,
  targetProjectId,
}: ClaimPromptAttachmentTransfersArgs): PromptDraftAttachment[] {
  let inFlightKeys = inFlightTransfers.get(targetProjectId);
  if (!inFlightKeys) {
    inFlightKeys = new Set();
    inFlightTransfers.set(targetProjectId, inFlightKeys);
  }
  const completedKeys = completedTransfers.get(targetProjectId);
  const failedKeys = failedTransfers.get(targetProjectId);
  const claimed = attachments.filter((attachment) => {
    if (attachment.sourceProjectId === targetProjectId) return false;
    const key = promptAttachmentTransferKey(attachment);
    if (
      key === null ||
      inFlightKeys.has(key) ||
      completedKeys?.has(key) === true ||
      (!retryFailed && failedKeys?.has(key) === true)
    ) {
      return false;
    }
    inFlightKeys.add(key);
    return true;
  });

  if (inFlightKeys.size === 0) {
    inFlightTransfers.delete(targetProjectId);
  }
  return claimed;
}

export function pruneCompletedPromptAttachmentTransfers({
  attachments,
  completedTransfers,
  targetProjectId,
}: PruneCompletedPromptAttachmentTransfersArgs): void {
  const completedKeys = completedTransfers.get(targetProjectId);
  if (!completedKeys) return;
  const liveForeignKeys = new Set(
    attachments.flatMap((attachment) => {
      if (attachment.sourceProjectId === targetProjectId) return [];
      const key = promptAttachmentTransferKey(attachment);
      return key ? [key] : [];
    }),
  );
  for (const key of completedKeys) {
    if (!liveForeignKeys.has(key)) completedKeys.delete(key);
  }
  if (completedKeys.size === 0) {
    completedTransfers.delete(targetProjectId);
  }
}

export function pruneFailedPromptAttachmentTransfers({
  attachments,
  failedTransfers,
  targetProjectId,
}: PruneFailedPromptAttachmentTransfersArgs): void {
  const failedKeys = failedTransfers.get(targetProjectId);
  if (!failedKeys) return;
  const liveForeignKeys = new Set(
    attachments.flatMap((attachment) => {
      if (attachment.sourceProjectId === targetProjectId) return [];
      const key = promptAttachmentTransferKey(attachment);
      return key ? [key] : [];
    }),
  );
  for (const key of failedKeys) {
    if (!liveForeignKeys.has(key)) failedKeys.delete(key);
  }
  if (failedKeys.size === 0) {
    failedTransfers.delete(targetProjectId);
  }
}

export function recordCompletedPromptAttachmentTransfers({
  completedTransfers,
  targetProjectId,
  transferredAttachments,
}: RecordCompletedPromptAttachmentTransfersArgs): void {
  if (transferredAttachments.length === 0) return;
  let completedKeys = completedTransfers.get(targetProjectId);
  if (!completedKeys) {
    completedKeys = new Set();
    completedTransfers.set(targetProjectId, completedKeys);
  }
  for (const transferred of transferredAttachments) {
    completedKeys.add(
      `${transferred.sourceProjectId}:${transferred.sourcePath}`,
    );
  }
}

export function releasePromptAttachmentTransfers({
  attachments,
  inFlightTransfers,
  targetProjectId,
}: ReleasePromptAttachmentTransfersArgs): void {
  const inFlightKeys = inFlightTransfers.get(targetProjectId);
  if (!inFlightKeys) return;
  for (const attachment of attachments) {
    const key = promptAttachmentTransferKey(attachment);
    if (key) inFlightKeys.delete(key);
  }
  if (inFlightKeys.size === 0) {
    inFlightTransfers.delete(targetProjectId);
  }
}

export function recordPromptAttachmentTransferFailures({
  attemptedAttachments,
  failedAttachments,
  failedTransfers,
  targetProjectId,
}: RecordPromptAttachmentTransferFailuresArgs): void {
  let failedKeys = failedTransfers.get(targetProjectId);
  if (!failedKeys) {
    failedKeys = new Set();
    failedTransfers.set(targetProjectId, failedKeys);
  }
  const currentFailureKeys = new Set(
    failedAttachments.flatMap((failure) => {
      const key = promptAttachmentTransferKey(failure.attachment);
      return key ? [key] : [];
    }),
  );
  for (const attachment of attemptedAttachments) {
    const key = promptAttachmentTransferKey(attachment);
    if (!key) continue;
    if (currentFailureKeys.has(key)) {
      failedKeys.add(key);
    } else {
      failedKeys.delete(key);
    }
  }
  if (failedKeys.size === 0) {
    failedTransfers.delete(targetProjectId);
  }
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

export function shouldSchedulePromptAttachmentTransfer({
  attachments,
  currentProjectId,
  releasedTargetProjectId,
}: ShouldSchedulePromptAttachmentTransferArgs): boolean {
  return (
    currentProjectId === releasedTargetProjectId &&
    hasPromptDraftAttachmentsOutsideProject({
      attachments,
      projectId: currentProjectId,
    })
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
  deleteAttachment,
  getCurrentState,
  targetProjectId,
  transferredAttachments,
}: CleanupStalePromptAttachmentCopiesArgs): Promise<CleanupStalePromptAttachmentCopiesResult> {
  const deletedAttachments: TransferredPromptAttachment[] = [];
  const failedAttachments: FailedPromptAttachmentTransfer[] = [];

  for (const transferredAttachment of transferredAttachments) {
    const currentState = getCurrentState();
    if (currentState.projectId === targetProjectId) {
      break;
    }
    const liveDestinationPaths = new Set(
      currentState.attachments
        .filter((attachment) => attachment.sourceProjectId === targetProjectId)
        .map((attachment) => attachment.path),
    );
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
