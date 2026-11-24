import { useCallback, useMemo, useState } from "react";
import type { ThreadStorageFileEntry } from "./thread-storage-tree";

const EMPTY_STORAGE_FILES: readonly ThreadStorageFileEntry[] = [];

export type ThreadStoragePathSelectHandler = (path: string) => void;

interface UseThreadStorageBrowserArgs {
  files: readonly ThreadStorageFileEntry[] | undefined;
  onSelectPath: ThreadStoragePathSelectHandler;
  threadId: string;
}

export interface ThreadStorageBrowserController {
  expandedFolders: ReadonlySet<string>;
  toggleFolder: (chainPaths: readonly string[]) => void;
  foldersShowingAll: ReadonlySet<string>;
  showAllInFolder: (folderPath: string) => void;
  filteredFiles: readonly ThreadStorageFileEntry[];
  loadedFiles: readonly ThreadStorageFileEntry[];
  searchQuery: string;
  selectPath: ThreadStoragePathSelectHandler;
  setSearchQuery: (query: string) => void;
}

export interface ThreadStorageFolderState {
  expandedFolders: ReadonlySet<string>;
  foldersShowingAll: ReadonlySet<string>;
  threadId: string;
}

export function initialThreadStorageFolderState(
  threadId: string,
): ThreadStorageFolderState {
  return {
    expandedFolders: new Set(),
    foldersShowingAll: new Set(),
    threadId,
  };
}

export function syncThreadStorageFolderState(
  state: ThreadStorageFolderState,
  threadId: string,
): ThreadStorageFolderState {
  return state.threadId === threadId
    ? state
    : initialThreadStorageFolderState(threadId);
}

export function toggleThreadStorageFolderChain(
  expandedFolders: ReadonlySet<string>,
  chainPaths: readonly string[],
): ReadonlySet<string> {
  const key = chainPaths.at(-1);
  if (key === undefined) return expandedFolders;
  const next = new Set(expandedFolders);
  if (expandedFolders.has(key)) {
    for (const path of chainPaths) next.delete(path);
  } else {
    for (const path of chainPaths) next.add(path);
  }
  return next;
}

export function filterThreadStorageFiles(
  files: readonly ThreadStorageFileEntry[],
  searchQuery: string,
): readonly ThreadStorageFileEntry[] {
  const normalized = searchQuery.trim().toLowerCase();
  if (normalized.length === 0) {
    return files;
  }
  return files.filter((file) => file.path.toLowerCase().includes(normalized));
}

export function useThreadStorageBrowser({
  files,
  onSelectPath,
  threadId,
}: UseThreadStorageBrowserArgs): ThreadStorageBrowserController {
  const [searchQuery, setSearchQuery] = useState("");
  const [folderState, setFolderState] = useState(() =>
    initialThreadStorageFolderState(threadId),
  );
  const syncedFolderState = syncThreadStorageFolderState(folderState, threadId);
  if (syncedFolderState !== folderState) {
    setFolderState(syncedFolderState);
  }
  const toggleFolder = useCallback((chainPaths: readonly string[]) => {
    if (chainPaths.length === 0) return;
    setFolderState((current) => {
      const expandedFolders = toggleThreadStorageFolderChain(
        current.expandedFolders,
        chainPaths,
      );
      return expandedFolders === current.expandedFolders
        ? current
        : { ...current, expandedFolders };
    });
  }, []);
  const showAllInFolder = useCallback((folderPath: string) => {
    setFolderState((current) => ({
      ...current,
      foldersShowingAll: new Set([...current.foldersShowingAll, folderPath]),
    }));
  }, []);

  const loadedFiles = files ?? EMPTY_STORAGE_FILES;
  const filteredFiles = useMemo(
    () => filterThreadStorageFiles(loadedFiles, searchQuery),
    [loadedFiles, searchQuery],
  );

  return {
    expandedFolders: syncedFolderState.expandedFolders,
    toggleFolder,
    foldersShowingAll: syncedFolderState.foldersShowingAll,
    showAllInFolder,
    filteredFiles,
    loadedFiles,
    searchQuery,
    selectPath: onSelectPath,
    setSearchQuery,
  };
}
