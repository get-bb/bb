import { useCallback, useMemo, useState } from "react";
import type { WorkspaceFile } from "@bb/server-contract";

const EMPTY_STORAGE_FILES: readonly WorkspaceFile[] = [];

export type ThreadStoragePathSelectHandler = (path: string) => void;

interface UseThreadStorageBrowserArgs {
  files: readonly WorkspaceFile[] | undefined;
  onSelectPath: ThreadStoragePathSelectHandler;
  selectedPath: string | null;
}

export interface ThreadStorageBrowserController {
  expandedFolders: ReadonlySet<string>;
  toggleFolder: (folderPath: string) => void;
  filteredFiles: readonly WorkspaceFile[];
  loadedFiles: readonly WorkspaceFile[];
  searchQuery: string;
  selectedPath: string | null;
  selectPath: ThreadStoragePathSelectHandler;
  setSearchQuery: (query: string) => void;
}

export function useThreadStorageBrowser({
  files,
  onSelectPath,
  selectedPath,
}: UseThreadStorageBrowserArgs): ThreadStorageBrowserController {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
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
    filteredFiles,
    loadedFiles,
    searchQuery,
    selectedPath,
    selectPath: onSelectPath,
    setSearchQuery,
  };
}
