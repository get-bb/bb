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
  closeSearch: () => void;
  filteredFiles: readonly WorkspaceFile[];
  isSearchOpen: boolean;
  loadedFiles: readonly WorkspaceFile[];
  openSearch: () => void;
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
  }, []);

  return {
    closeSearch,
    filteredFiles,
    isSearchOpen,
    loadedFiles,
    openSearch,
    searchQuery,
    selectedPath,
    selectPath: onSelectPath,
    setSearchQuery,
  };
}
