import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";
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

interface ShouldLoadThreadStorageFileListArgs {
  hasThread: boolean;
  isSecondaryPanelOpen: boolean;
  secondaryTabs: readonly Pick<FixedPanelTab, "kind">[];
}

/**
 * The thread storage file list (`host.list_files`, up to 1000 rows) only feeds
 * secondary-panel surfaces: the storage browser, storage-tab pruning, and
 * local-file link resolution (which refetches on demand). It therefore loads
 * once the panel is open or a storage tab already exists, not on every thread
 * open, remount, or reconnect.
 */
export function shouldLoadThreadStorageFileList({
  hasThread,
  isSecondaryPanelOpen,
  secondaryTabs,
}: ShouldLoadThreadStorageFileListArgs): boolean {
  if (!hasThread) {
    return false;
  }
  return (
    isSecondaryPanelOpen ||
    secondaryTabs.some((tab) => tab.kind === "thread-storage-file-preview")
  );
}
