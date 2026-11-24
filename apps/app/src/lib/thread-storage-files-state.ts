import { useMemo } from "react";
import type { ExperimentalThreadStorageFilesState } from "@get-bb/plugin-sdk";
import { useThreadStorageFiles } from "@/hooks/queries/thread-panel-queries";
import {
  describeLifecycleError,
  formatLifecycleErrorDescription,
} from "@/lib/lifecycle-errors";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS } from "@/lib/thread-storage-files";

const LOADING: ExperimentalThreadStorageFilesState = {
  status: "loading",
  files: null,
};

function describeStorageError(error: Error): string {
  const lifecycleErrorDescription = describeLifecycleError({
    error,
    operation: "load_thread_storage",
  });
  return (
    (lifecycleErrorDescription
      ? formatLifecycleErrorDescription(lifecycleErrorDescription)
      : null) ??
    getMutationErrorMessage({
      error,
      fallbackMessage: "Failed to load thread storage",
      lifecycleOperation: "load_thread_storage",
    })
  );
}

export function useThreadStorageFilesState(
  threadId: string,
): ExperimentalThreadStorageFilesState {
  const query = useThreadStorageFiles(
    threadId,
    DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
    { enabled: threadId !== "" },
  );
  const data = query.data;
  const error = query.error;
  return useMemo(() => {
    if (data !== undefined) return { status: "ready", files: data.files };
    if (error !== null) {
      return {
        status: "error",
        files: null,
        errorMessage: describeStorageError(error),
      };
    }
    return LOADING;
  }, [data, error]);
}
