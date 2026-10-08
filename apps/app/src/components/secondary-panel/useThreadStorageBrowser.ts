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

export function useThreadStorageBrowser({
  files,
  onSelectPath,
  selectedPath,
  threadId,
}: UseThreadStorageBrowserArgs): ThreadStorageBrowserController {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState(() =>
    ancestorsOf(selectedPath),
  );
  const [foldersShowingAll, setFoldersShowingAll] = useState(() =>
    ancestorsOf(selectedPath),
  );
  const [revealedPath, setRevealedPath] = useState(selectedPath);
  const [lastSelectedPath, setLastSelectedPath] = useState(selectedPath);
  const [folderStateThreadId, setFolderStateThreadId] = useState(threadId);
  if (threadId !== folderStateThreadId) {
    setFolderStateThreadId(threadId);
    setRevealedPath(selectedPath);
    setLastSelectedPath(selectedPath);
    setExpandedFolders(ancestorsOf(selectedPath));
    setFoldersShowingAll(ancestorsOf(selectedPath));
  } else if (selectedPath !== revealedPath) {
    setRevealedPath(selectedPath);
    if (selectedPath !== null) setLastSelectedPath(selectedPath);
    const ancestors = [...ancestorsOf(selectedPath)];
    if (ancestors.some((path) => !expandedFolders.has(path))) {
      setExpandedFolders(new Set([...expandedFolders, ...ancestors]));
    }
    if (ancestors.some((path) => !foldersShowingAll.has(path))) {
      setFoldersShowingAll(new Set([...foldersShowingAll, ...ancestors]));
    }
  }
  const toggleFolder = useCallback((chainPaths: readonly string[]) => {
    const key = chainPaths.at(-1);
    if (key === undefined) return;
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (current.has(key)) {
        for (const path of chainPaths) next.delete(path);
      } else {
        for (const path of chainPaths) next.add(path);
      }
      return next;
    });
  }, []);
  const showAllInFolder = useCallback((folderPath: string) => {
    setFoldersShowingAll((current) => new Set([...current, folderPath]));
  }, []);

  const loadedFiles = files ?? EMPTY_STORAGE_FILES;
  const filteredFiles = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (normalized.length === 0) {
      return loadedFiles;
    }
    return loadedFiles.filter((file) =>
      file.path.toLowerCase().includes(normalized),
    );
  }, [loadedFiles, searchQuery]);

  return {
    expandedFolders,
    toggleFolder,
    foldersShowingAll,
    showAllInFolder,
    lastSelectedPath,
    filteredFiles,
    loadedFiles,
    searchQuery,
    selectedPath,
    selectPath: onSelectPath,
    setSearchQuery,
  };
}
