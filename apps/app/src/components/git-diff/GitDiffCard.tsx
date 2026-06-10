import {
  type CSSProperties,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileContents } from "@pierre/diffs";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { useIntersectionObserver } from "usehooks-ts";
import { Button } from "@/components/ui/button.js";
import { CopyButton } from "@/components/ui/copy-button.js";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { Icon } from "@/components/ui/icon.js";
import {
  getWrappedImageIndex,
  ImageLightbox,
} from "@/components/ui/image-lightbox.js";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { cn } from "@/lib/utils";
import {
  formatGitDiffFileLabel,
  getGitDiffFileChangeKind,
  getOpenableGitDiffPath,
  isImageGitDiffFile,
  normalizeGitDiffPath,
  summarizeGitDiffFile,
  type GitDiffFileChangeKind,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

/**
 * One side of a diff file resolved for the card. `text` carries UTF-8
 * contents for `@pierre/diffs` context expansion; `image` carries a data URL
 * the card renders directly instead of a text diff, plus the byte size used
 * for the header's `+/-` size delta.
 */
export type DiffFileContentsResult =
  | { kind: "text"; file: FileContents }
  | { kind: "image"; dataUrl: string; sizeBytes: number };

export type RequestDiffFileContents = (
  path: string,
  side: "old" | "new",
) => Promise<DiffFileContentsResult | null>;

export const GIT_DIFF_VIEW_BASE_OPTIONS = {
  overflow: "scroll",
  disableFileHeader: false,
  // Reveal 30 unchanged lines per expand-up / expand-down click. Library
  // default is 100 — too aggressive for our compact diff cards.
  expansionLineCount: 30,
} as const;

const GIT_DIFF_CARD_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

const GIT_DIFF_CARD_BODY_STYLE: CSSProperties = {
  contain: "layout paint style",
  contentVisibility: "auto",
  containIntrinsicSize: "0 600px",
};

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
   * it scrolls into view. Text results are forwarded to `<DiffView>`, which
   * unlocks `@pierre/diffs`'s built-in expand-context buttons in the gaps
   * between hunks; image results render as an inline preview instead of the
   * text diff. Without this prop the card renders the hunk-only view.
   *
   * The callback should resolve to `null` for binary files the card can't
   * preview (the diff renderer needs a UTF-8 string) so the card can leave
   * expand disabled for that file.
   */
  onRequestFileContents?: RequestDiffFileContents;
}

// `parseDiffFromFile` in @pierre/diffs splits file contents on this exact
// regex (positive lookbehind on \n) and tags the resulting arrays onto the
// parsed file as `oldLines` / `newLines`. The hunks renderer reads those
// arrays to know what's "expandable" between hunks. We do the same tagging
// directly on our parsed fileDiff once contents load — no need to make the
// library re-parse from scratch.
const SPLIT_WITH_NEWLINES = /(?<=\n)/u;

interface EnrichedFileDiff extends ParsedGitDiffFile {
  oldLines: string[];
  newLines: string[];
}

type DiffFileContentSource =
  | { kind: "empty"; path: string }
  | { kind: "request"; path: string; side: "old" | "new" };

interface DiffFileContentPlan {
  identity: string;
  old: DiffFileContentSource;
  new: DiffFileContentSource;
}

type DiffFileEnrichmentState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; oldLines: string[]; newLines: string[] }
  | {
      status: "ready-image";
      oldImageUrl: string | null;
      newImageUrl: string | null;
      oldSizeBytes: number | null;
      newSizeBytes: number | null;
    }
  | { status: "unavailable" }
  | { status: "error" };

function buildDiffFileContentPlan(
  fileDiff: ParsedGitDiffFile,
  changeKind: GitDiffFileChangeKind,
): DiffFileContentPlan {
  const currentPath = normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name;
  const previousPath = normalizeGitDiffPath(fileDiff.prevName) ?? currentPath;

  const oldSource: DiffFileContentSource =
    changeKind === "added"
      ? { kind: "empty", path: currentPath }
      : {
          kind: "request",
          path: changeKind === "renamed" ? previousPath : currentPath,
          side: "old",
        };
  const newSource: DiffFileContentSource =
    changeKind === "deleted"
      ? { kind: "empty", path: currentPath }
      : { kind: "request", path: currentPath, side: "new" };
  const hunkIdentity = fileDiff.hunks
    .map(
      (hunk) =>
        `${hunk.hunkSpecs ?? ""}:${hunk.additionStart}:${hunk.additionCount}:${hunk.deletionStart}:${hunk.deletionCount}`,
    )
    .join("|");

  return {
    identity: [
      changeKind,
      describeDiffFileContentSource(oldSource),
      describeDiffFileContentSource(newSource),
      hunkIdentity,
    ].join(":"),
    old: oldSource,
    new: newSource,
  };
}

function describeDiffFileContentSource(source: DiffFileContentSource): string {
  return source.kind === "empty"
    ? `empty:${source.path}`
    : `request:${source.side}:${source.path}`;
}

function resolveDiffFileContentSource(
  source: DiffFileContentSource,
  fetcher: RequestDiffFileContents,
): Promise<DiffFileContentsResult | null> {
  if (source.kind === "empty") {
    return Promise.resolve({
      kind: "text",
      file: { name: source.path, contents: "" },
    });
  }
  return fetcher(source.path, source.side);
}

function splitFileContentsForDiffContext(file: FileContents): string[] {
  if (file.contents.length === 0) return [];
  return file.contents.split(SPLIT_WITH_NEWLINES);
}

function GitDiffCardBodySkeleton() {
  return (
    <div className="space-y-1.5 px-3 py-3">
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[96%] rounded-sm" />
      <Skeleton className="h-3 w-[93%] rounded-sm" />
      <Skeleton className="h-3 w-[90%] rounded-sm" />
      <Skeleton className="h-3 w-[87%] rounded-sm" />
      <Skeleton className="h-3 w-[84%] rounded-sm" />
    </div>
  );
}

// Image add/delete (and net resize on modify) is conveyed by the header's
// `+/- size` delta and the card tint, so per-image captions only earn their
// keep when there are two images to tell apart (a modified file's old vs new).
interface GitDiffCardImageSide {
  url: string;
  caption: string | null;
}

function buildGitDiffCardImageSides(
  oldImageUrl: string | null,
  newImageUrl: string | null,
): GitDiffCardImageSide[] {
  const showSideLabels = oldImageUrl !== null && newImageUrl !== null;
  const sides: GitDiffCardImageSide[] = [];
  if (oldImageUrl !== null) {
    sides.push({ url: oldImageUrl, caption: showSideLabels ? "Old" : null });
  }
  if (newImageUrl !== null) {
    sides.push({ url: newImageUrl, caption: showSideLabels ? "New" : null });
  }
  return sides;
}

function getGitDiffCardImageAlt(
  fileDiffLabel: string,
  side: GitDiffCardImageSide,
): string {
  return side.caption === null
    ? fileDiffLabel
    : `${fileDiffLabel} (${side.caption.toLowerCase()})`;
}

const BYTES_PER_UNIT = 1024;

function formatByteSize(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }
  const kb = bytes / BYTES_PER_UNIT;
  if (kb < BYTES_PER_UNIT) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = kb / BYTES_PER_UNIT;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

interface ImageSizeStat {
  addedBytes: number | null;
  removedBytes: number | null;
}

interface GitDiffCardImageSizeStatProps {
  stat: ImageSizeStat;
}

/**
 * Header size indicator for an image card. An image change swaps the whole
 * binary, so rather than netting the two sizes we surface them like a text
 * diff's `+/-` tally: the new file's bytes as added, the old file's bytes as
 * removed. Adds show only `+`, deletes only `-`, edits show both. Returns null
 * until the bytes load.
 */
function getImageSizeStat(
  enrichment: DiffFileEnrichmentState,
  changeKind: GitDiffFileChangeKind,
): ImageSizeStat | null {
  if (enrichment.status !== "ready-image") return null;
  const addedBytes = changeKind === "deleted" ? null : enrichment.newSizeBytes;
  const removedBytes = changeKind === "added" ? null : enrichment.oldSizeBytes;
  if (addedBytes === null && removedBytes === null) return null;
  return { addedBytes, removedBytes };
}

function GitDiffCardImageSizeStat({
  stat,
}: GitDiffCardImageSizeStatProps) {
  return (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs tabular-nums">
      {stat.addedBytes !== null ? (
        <span className="text-diff-added">{`+${formatByteSize(stat.addedBytes)}`}</span>
      ) : null}
      {stat.removedBytes !== null ? (
        <span className="text-diff-removed">{`-${formatByteSize(stat.removedBytes)}`}</span>
      ) : null}
    </span>
  );
}

interface GitDiffCardImageBodyProps {
  enrichment: DiffFileEnrichmentState;
  fileDiffLabel: string;
}

function GitDiffCardImageBody({
  enrichment,
  fileDiffLabel,
}: GitDiffCardImageBodyProps) {
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  if (enrichment.status === "idle" || enrichment.status === "loading") {
    return <GitDiffCardBodySkeleton />;
  }
  if (enrichment.status !== "ready-image") {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        No preview available for this image.
      </div>
    );
  }
  const imageSides = buildGitDiffCardImageSides(
    enrichment.oldImageUrl,
    enrichment.newImageUrl,
  );
  const expandedImageSide =
    expandedImageIndex === null ? undefined : imageSides[expandedImageIndex];
  const stepExpandedImage = (direction: "previous" | "next") => {
    setExpandedImageIndex((currentIndex) =>
      currentIndex === null
        ? null
        : getWrappedImageIndex({
            currentIndex,
            direction,
            itemCount: imageSides.length,
          }),
    );
  };
  return (
    <>
      <div className="flex items-start gap-3 px-3 py-3">
        {imageSides.map((side, index) => (
          <figure key={side.url} className="min-w-0">
            <button
              type="button"
              className="block max-w-full cursor-zoom-in"
              onClick={() => setExpandedImageIndex(index)}
            >
              <img
                src={side.url}
                alt={getGitDiffCardImageAlt(fileDiffLabel, side)}
                className="block max-h-80 max-w-full rounded-md border border-border object-contain"
              />
            </button>
            {side.caption !== null ? (
              <figcaption className="mt-1 text-xs text-muted-foreground">
                {side.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
      <ImageLightbox
        title={`${fileDiffLabel} image preview`}
        imageSrc={expandedImageSide?.url ?? null}
        imageAlt={
          expandedImageSide
            ? getGitDiffCardImageAlt(fileDiffLabel, expandedImageSide)
            : fileDiffLabel
        }
        hasMultipleImages={imageSides.length > 1}
        onPrevious={() => stepExpandedImage("previous")}
        onNext={() => stepExpandedImage("next")}
        onClose={() => setExpandedImageIndex(null)}
      />
    </>
  );
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
  const isAddedFile = fileDiffChangeKind === "added";
  const isDeletedFile = fileDiffChangeKind === "deleted";
  // Binary image changes parse to zero hunks, so the text diff view has
  // nothing to show, so render an inline image preview instead. Gated on the
  // fetcher because the preview bytes come through `onRequestFileContents`;
  // pure renames stay body-less like their text counterparts.
  const isImagePreviewCard =
    fileDiff.hunks.length === 0 &&
    fileDiff.type !== "rename-pure" &&
    onRequestFileContents !== undefined &&
    isImageGitDiffFile(fileDiff);
  const headerInsertions = isDeletedFile ? 0 : fileDiffStats.insertions;
  const headerDeletions = isAddedFile ? 0 : fileDiffStats.deletions;
  const hideEmptyHeaderStats = isAddedFile || isDeletedFile;
  const renameInfo = useMemo(() => {
    const name = normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name;
    const prevName = normalizeGitDiffPath(fileDiff.prevName);
    if (prevName && prevName !== name) {
      return { from: prevName, to: name };
    }
    return null;
  }, [fileDiff]);
  const openablePath = useMemo(
    () => getOpenableGitDiffPath(fileDiff),
    [fileDiff],
  );
  const copyablePath = openablePath
    ? resolveAbsoluteFilePath({ path: openablePath, rootPath: filePathRoot })
    : null;
  const canOpenFile = Boolean(openablePath);
  // Pure renames + identical content land here with zero hunks; nothing for
  // the body to show, so force-collapse and disable the chevron. Image
  // preview cards have a body despite their zero hunks.
  const hasChanges = fileDiff.hunks.length > 0 || isImagePreviewCard;
  const supportsCollapse =
    isCollapsed !== undefined && onToggleCollapsed !== undefined;
  const isBodyHidden = !hasChanges || (supportsCollapse && isCollapsed);
  const fileDiffOptions = useMemo(
    () => ({ ...diffViewOptions, disableFileHeader: true }),
    [diffViewOptions],
  );
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = stickyHeader && !isIntersecting;

  // Lazy-enrich the parsed fileDiff with old/new file contents the first
  // time the card body crosses the viewport. The lib's hunks renderer
  // checks `ast.newLines.length > 0 && ast.oldLines.length > 0` to decide
  // whether to draw expand-context buttons in the gaps between hunks; once
  // we tag those arrays the library renders the buttons on its next pass.
  const fileContentPlan = useMemo(
    () => buildDiffFileContentPlan(fileDiff, fileDiffChangeKind),
    [fileDiff, fileDiffChangeKind],
  );
  const { ref: bodySentinelRef, isIntersecting: isBodyVisible } =
    useIntersectionObserver({
      initialIsIntersecting: false,
      rootMargin: "200px",
    });
  // The parent's `onRequestFileContents` may be a fresh function reference
  // on every render. We keep the latest in a ref so the fetch effect doesn't
  // re-run every panel re-render — a re-run would cancel the in-flight
  // promise via its cleanup before `setEnrichment` could apply.
  const fetcherRef = useRef(onRequestFileContents);
  useEffect(() => {
    fetcherRef.current = onRequestFileContents;
  });
  const [enrichment, setEnrichment] = useState<DiffFileEnrichmentState>({
    status: "idle",
  });
  const enrichmentStatusRef = useRef<DiffFileEnrichmentState["status"]>("idle");
  const [hasBodyEnteredViewport, setHasBodyEnteredViewport] = useState(false);
  const [hasLoadedDeletedDiff, setHasLoadedDeletedDiff] = useState(false);
  // Reset cached enrichment when the card swaps to different diff contents.
  // Keep the viewport-entry flag: an already-visible sentinel does not emit
  // another intersection change when only the diff hunk identity changes.
  useEffect(() => {
    enrichmentStatusRef.current = "idle";
    setEnrichment({ status: "idle" });
    setHasLoadedDeletedDiff(false);
  }, [fileContentPlan.identity]);
  useEffect(() => {
    if (!isBodyHidden && isBodyVisible) {
      setHasBodyEnteredViewport(true);
    }
  }, [isBodyHidden, isBodyVisible]);
  // The deleted-file gate defers the expensive text-diff renderer (and the old
  // file fetch behind it) until the user asks for it. Image previews have no
  // such renderer, so they load on viewport entry like added/modified images, so
  // the header size and preview appear without a "Load diff" step.
  const shouldGateDeletedDiff =
    isDeletedFile && !isImagePreviewCard && !hasLoadedDeletedDiff;
  const shouldRenderDiffView =
    hasBodyEnteredViewport && !isRendering && !shouldGateDeletedDiff;
  // Fire the fetch once the diff view is actually renderable. Effect deps
  // deliberately exclude `onRequestFileContents` (we read the latest via the
  // ref) so stable visibility doesn't re-trigger when the panel re-renders.
  useEffect(() => {
    if (!shouldRenderDiffView || enrichmentStatusRef.current !== "idle") {
      return;
    }
    const fetcher = fetcherRef.current;
    if (!fetcher) return;

    let cancelled = false;
    enrichmentStatusRef.current = "loading";
    setEnrichment({ status: "loading" });

    void Promise.all([
      resolveDiffFileContentSource(fileContentPlan.old, fetcher),
      resolveDiffFileContentSource(fileContentPlan.new, fetcher),
    ])
      .then(([oldResult, newResult]) => {
        if (cancelled) return;
        const oldImage = oldResult?.kind === "image" ? oldResult : null;
        const newImage = newResult?.kind === "image" ? newResult : null;
        if (oldImage !== null || newImage !== null) {
          enrichmentStatusRef.current = "ready-image";
          setEnrichment({
            status: "ready-image",
            oldImageUrl: oldImage?.dataUrl ?? null,
            newImageUrl: newImage?.dataUrl ?? null,
            oldSizeBytes: oldImage?.sizeBytes ?? null,
            newSizeBytes: newImage?.sizeBytes ?? null,
          });
          return;
        }
        if (oldResult?.kind !== "text" || newResult?.kind !== "text") {
          enrichmentStatusRef.current = "unavailable";
          setEnrichment({ status: "unavailable" });
          return;
        }
        enrichmentStatusRef.current = "ready";
        setEnrichment({
          status: "ready",
          oldLines: splitFileContentsForDiffContext(oldResult.file),
          newLines: splitFileContentsForDiffContext(newResult.file),
        });
      })
      .catch(() => {
        if (cancelled) return;
        enrichmentStatusRef.current = "error";
        setEnrichment({ status: "error" });
      });

    return () => {
      cancelled = true;
      if (enrichmentStatusRef.current === "loading") {
        enrichmentStatusRef.current = "idle";
      }
    };
  }, [fileContentPlan, shouldRenderDiffView]);

  const enrichedFileDiff = useMemo<EnrichedFileDiff | ParsedGitDiffFile>(() => {
    if (enrichment.status !== "ready") return fileDiff;
    return {
      ...fileDiff,
      oldLines: enrichment.oldLines,
      newLines: enrichment.newLines,
    };
  }, [fileDiff, enrichment]);

  const imageSizeStat = isImagePreviewCard
    ? getImageSizeStat(enrichment, fileDiffChangeKind)
    : null;

  return (
    <div
      ref={cardRef}
      className="rounded-lg border border-border bg-background"
    >
      {stickyHeader ? <div ref={stickySentinelRef} className="h-0" /> : null}
      <div
        className={cn(
          // Left padding matches the in-diff expand-button's margin-left
          // (`--diffs-gap-inline` defaults to `--diffs-gap-fallback: 8px`
          // in the lib's style.js — `[data-separator='line-info']
          // [data-separator-wrapper] { margin-left: 8px }`). The header's
          // collapse chevron now sits at the same X as the expand chevrons
          // the library renders between hunks below.
          "rounded-lg bg-background py-1.5 pl-2 pr-3 text-xs font-medium text-foreground",
          stickyHeader && "sticky top-0 z-30",
          !isBodyHidden && "rounded-b-none",
          // When stuck, the card's own rounded top border scrolls out of view;
          // add a matching top border on the sticky so it still reads as the
          // top edge of the card instead of a flat-cut slab.
          isHeaderStuck && "rounded-t-none border-t border-border",
        )}
      >
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center">
            {supportsCollapse ? (
              <button
                type="button"
                className={cn(
                  // Width matches the in-diff expand-button's 32px slot so
                  // the header chevron occupies the same column as the
                  // expand chevrons the library renders between hunks.
                  "inline-flex w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors",
                  hasChanges
                    ? "hover:text-foreground"
                    : "cursor-not-allowed opacity-40",
                )}
                onClick={hasChanges ? onToggleCollapsed : undefined}
                disabled={!hasChanges}
                aria-label={
                  hasChanges
                    ? `${isCollapsed ? "Expand" : "Collapse"} ${fileDiffLabel}`
                    : `${fileDiffLabel} has no changes to expand`
                }
                aria-expanded={hasChanges ? !isCollapsed : undefined}
              >
                <Icon
                  name="ChevronRight"
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-150",
                    hasChanges && !isCollapsed && "rotate-90",
                  )}
                />
              </button>
            ) : null}
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5",
                // Mirror the diff body's `[data-column-content] {
                // padding-inline: 1ch }` so the file name is offset from
                // the card's left edge by the same gutter the diff body
                // uses between its column boundary and the content text.
                "pl-[1ch]",
              )}
            >
              {renameInfo ? (
                <TruncateStart
                  className="min-w-0 font-mono text-xs leading-5 text-muted-foreground"
                  title={renameInfo.from}
                >
                  {renameInfo.from}
                </TruncateStart>
              ) : null}
              {renameInfo ? (
                <Icon
                  name="ArrowRight"
                  aria-hidden="true"
                  className="size-3 shrink-0 text-subtle-foreground"
                />
              ) : null}
              <FilePathLink
                path={openablePath ?? fileDiff.name}
                displayName={renameInfo ? renameInfo.to : fileDiffLabel}
                onClick={
                  canOpenFile && openablePath && onOpenFilePreview
                    ? () => onOpenFilePreview(openablePath)
                    : undefined
                }
                className="font-mono font-medium text-foreground"
              />
              {copyablePath ? (
                <CopyButton
                  text={copyablePath}
                  label={`Copy path for ${fileDiffLabel}`}
                  className="rounded-md hover:bg-state-hover"
                />
              ) : null}
              {canOpenFile && openablePath && onOpenFileInEditor ? (
                <OpenInEditorButton
                  onClick={() => onOpenFileInEditor(openablePath)}
                  label={`Open ${fileDiffLabel} in editor`}
                />
              ) : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {isImagePreviewCard ? (
              imageSizeStat !== null ? (
                <GitDiffCardImageSizeStat stat={imageSizeStat} />
              ) : null
            ) : (
              <DiffStatsTally
                insertions={headerInsertions}
                deletions={headerDeletions}
                hideZero={hideEmptyHeaderStats}
                className="text-xs"
              />
            )}
          </span>
        </div>
      </div>
      {!isBodyHidden ? (
        <div
          ref={bodySentinelRef}
          className="overflow-hidden rounded-b-lg bg-background"
          style={GIT_DIFF_CARD_BODY_STYLE}
        >
          {shouldGateDeletedDiff ? (
            <div className="flex items-center py-3 pl-2 pr-3 text-xs text-muted-foreground">
              {supportsCollapse ? (
                <span aria-hidden className="w-8 shrink-0" />
              ) : null}
              <span className="pl-[1ch]">
                <span>This file was deleted.</span>{" "}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs underline underline-offset-4 hover:underline"
                  onClick={() => {
                    setHasLoadedDeletedDiff(true);
                    setHasBodyEnteredViewport(true);
                  }}
                >
                  Load diff
                </Button>
              </span>
            </div>
          ) : !shouldRenderDiffView ? (
            <GitDiffCardBodySkeleton />
          ) : isImagePreviewCard ? (
            <GitDiffCardImageBody
              enrichment={enrichment}
              fileDiffLabel={fileDiffLabel}
            />
          ) : (
            <div className="overflow-x-auto">
              <div
                className="w-full max-w-full"
                style={GIT_DIFF_CARD_VIEW_STYLE}
              >
                <DiffView
                  fileDiff={enrichedFileDiff}
                  options={fileDiffOptions}
                />
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
});
