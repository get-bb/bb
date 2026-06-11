import { memo, useMemo } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import {
  GitDiffCardBody,
  type RequestDiffFileContents,
} from "./GitDiffCardBody";
import {
  GitDiffCardHeader,
  gitDiffCardHeaderWrapperClass,
  type GitDiffCardHeaderModel,
} from "./GitDiffCardHeader";
import {
  formatGitDiffFileLabel,
  getGitDiffFileChangeKind,
  getOpenableGitDiffPath,
  normalizeGitDiffPath,
  summarizeGitDiffFile,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

export type { RequestDiffFileContents };

export const GIT_DIFF_VIEW_BASE_OPTIONS = {
  overflow: "scroll",
  disableFileHeader: false,
  // Reveal 30 unchanged lines per expand-up / expand-down click. Library
  // default is 100 — too aggressive for our compact diff cards.
  expansionLineCount: 30,
} as const;

export interface GitDiffCardProps {
  fileDiff: ParsedGitDiffFile;
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  /**
   * When both isCollapsed and onToggleCollapsed are provided, the card renders
   * a chevron in the header and hides its body when collapsed. Omit both to
   * render a card with no collapse affordance (timeline rows do this — they
   * collapse at the row level).
   */
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * When true, the header sticks to the scroll container and grows a top
   * border when stuck. Used by the secondary panel; timeline rows leave this
   * off because their scroll container is per-row, not per-panel.
   */
  stickyHeader?: boolean;
  /** When true, replaces the body with a skeleton (for queued render slots). */
  isRendering?: boolean;
  /** Forwarded to the outer card element — used for IntersectionObserver-based scheduling. */
  cardRef?: (element: HTMLDivElement | null) => void;
  /**
   * When provided, the card lazy-fetches `oldFile`/`newFile` the first time
   * it scrolls into view and forwards them to `<DiffView>`. That unlocks
   * `@pierre/diffs`'s built-in expand-context buttons in the gaps between
   * hunks. Without this prop the card renders today's hunk-only view.
   *
   * The callback should resolve to `null` for binary files (the diff
   * renderer needs a UTF-8 string) so the card can leave expand disabled
   * for that file.
   */
  onRequestFileContents?: RequestDiffFileContents;
}

export const GitDiffCard = memo(function GitDiffCard({
  fileDiff,
  diffViewOptions,
  filePathRoot,
  onOpenFileInEditor,
  onOpenFilePreview,
  isCollapsed,
  onToggleCollapsed,
  stickyHeader = false,
  isRendering = false,
  cardRef,
  onRequestFileContents,
}: GitDiffCardProps) {
  const fileDiffStats = useMemo(
    () => summarizeGitDiffFile(fileDiff),
    [fileDiff],
  );
  const fileDiffLabel = useMemo(
    () => formatGitDiffFileLabel(fileDiff),
    [fileDiff],
  );
  const fileDiffChangeKind = useMemo(
    () => getGitDiffFileChangeKind(fileDiff),
    [fileDiff],
  );
  const openablePath = useMemo(
    () => getOpenableGitDiffPath(fileDiff),
    [fileDiff],
  );
  const previousPath = useMemo(
    () => normalizeGitDiffPath(fileDiff.prevName) ?? null,
    [fileDiff],
  );
  const headerModel = useMemo<GitDiffCardHeaderModel>(
    () => ({
      label: fileDiffLabel,
      path: normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name,
      openablePath,
      changeKind: fileDiffChangeKind,
      insertions: fileDiffStats.insertions,
      deletions: fileDiffStats.deletions,
    }),
    [
      fileDiff,
      fileDiffChangeKind,
      fileDiffLabel,
      fileDiffStats.deletions,
      fileDiffStats.insertions,
      openablePath,
    ],
  );
  // Pure renames + identical content land here with zero hunks; nothing for
  // the body to show, so force-collapse and disable the chevron.
  const hasChanges = fileDiff.hunks.length > 0;
  const supportsCollapse =
    isCollapsed !== undefined && onToggleCollapsed !== undefined;
  const isBodyHidden = !hasChanges || (supportsCollapse && isCollapsed);
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = stickyHeader && !isIntersecting;

  return (
    <div ref={cardRef} className="rounded-lg border border-border bg-background">
      {stickyHeader ? <div ref={stickySentinelRef} className="h-0" /> : null}
      <div
        className={gitDiffCardHeaderWrapperClass({
          stickyHeader,
          isBodyHidden,
          isStuck: isHeaderStuck,
        })}
      >
        <GitDiffCardHeader
          model={headerModel}
          previousPath={previousPath}
          filePathRoot={filePathRoot}
          onOpenFileInEditor={onOpenFileInEditor}
          onOpenFilePreview={onOpenFilePreview}
          isCollapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          hasChanges={hasChanges}
        />
      </div>
      {!isBodyHidden ? (
        <GitDiffCardBody
          fileDiff={fileDiff}
          changeKind={fileDiffChangeKind}
          diffViewOptions={diffViewOptions}
          isRendering={isRendering}
          onRequestFileContents={onRequestFileContents}
          reservesCollapseGutter={supportsCollapse}
        />
      ) : null}
    </div>
  );
});
