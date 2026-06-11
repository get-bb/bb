import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { DiffFileEntry } from "@bb/server-contract";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { RequestDiffFileContents } from "@/components/git-diff/GitDiffCardBody";
import {
  type DiffPatchState,
  type LoadDiffPatchPath,
  type RetryDiffPatchPath,
  useEnvironmentDiffPatches,
} from "@/hooks/queries/use-environment-diff-patches";
import { cn } from "@/lib/utils";
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
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
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
  diffViewOptions,
  filePathRoot,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFilesPanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { requestPaths, getPatchState, retry, loadPath } =
    useEnvironmentDiffPatches(environmentId, { target });

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const entry = files[index];
      return entry ? estimateCardHeight(entry) + DIFF_FILES_GAP_PX : 0;
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
    // so we skip re-requesting identical membership.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestPaths, visibleKey, overscanKey]);

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
              className="absolute left-0 top-0 w-full"
              style={{
                transform: `translateY(${item.start}px)`,
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
    />
  );
}
