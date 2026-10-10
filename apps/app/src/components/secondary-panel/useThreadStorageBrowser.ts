import { useCallback, useMemo, useState } from "react";
import type { WorkspaceFile } from "@bb/server-contract";
import { threadStorageAncestorPaths } from "./info/thread-storage-tree";

const EMPTY_STORAGE_FILES: readonly WorkspaceFile[] = [];

export type ThreadStoragePathSelectHandler = (path: string) => void;

interface UseThreadStorageBrowserArgs {
  files: readonly WorkspaceFile[] | undefined;
  onSelectPath: ThreadStoragePathSelectHandler;
  selectedPath: string | null;
  threadId: string;
}

export interface ThreadStorageBrowserController {
  expandedFolders: ReadonlySet<string>;
  toggleFolder: (chainPaths: readonly string[]) => void;
  foldersShowingAll: ReadonlySet<string>;
  showAllInFolder: (folderPath: string) => void;
  lastSelectedPath: string | null;
  filteredFiles: readonly WorkspaceFile[];
  loadedFiles: readonly WorkspaceFile[];
  searchQuery: string;
  selectedPath: string | null;
  selectPath: ThreadStoragePathSelectHandler;
  setSearchQuery: (query: string) => void;
}

function ancestorsOf(path: string | null): ReadonlySet<string> {
  return new Set(path ? threadStorageAncestorPaths(path) : []);
}

function withPaths(
  folders: ReadonlySet<string>,
  paths: readonly string[],
): ReadonlySet<string> {
  return paths.every((path) => folders.has(path))
    ? folders
    : new Set([...folders, ...paths]);
}

export interface ThreadStorageFolderState {
  expandedFolders: ReadonlySet<string>;
  foldersShowingAll: ReadonlySet<string>;
  lastSelectedPath: string | null;
  revealedPath: string | null;
  threadId: string;
}

export function initialThreadStorageFolderState(
  threadId: string,
  selectedPath: string | null,
): ThreadStorageFolderState {
  return {
    expandedFolders: ancestorsOf(selectedPath),
    foldersShowingAll: ancestorsOf(selectedPath),
    lastSelectedPath: selectedPath,
    revealedPath: selectedPath,
    threadId,
  };
}

export function syncThreadStorageFolderState(
  state: ThreadStorageFolderState,
  { selectedPath, threadId }: { selectedPath: string | null; threadId: string },
): ThreadStorageFolderState {
  if (threadId !== state.threadId) {
    return initialThreadStorageFolderState(threadId, selectedPath);
  }
  if (selectedPath === state.revealedPath) {
    return state;
  }
  const ancestors = [...ancestorsOf(selectedPath)];
  return {
    expandedFolders: withPaths(state.expandedFolders, ancestors),
    foldersShowingAll: withPaths(state.foldersShowingAll, ancestors),
    lastSelectedPath: selectedPath ?? state.lastSelectedPath,
    revealedPath: selectedPath,
    threadId,
  };
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
  files: readonly WorkspaceFile[],
  searchQuery: string,
): readonly WorkspaceFile[] {
  const normalized = searchQuery.trim().toLowerCase();
  if (normalized.length === 0) {
    return files;
  }
  return files.filter((file) => file.path.toLowerCase().includes(normalized));
}

export function useThreadStorageBrowser({
  files,
  onSelectPath,
  selectedPath,
  threadId,
}: UseThreadStorageBrowserArgs): ThreadStorageBrowserController {
  const [searchQuery, setSearchQuery] = useState("");
  const [folderState, setFolderState] = useState(() =>
    initialThreadStorageFolderState(threadId, selectedPath),
  );
  const syncedFolderState = syncThreadStorageFolderState(folderState, {
    selectedPath,
    threadId,
  });
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
    lastSelectedPath: syncedFolderState.lastSelectedPath,
    filteredFiles,
    loadedFiles,
    searchQuery,
    selectedPath,
    selectPath: onSelectPath,
    setSearchQuery,
  };
}
