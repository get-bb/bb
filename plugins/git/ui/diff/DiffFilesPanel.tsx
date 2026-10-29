import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { experimental_useCanOpenFileExternally as useCanOpenFileExternally } from "@get-bb/plugin-sdk/app";
import type { DiffPresentation } from "@bb/shared-ui/git-diff/renderers";
import type { RequestDiffFileContents } from "@bb/shared-ui/git-diff/card-body";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  DiffFileEntry,
  DiffPatchEntry,
  WorkspaceDiffTarget,
} from "../../contract.js";
import { type DiffFileFilters, filterDiffFiles } from "./diff-file-filters.js";
import {
  type DiffPatchState,
  useDiffPatchStates,
  useDiffViewedRevisions,
  useSetDiffFileViewed,
} from "./diff-data.js";
import { DiffFileCard } from "./DiffFileCard.js";
import {
  type DiffFileCardUiState,
  estimateCardHeight,
  readDiffFileCardState,
  resolveCardCollapsed,
  resolveDiffFileCardInitialState,
  useDiffFileCardStates,
  writeDiffFileCardStates,
} from "./diffFilesStore.js";

const DIFF_FILES_OVERSCAN = 4;
const DIFF_FILES_GAP_PX = 8;
const DIFF_FILES_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto";

interface DiffFilesPanelProps {
  environmentId: string;
  target: WorkspaceDiffTarget;
  diffIdentity: string;
  files: readonly DiffFileEntry[];
  fileFilter: string;
  filters: DiffFileFilters;
  initialPatches: readonly DiffPatchEntry[];
  presentation: DiffPresentation;
  ignoreWhitespace: boolean;
  isPlaceholder: boolean;
  isLive: boolean;
  filePathRoot?: string | null;
  scrollToPath?: string | null;
  onScrolledToPath?: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
}

export function DiffFilesPanel({
  environmentId,
  target,
  diffIdentity,
  files,
  fileFilter,
  filters,
  initialPatches,
  presentation,
  ignoreWhitespace,
  isPlaceholder,
  isLive,
  filePathRoot,
  scrollToPath,
  onScrolledToPath,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFilesPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const { viewedRevisionByPath, isLoaded: isViewedLoaded } =
    useDiffViewedRevisions({ environmentId, target, paths, enabled: isLive });

  useEffect(() => {
    if (!isViewedLoaded) return;
    const updates: [string, DiffFileCardUiState][] = [];
    for (const entry of files) {
      const current =
        readDiffFileCardState(diffIdentity, entry.path) ??
        resolveDiffFileCardInitialState({ entry, fileCount: files.length });
      const viewedRevision =
        viewedRevisionByPath.get(entry.path) === entry.revision
          ? entry.revision
          : null;
      if (current.viewedRevision !== viewedRevision) {
        updates.push([
          entry.path,
          {
            collapsed:
              viewedRevision !== null
                ? true
                : current.viewedRevision !== entry.revision
                  ? false
                  : current.collapsed,
            viewedRevision,
          },
        ]);
      }
    }
    writeDiffFileCardStates(diffIdentity, updates);
  }, [diffIdentity, files, isViewedLoaded, viewedRevisionByPath]);

  const setViewed = useSetDiffFileViewed({ environmentId, target, paths });

  const visibleFiles = useMemo(
    () => filterDiffFiles(files, fileFilter, filters, viewedRevisionByPath),
    [files, fileFilter, filters, viewedRevisionByPath],
  );

  const cardStates = useDiffFileCardStates(diffIdentity);
  const isCardCollapsed = (entry: DiffFileEntry) =>
    resolveCardCollapsed(
      cardStates.get(entry.path) ?? null,
      entry,
      files.length,
    );

  const virtualizer = useVirtualizer({
    count: visibleFiles.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const entry = visibleFiles[index];
      if (!entry) {
        return 0;
      }
      return (
        estimateCardHeight({ entry, collapsed: isCardCollapsed(entry) }) +
        DIFF_FILES_GAP_PX
      );
    },
    getItemKey: (index) => {
      const entry = visibleFiles[index];
      if (!entry) {
        return index;
      }
      return `${isCardCollapsed(entry) ? "collapsed" : "expanded"}:${entry.path}`;
    },
    overscan: DIFF_FILES_OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { startIndex, endIndex } = virtualizer.range ?? {
    startIndex: 0,
    endIndex: -1,
  };
  const visible: string[] = [];
  const overscan: string[] = [];
  for (const item of virtualItems) {
    const entry = visibleFiles[item.index];
    if (!entry || entry.loadMode !== "auto") {
      continue;
    }
    if (item.index >= startIndex && item.index <= endIndex) {
      visible.push(entry.path);
    } else {
      overscan.push(entry.path);
    }
  }
  const requestKey = [...visible, ...overscan].join("\n");
  const requestedPaths = useMemo(
    () => (requestKey === "" ? [] : requestKey.split("\n")),
    [requestKey],
  );

  const { getPatchState, loadPath, retry } = useDiffPatchStates({
    environmentId,
    target,
    ignoreWhitespace,
    files,
    initialPatches,
    requestedPaths,
    enabled: isLive,
  });

  useEffect(() => {
    if (!scrollToPath || isPlaceholder) {
      return;
    }
    const index = visibleFiles.findIndex((file) => file.path === scrollToPath);
    if (index < 0) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "start" });
    onScrolledToPath?.();
  }, [isPlaceholder, scrollToPath, visibleFiles, virtualizer, onScrolledToPath]);

  if (visibleFiles.length === 0) {
    return (
      <div className={cn(DIFF_FILES_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
        <EmptyStatePanel className="rounded-lg">
          No changed files match the current filters.
        </EmptyStatePanel>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className={cn(DIFF_FILES_SCROLL_SLOT_CLASS, "px-4 pb-3")}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => {
          const entry = visibleFiles[item.index];
          if (!entry) {
            return null;
          }
          return (
            <div
              key={entry.path}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 w-full"
              style={{
                top: item.start,
                paddingBottom: DIFF_FILES_GAP_PX,
              }}
            >
              <DiffFileRow
                environmentId={environmentId}
                entry={entry}
                diffIdentity={diffIdentity}
                fileCount={files.length}
                collapsed={isCardCollapsed(entry)}
                presentation={presentation}
                ignoreWhitespace={ignoreWhitespace}
                isViewed={
                  viewedRevisionByPath.get(entry.path) === entry.revision
                }
                isViewedDisabled={!isViewedLoaded}
                setViewed={setViewed}
                filePathRoot={filePathRoot}
                patchState={getPatchState(entry.path)}
                loadPath={loadPath}
                retry={retry}
                onOpenFileInEditor={onOpenFileInEditor}
                onOpenFilePreview={onOpenFilePreview}
                onRequestFileContents={onRequestFileContents}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DiffFileRowProps {
  environmentId: string;
  entry: DiffFileEntry;
  diffIdentity: string;
  fileCount: number;
  collapsed: boolean;
  presentation: DiffPresentation;
  ignoreWhitespace: boolean;
  isViewed: boolean;
  isViewedDisabled: boolean;
  setViewed: (entry: DiffFileEntry, viewed: boolean) => void;
  filePathRoot?: string | null;
  patchState: DiffPatchState;
  loadPath: (path: string) => void;
  retry: (path: string) => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
}

function DiffFileRow({
  environmentId,
  entry,
  diffIdentity,
  fileCount,
  collapsed,
  presentation,
  ignoreWhitespace,
  isViewed,
  isViewedDisabled,
  setViewed,
  filePathRoot,
  patchState,
  loadPath,
  retry,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFileRowProps) {
  const canOpenFileExternally = useCanOpenFileExternally({
    kind: "workspace",
    environmentId,
    path: entry.path,
  });

  const handleToggleCollapsed = useCallback(() => {
    const current =
      readDiffFileCardState(diffIdentity, entry.path) ??
      resolveDiffFileCardInitialState({ entry, fileCount });
    writeDiffFileCardStates(diffIdentity, [
      [entry.path, { ...current, collapsed: !current.collapsed }],
    ]);
  }, [diffIdentity, entry, fileCount]);

  const handleLoadPatch = useCallback(() => {
    loadPath(entry.path);
  }, [entry.path, loadPath]);

  const handleRetry = useCallback(() => {
    retry(entry.path);
  }, [entry.path, retry]);

  const handleViewedChange = useCallback(
    (viewed: boolean) => setViewed(entry, viewed),
    [entry, setViewed],
  );

  return (
    <DiffFileCard
      entry={entry}
      presentation={presentation}
      ignoreWhitespace={ignoreWhitespace}
      isViewed={isViewed}
      isViewedDisabled={isViewedDisabled}
      onViewedChange={handleViewedChange}
      filePathRoot={filePathRoot}
      isCollapsed={collapsed}
      onToggleCollapsed={handleToggleCollapsed}
      patchState={patchState}
      onLoadPatch={handleLoadPatch}
      onRetry={handleRetry}
      onOpenFileInEditor={
        canOpenFileExternally ? onOpenFileInEditor : undefined
      }
      onOpenFilePreview={onOpenFilePreview}
      onRequestFileContents={onRequestFileContents}
    />
  );
}
