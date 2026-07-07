import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffFileEntry, DiffPatchEntry } from "@bb/server-contract";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { RequestDiffFileContents } from "@/components/git-diff/GitDiffCardBody";
import {
  type DiffPatchState,
  type LoadDiffPatchPath,
  type RetryDiffPatchPath,
  useEnvironmentDiffPatches,
} from "@/hooks/queries/use-environment-diff-patches";
import { cn } from "@bb/shared-ui/lib/utils";
import { DiffFileCard } from "./DiffFileCard";
import {
  diffFileCardStateAtomFamily,
  estimateCardHeight,
  resolveCardCollapsed,
  resolveDiffFileCardInitialState,
} from "./diffFilesStore";

/** Overscan rows kept mounted on each side of the viewport. */
const DIFF_FILES_OVERSCAN = 4;
const DIFF_FILES_GAP_PX = 8;

export interface DiffFilesPanelProps {
  environmentId: string;
  target: WorkspaceDiffTarget;
  /** Single identity for the active (environment, target) diff slice. */
  diffIdentity: string;
  files: DiffFileEntry[];
  /**
   * Patches the TOC shipped inline for the first screen of `auto` files. Seeded
   * into the patch cache on load so initial content renders in one round-trip,
   * without a separate `/diff/patch` fetch.
   */
  initialPatches: DiffPatchEntry[];
  /**
   * The TOC query's `dataUpdatedAt`. Bumps whenever the diff's table of contents
   * refetches — including a content-only file edit that leaves the file
   * membership (and therefore the visible/overscan paths) unchanged. The panel
   * re-requests visible patches on this change so the evicted (stale) patches
   * are re-fetched even when the path set is identical.
   */
  filesUpdatedAt: number;
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  /**
   * True while the TOC query is serving cross-target placeholder data (the
   * previous diff target's slice). The scroll-to-file effect waits for the real
   * slice so it never lands on a stale index.
   */
  isPlaceholderData?: boolean;
  /**
   * A changed-file path requested from the info tab / prompt banner. Once it
   * appears in the current slice, the panel scrolls that file's card to the top
   * and calls {@link onScrolledToPath} so the pending request is cleared.
   */
  scrollToPath?: string | null;
  onScrolledToPath?: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
  onSelectionAddToChat?: (text: string) => void;
}

/**
 * Virtualized diff-tab file list. Renders the table of contents
 * ({@link DiffFileEntry}[]) with `@tanstack/react-virtual` so only on-screen
 * cards (plus a small overscan) are mounted. Visible + overscan `auto`-tier
 * paths drive {@link useEnvironmentDiffPatches} so patches page in as the user
 * scrolls; each loaded patch is parsed per-file and handed to its card.
 */
export function DiffFilesPanel({
  environmentId,
  target,
  diffIdentity,
  files,
  initialPatches,
  filesUpdatedAt,
  diffViewOptions,
  filePathRoot,
  isPlaceholderData,
  scrollToPath,
  onScrolledToPath,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
  onSelectionAddToChat,
}: DiffFilesPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { requestPaths, getPatchState, retry, loadPath, seedInitialPatches } =
    useEnvironmentDiffPatches(environmentId, { target });

  // Prime the cache with the TOC's inline first-screen patches before the
  // scroll-driven fetch runs, so those cards render immediately and aren't
  // re-requested. Re-seeds whenever the TOC refetches (`filesUpdatedAt`).
  useEffect(() => {
    if (initialPatches.length > 0) {
      seedInitialPatches(initialPatches);
    }
  }, [seedInitialPatches, initialPatches, filesUpdatedAt]);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const entry = files[index];
      if (!entry) {
        return 0;
      }
      // Seed the estimate from the card's resolved initial collapsed state so a
      // many-file diff (which opens every card collapsed) estimates header-row
      // floors, not full expanded bodies — otherwise the total size overshoots
      // ~50-100x and the scrollbar jumps. `measureElement` corrects the exact
      // height once the card mounts (or the user toggles it open).
      const collapsed = resolveDiffFileCardInitialState({
        entry,
        fileCount: files.length,
      }).collapsed;
      return estimateCardHeight({ entry, collapsed }) + DIFF_FILES_GAP_PX;
    },
    // Key the measurement cache by the stable per-row path (the same identity
    // used as the React key) rather than by index, so measured heights don't
    // bleed across diff-target switches where the same index holds a different
    // file.
    getItemKey: (index) => files[index]?.path ?? index,
    overscan: DIFF_FILES_OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const { startIndex, endIndex } = virtualizer.range ?? {
    startIndex: 0,
    endIndex: -1,
  };

  // Visible rows are those inside the virtualizer's (non-overscan) range; the
  // remaining mounted rows are overscan. Only `auto`-tier paths are requested —
  // `on_demand` loads on click and `too_large` is never fetched.
  const { visiblePaths, overscanPaths } = useMemo(() => {
    const visible: string[] = [];
    const overscan: string[] = [];
    for (const item of virtualItems) {
      const entry = files[item.index];
      if (!entry || entry.loadMode !== "auto") {
        continue;
      }
      if (item.index >= startIndex && item.index <= endIndex) {
        visible.push(entry.path);
      } else {
        overscan.push(entry.path);
      }
    }
    return { visiblePaths: visible, overscanPaths: overscan };
  }, [virtualItems, files, startIndex, endIndex]);

  // A stable join so the effect only re-requests when the membership actually
  // changes, not on every scroll frame that returns the same rows.
  const visibleKey = visiblePaths.join("\n");
  const overscanKey = overscanPaths.join("\n");
  useEffect(() => {
    requestPaths({ visible: visiblePaths, overscan: overscanPaths });
    // visiblePaths/overscanPaths are derived from the keys; depend on the keys
    // so we skip re-requesting identical membership. Also re-fire when the TOC
    // refetches (`filesUpdatedAt` bumps): a content-only edit produces the same
    // paths but evicts the patch cache, so the same visible set must be
    // re-requested to fetch the fresh patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestPaths, visibleKey, overscanKey, filesUpdatedAt]);

  // Scroll a file requested from the info tab / prompt banner to the top of the
  // panel. The request persists until the path is in the *real* slice: opening a
  // file first resets the selection to all-changes, and during that refetch the
  // panel renders the previous target's files as placeholder — scrolling against
  // that stale slice would land on the wrong index, so we wait for
  // `!isPlaceholderData`. We scroll + clear only once the path appears (a path
  // never in the diff is left for the env-change reset / next request to clear).
  useEffect(() => {
    if (!scrollToPath || isPlaceholderData) {
      return;
    }
    const index = files.findIndex((file) => file.path === scrollToPath);
    if (index < 0) {
      return;
    }
    virtualizer.scrollToIndex(index, { align: "start" });
    onScrolledToPath?.();
  }, [scrollToPath, files, isPlaceholderData, virtualizer, onScrolledToPath]);

  return (
    <div ref={scrollRef} className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3")}>
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualItems.map((item) => {
          const entry = files[item.index];
          if (!entry) {
            return null;
          }
          return (
            <div
              key={entry.path}
              data-index={item.index}
              ref={virtualizer.measureElement}
              // Position with `top` rather than `transform: translateY` so the
              // card's `position: sticky` file header can pin to the scroll
              // container — a transformed ancestor becomes the header's
              // containing block and breaks sticky (the header would scroll away
              // with the card instead of staying put through the file's diff).
              className="absolute left-0 w-full"
              style={{
                top: item.start,
                paddingBottom: DIFF_FILES_GAP_PX,
              }}
            >
              <DiffFileRow
                entry={entry}
                diffIdentity={diffIdentity}
                fileCount={files.length}
                diffViewOptions={diffViewOptions}
                filePathRoot={filePathRoot}
                patchState={getPatchState(entry.path)}
                loadPath={loadPath}
                retry={retry}
                onOpenFileInEditor={onOpenFileInEditor}
                onOpenFilePreview={onOpenFilePreview}
                onRequestFileContents={onRequestFileContents}
                onSelectionAddToChat={onSelectionAddToChat}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-hidden overflow-y-auto";

interface DiffFileRowProps {
  entry: DiffFileEntry;
  diffIdentity: string;
  fileCount: number;
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  patchState: DiffPatchState;
  loadPath: LoadDiffPatchPath;
  retry: RetryDiffPatchPath;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
  onSelectionAddToChat?: (text: string) => void;
}

function DiffFileRow({
  entry,
  diffIdentity,
  fileCount,
  diffViewOptions,
  filePathRoot,
  patchState,
  loadPath,
  retry,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
  onSelectionAddToChat,
}: DiffFileRowProps) {
  const stateAtom = useMemo(
    () => diffFileCardStateAtomFamily({ diffIdentity, path: entry.path }),
    [diffIdentity, entry.path],
  );
  const [cardState, setCardState] = useAtom(stateAtom);
  const collapsed = resolveCardCollapsed(cardState, entry, fileCount);

  const handleToggleCollapsed = useCallback(() => {
    setCardState((previous) => {
      const current =
        previous ?? resolveDiffFileCardInitialState({ entry, fileCount });
      return { ...current, collapsed: !current.collapsed };
    });
  }, [entry, fileCount, setCardState]);

  const handleLoadPatch = useCallback(() => {
    loadPath(entry.path);
  }, [entry.path, loadPath]);

  const handleRetry = useCallback(() => {
    retry(entry.path);
  }, [entry.path, retry]);

  return (
    <DiffFileCard
      entry={entry}
      diffViewOptions={diffViewOptions}
      filePathRoot={filePathRoot}
      isCollapsed={collapsed}
      onToggleCollapsed={handleToggleCollapsed}
      patchState={patchState}
      onLoadPatch={handleLoadPatch}
      onRetry={handleRetry}
      onOpenFileInEditor={onOpenFileInEditor}
      onOpenFilePreview={onOpenFilePreview}
      onRequestFileContents={onRequestFileContents}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}
