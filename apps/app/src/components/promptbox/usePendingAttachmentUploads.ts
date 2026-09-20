import { useCallback, useState } from "react";

export interface PendingAttachmentUpload {
  id: string;
  file: File;
}

const EMPTY_UPLOADS: readonly PendingAttachmentUpload[] = [];

export function usePendingAttachmentUploads(targetKey: string | null) {
  const [pending, setPending] = useState<{
    targetKey: string | null;
    uploads: PendingAttachmentUpload[];
  }>({ targetKey: null, uploads: [] });

  const startUploads = useCallback((files: File[]) => {
    const uploads = files.map((file) => ({ id: crypto.randomUUID(), file }));
    setPending((current) => ({
      targetKey,
      uploads: [...(current.targetKey === targetKey ? current.uploads : []), ...uploads],
    }));
    return uploads;
  }, [targetKey]);

  const finishUploads = useCallback((uploads: readonly PendingAttachmentUpload[]) => {
    setPending((current) => ({
      ...current,
      uploads: current.uploads.filter((pendingUpload) =>
        !uploads.some((upload) => upload.id === pendingUpload.id)),
    }));
  }, []);

  return {
    pendingUploads: pending.targetKey === targetKey ? pending.uploads : EMPTY_UPLOADS,
    startUploads,
    finishUploads,
  };
}
