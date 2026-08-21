const DEFAULT_THREAD_STORAGE_FILE_LIST_LIMIT = 1000;

export interface ThreadStorageFileListOptions {
  limit: number;
  query: string | null;
}

export const DEFAULT_THREAD_STORAGE_FILE_LIST_OPTIONS: ThreadStorageFileListOptions =
  {
    limit: DEFAULT_THREAD_STORAGE_FILE_LIST_LIMIT,
    query: null,
  };
