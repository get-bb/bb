import { useCallback, useEffect, useState } from "react";
import type { PromptDraftController } from "@/hooks/usePromptDraftStorage";
import { importSharedContent } from "@/lib/shared-content-import";

export function useSharedContentImport(args: {
  shareId: string | null;
  projectId: string | null;
  draft: PromptDraftController;
  onComplete?: () => void;
}) {
  const { shareId, projectId, draft, onComplete } = args;
  const key = `${shareId ?? ""}\0${projectId ?? ""}\0${draft.storageKey}`;
  const [report, setReport] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [retryState, setRetryState] = useState({ key: "", attempt: 0 });
  const attempt = retryState.key === key ? retryState.attempt : 0;
  useEffect(() => {
    if (!shareId || !projectId) return;
    const controller = new AbortController();
    const updateReport = (message: string) => {
      if (!controller.signal.aborted) setReport({ key, message });
    };
    void importSharedContent({
      shareId,
      projectId,
      draft,
      signal: controller.signal,
      onProgress: updateReport,
    })
      .then(() => {
        if (controller.signal.aborted) return;
        setReport(null);
        onComplete?.();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          updateReport(
            error instanceof Error
              ? error.message
              : "Could not import the shared item.",
          );
        }
      });
    return () => controller.abort();
  }, [attempt, draft, key, onComplete, projectId, shareId]);
  const retry = useCallback(
    () => setRetryState({ key, attempt: attempt + 1 }),
    [attempt, key],
  );
  return {
    message:
      shareId && projectId
        ? report?.key === key
          ? report.message
          : "Preparing shared item…"
        : null,
    retry,
  };
}
