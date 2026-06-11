import {
  DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
  type ThreadStorageFileListOptions,
} from "@/lib/thread-storage-files";
import {
  useThreadStorageFilePreview,
  useThreadStorageFiles,
} from "../../hooks/queries/thread-queries";

interface UseThreadStorageViewerParams {
  activePath: string | null;
  fileListEnabled?: boolean;
  fileListOptions?: ThreadStorageFileListOptions;
  filePreviewEnabled?: boolean;
  threadId?: string;
}

export function useThreadStorageViewer({
  activePath,
  fileListEnabled = true,
  fileListOptions = DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS,
  filePreviewEnabled = true,
  threadId,
}: UseThreadStorageViewerParams) {
  const hasThread = Boolean(threadId);
  const {
    data: threadStorageFiles,
    isLoading: isThreadStorageFilesLoading,
    error: threadStorageFilesError,
    refetch: refetchThreadStorageFiles,
  } = useThreadStorageFiles(threadId ?? "", fileListOptions, {
    enabled: hasThread && fileListEnabled,
  });
  const {
    data: threadStorageFilePreview,
    isLoading: isThreadStorageFilePreviewLoading,
    error: threadStorageFilePreviewError,
  } = useThreadStorageFilePreview(threadId ?? "", activePath, {
    enabled: hasThread && filePreviewEnabled && activePath !== null,
  });

  return {
    isThreadStorageFilePreviewLoading,
    isThreadStorageFilesLoading,
    threadStorageFilePreview,
    threadStorageFilePreviewError,
    threadStorageFilesError,
    threadStorageFiles,
    threadStorageRootPath: threadStorageFiles?.storageRootPath ?? null,
    refetchThreadStorageFiles,
  };
}
