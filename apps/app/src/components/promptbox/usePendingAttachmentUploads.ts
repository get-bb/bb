import { useCallback, useSyncExternalStore } from "react";
import { nanoid } from "nanoid";

export interface PendingAttachmentUpload {
  id: string;
  file: File;
}

const EMPTY_UPLOADS: readonly PendingAttachmentUpload[] = [];
const pendingUploadsByTarget = new Map<
  string,
  readonly PendingAttachmentUpload[]
>();
const pendingUploadListeners = new Map<string, Set<() => void>>();

export function createPendingAttachmentUploads(
  files: readonly File[],
): PendingAttachmentUpload[] {
  return files.map((file) => ({ id: nanoid(), file }));
}

export function readPendingAttachmentUploads(
  targetKey: string | null,
): readonly PendingAttachmentUpload[] {
  if (targetKey === null) return EMPTY_UPLOADS;
  return pendingUploadsByTarget.get(targetKey) ?? EMPTY_UPLOADS;
}

function writePendingAttachmentUploads(
  targetKey: string,
  uploads: readonly PendingAttachmentUpload[],
): void {
  if (uploads.length === 0) pendingUploadsByTarget.delete(targetKey);
  else pendingUploadsByTarget.set(targetKey, uploads);
  for (const listener of pendingUploadListeners.get(targetKey) ?? []) {
    listener();
  }
}

export function startPendingAttachmentUploads(
  targetKey: string,
  files: readonly File[],
): PendingAttachmentUpload[] {
  const uploads = createPendingAttachmentUploads(files);
  writePendingAttachmentUploads(targetKey, [
    ...readPendingAttachmentUploads(targetKey),
    ...uploads,
  ]);
  return uploads;
}

export function finishPendingAttachmentUploads(
  uploads: readonly PendingAttachmentUpload[],
): void {
  const finishedIds = new Set(uploads.map((upload) => upload.id));
  for (const [targetKey, pending] of [...pendingUploadsByTarget]) {
    const remaining = pending.filter((upload) => !finishedIds.has(upload.id));
    if (remaining.length !== pending.length) {
      writePendingAttachmentUploads(targetKey, remaining);
    }
  }
}

function subscribePendingAttachmentUploads(
  targetKey: string | null,
  listener: () => void,
): () => void {
  if (targetKey === null) return () => {};
  let listeners = pendingUploadListeners.get(targetKey);
  if (!listeners) {
    listeners = new Set();
    pendingUploadListeners.set(targetKey, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) pendingUploadListeners.delete(targetKey);
  };
}

export function usePendingAttachmentUploads(targetKey: string | null) {
  const pendingUploads = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        subscribePendingAttachmentUploads(targetKey, listener),
      [targetKey],
    ),
    () => readPendingAttachmentUploads(targetKey),
    () => EMPTY_UPLOADS,
  );

  const startUploads = useCallback(
    (files: File[]) =>
      targetKey === null
        ? createPendingAttachmentUploads(files)
        : startPendingAttachmentUploads(targetKey, files),
    [targetKey],
  );

  return {
    pendingUploads,
    startUploads,
    finishUploads: finishPendingAttachmentUploads,
  };
}
