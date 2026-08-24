import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { WorkspaceFile } from "@bb/server-contract";
import { createRetryingModuleLoader } from "@/lib/plugin-frontend-lazy";
// Type-only: the runtime edge to `@pierre/trees` is the dynamic `import()`
// below, so the tree library stays out of the thread route's static closure
// (bundle-budget.json forbids it there).
import type { ThreadStorageTreeModel } from "./ThreadStorageFileTree";

const EMPTY_STORAGE_FILES: readonly WorkspaceFile[] = [];

type ThreadStorageFileTreeModule = typeof import("./ThreadStorageFileTree");

/**
 * Loads the tree chunk once and re-tries after a failed fetch, so a flaky
 * network cannot leave the storage browser without a tree for good.
 */
const loadThreadStorageFileTree =
  createRetryingModuleLoader<ThreadStorageFileTreeModule>(
    () => import("./ThreadStorageFileTree"),
  );

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
  /** `null` until the lazily loaded tree chunk has created the model. */
  model: ThreadStorageTreeModel | null;
  openSearch: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

function buildDirectoryPaths(paths: readonly string[]): string[] {
  const directoryPaths = new Set<string>();

  for (const path of paths) {
    const segments = path.split("/").filter((segment) => segment.length > 0);
    let currentPath = "";

    for (const segment of segments.slice(0, -1)) {
      currentPath = `${currentPath}${segment}/`;
      directoryPaths.add(currentPath);
    }
  }

  return Array.from(directoryPaths);
}

/**
 * Owns the thread storage browser's tree model and related UI state.
 *
 * The tree model is destroyed when this hook's owner unmounts
 * (`model.cleanUp()` unsubscribes the selection listener and destroys the
 * controller — see render/FileTree.ts in pierrecomputer/pierre). The storage
 * tab content unmounts whenever a file tab covers it, so this hook must live
 * in a parent that survives that toggle (e.g., ThreadDetailView), with the
 * model and search state passed down to the presentational browser.
 *
 * The model arrives asynchronously: the tree chunk is imported on demand,
 * and only once there are files to show (with no files the browser
 * renders an empty state and never mounts a tree). `model` is `null` until
 * then and the sync effects below wait for it.
 */
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
  const filePaths = useMemo(
    () => filteredFiles.map((file) => file.path),
    [filteredFiles],
  );
  const filePathSet = useMemo(() => new Set(filePaths), [filePaths]);
  const filePathSetRef = useRef<ReadonlySet<string>>(filePathSet);
  const onSelectPathRef = useRef(onSelectPath);
  // Pierre tree's item.select() is additive (selectPath, not selectOnlyPath),
  // so reconciling React state into the tree requires deselect+select pairs
  // that re-emit onSelectionChange. Suppress those echoes here so they don't
  // bounce back through onSelectPath and revert the caller's state.
  const isApplyingSelectionRef = useRef(false);

  useEffect(() => {
    filePathSetRef.current = filePathSet;
  }, [filePathSet]);

  useEffect(() => {
    onSelectPathRef.current = onSelectPath;
  }, [onSelectPath]);

  const handleTreeSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      if (isApplyingSelectionRef.current) return;
      const nextPath = selectedPaths[0];
      if (!nextPath || !filePathSetRef.current.has(nextPath)) {
        return;
      }
      onSelectPathRef.current(nextPath);
    },
    [],
  );

  const [model, setModel] = useState<ThreadStorageTreeModel | null>(null);
  const shouldLoadTree = loadedFiles.length > 0;
  useEffect(() => {
    if (!shouldLoadTree) return;
    let cancelled = false;
    let createdModel: ThreadStorageTreeModel | null = null;
    void loadThreadStorageFileTree().then(
      ({ createThreadStorageTreeModel }) => {
        if (cancelled) return;
        createdModel = createThreadStorageTreeModel(handleTreeSelectionChange);
        setModel(createdModel);
      },
      (error: unknown) => {
        if (cancelled) return;
        console.warn(
          `thread storage tree load failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    return () => {
      cancelled = true;
      createdModel?.cleanUp();
      setModel(null);
    };
  }, [handleTreeSelectionChange, shouldLoadTree]);

  const isSearching = searchQuery.trim().length > 0;
  const expandedDirectoryPaths = useMemo(
    () => (isSearching ? buildDirectoryPaths(filePaths) : []),
    [isSearching, filePaths],
  );
  useEffect(() => {
    if (model === null) return;
    model.resetPaths(filePaths, {
      initialExpandedPaths: expandedDirectoryPaths,
    });
  }, [expandedDirectoryPaths, filePaths, model]);

  useEffect(() => {
    if (model === null) return;
    const currentSelectedPaths = model.getSelectedPaths();
    const selectedPathIsVisible =
      selectedPath !== null && filePathSet.has(selectedPath);

    const alreadyMatches =
      selectedPathIsVisible
        ? currentSelectedPaths.length === 1 &&
          currentSelectedPaths[0] === selectedPath
        : currentSelectedPaths.length === 0;
    if (alreadyMatches) return;

    isApplyingSelectionRef.current = true;
    try {
      for (const path of currentSelectedPaths) {
        if (selectedPathIsVisible && path === selectedPath) continue;
        model.getItem(path)?.deselect();
      }
      if (selectedPathIsVisible) {
        model.getItem(selectedPath)?.select();
      }
    } finally {
      isApplyingSelectionRef.current = false;
    }
  }, [filePathSet, model, selectedPath]);

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
    model,
    openSearch,
    searchQuery,
    setSearchQuery,
  };
}
