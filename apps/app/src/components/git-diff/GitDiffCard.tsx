import { memo, useEffect, useMemo, useState } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import { cn } from "@bb/shared-ui/lib/utils";
import type { DiffPresentation } from "@/components/code/code-rendering";
import {
  GitDiffCardBody,
  useGitDiffCardBody,
  type GitDiffCardSvgDisplayMode,
  type RequestDiffFileContents,
} from "./GitDiffCardBody";
import {
  GitDiffCardHeader,
  GitDiffCardImageSizeStat,
  GitDiffCardRawToggle,
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

interface GitDiffCardProps {
  fileDiff: ParsedGitDiffFile;
  presentation: DiffPresentation;
  /** Raw per-file patch text, when the caller still has it. */
  patchText?: string;
  filePathRoot?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  /**
   * When both isCollapsed and onToggleCollapsed are provided, the card renders
   * a chevron in the header and hides its body when collapsed. Omit both to
   * render a card with no collapse affordance (timeline rows do this — they
   * collapse at the row level).
   */
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * When true, the header sticks to the nearest scroll container. The default
   * stuck chrome is for panel-level scrolling; timeline row diffs can suppress
   * that edge when their own scroll area owns the fixed border.
   */
  stickyHeader?: boolean;
  /** When true, replaces the body with a skeleton (for queued render slots). */
  isRendering?: boolean;
  /** Extra classes for the outer card shell. */
  cardClassName?: string;
  /** Whether a stuck sticky header should draw its own replacement top edge. */
  showStuckHeaderEdge?: boolean;
  /**
   * When provided, the card lazy-fetches `oldFile`/`newFile` the first time
   * it scrolls into view. When `patchText` is also available to the shared body,
   * text results reparse the patch with complete file contents, which unlocks
   * `@pierre/diffs`'s built-in expand-context buttons in the gaps between
   * hunks; image results render as an inline preview instead of the text diff.
   * Without this prop the card renders the hunk-only view.
   *
   * The callback should resolve to `null` for binary files the card can't
   * preview (the diff renderer needs a UTF-8 string) so the card can leave
   * expand disabled for that file.
   */
  onRequestFileContents?: RequestDiffFileContents;
}

function buildGitDiffCardHeaderModel(
  fileDiff: ParsedGitDiffFile,
): GitDiffCardHeaderModel {
  const stats = summarizeGitDiffFile(fileDiff);
  return {
    label: formatGitDiffFileLabel(fileDiff),
    path: normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name,
    openablePath: getOpenableGitDiffPath(fileDiff),
    changeKind: getGitDiffFileChangeKind(fileDiff),
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

export const GitDiffCard = memo(function GitDiffCard({
  fileDiff,
  presentation,
  patchText,
  filePathRoot,
  onOpenFileInEditor,
  isCollapsed,
  onToggleCollapsed,
  stickyHeader = false,
  isRendering = false,
  cardClassName,
  showStuckHeaderEdge = true,
  onRequestFileContents,
}: GitDiffCardProps) {
  const headerModel = useMemo(
    () => buildGitDiffCardHeaderModel(fileDiff),
    [fileDiff],
  );
  const previousPath = normalizeGitDiffPath(fileDiff.prevName) ?? null;
  const bodyState = useGitDiffCardBody({
    fileDiff,
    changeKind: headerModel.changeKind,
    isRendering,
    onRequestFileContents,
    patchText,
  });
  const [svgDisplayMode, setSvgDisplayMode] =
    useState<GitDiffCardSvgDisplayMode>("preview");
  useEffect(() => {
    setSvgDisplayMode("preview");
  }, [fileDiff]);
  const toggleSvgDisplayMode = () => {
    setSvgDisplayMode((currentMode) =>
      currentMode === "preview" ? "raw" : "preview",
    );
  };
  // Pure renames + identical content land here with zero hunks; nothing for the
  // body to show, so force-collapse and disable the chevron. Image preview cards
  // have a body despite their zero hunks.
  const hasChanges = fileDiff.hunks.length > 0 || bodyState.isImageCard;
  const supportsCollapse =
    isCollapsed !== undefined && onToggleCollapsed !== undefined;
  const isBodyHidden = !hasChanges || (supportsCollapse && isCollapsed);
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = stickyHeader && !isIntersecting;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background",
        cardClassName,
      )}
    >
      {stickyHeader ? <div ref={stickySentinelRef} className="h-0" /> : null}
      <div
        className={gitDiffCardHeaderWrapperClass({
          stickyHeader,
          isBodyHidden,
          isStuck: isHeaderStuck,
          showStuckHeaderEdge,
        })}
      >
        <GitDiffCardHeader
          model={headerModel}
          previousPath={previousPath}
          filePathRoot={filePathRoot}
          onOpenFileInEditor={onOpenFileInEditor}
          isCollapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          hasChanges={hasChanges}
          // An image swap has no line counts to tally, so image cards always
          // override the slot: the byte-size delta once preview bytes load,
          // and an empty slot (never the text `+/-` tally) while they don't.
          statSlot={
            bodyState.isImageCard ? (
              bodyState.imageSizeStat !== null ? (
                <GitDiffCardImageSizeStat stat={bodyState.imageSizeStat} />
              ) : (
                <span />
              )
            ) : undefined
          }
          actionSlot={
            bodyState.isSvgPreviewCard && !isBodyHidden ? (
              <GitDiffCardRawToggle
                fileLabel={bodyState.fileDiffLabel}
                isRaw={svgDisplayMode === "raw"}
                onToggle={toggleSvgDisplayMode}
              />
            ) : undefined
          }
        />
      </div>
      {!isBodyHidden ? (
        <GitDiffCardBody
          state={bodyState}
          presentation={presentation}
          svgDisplayMode={svgDisplayMode}
          reservesCollapseGutter={supportsCollapse}
        />
      ) : null}
    </div>
  );
});
