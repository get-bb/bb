import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileContents } from "@pierre/diffs";
import type { GitDiffFileChangeKind } from "@bb/server-contract";
import { useIntersectionObserver } from "usehooks-ts";
import { Button } from "@bb/shared-ui/button";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { DiffHost } from "@/components/code/DiffHost";
import type { DiffPresentation } from "@/components/code/code-rendering";
import {
  getWrappedImageIndex,
  ImageLightbox,
  IMAGE_TRANSPARENCY_CHECKER_STYLE,
} from "@/components/ui/image-lightbox.js";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  formatGitDiffFileLabel,
  enrichGitDiffFileForContext,
  isPreviewableImagePath,
  isSvgGitDiffFile,
  normalizeGitDiffPath,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

/**
 * One side of a diff file resolved for the card. `text` carries UTF-8 contents
 * for `@pierre/diffs` context expansion; `image` carries a data URL the card
 * renders directly instead of a text diff, plus the byte size used for the
 * header's `+/-` size delta.
 */
export type DiffFileContentsResult =
  | { kind: "text"; file: FileContents }
  | { kind: "image"; dataUrl: string; sizeBytes: number };

export type RequestDiffFileContents = (
  path: string,
  side: "old" | "new",
) => Promise<DiffFileContentsResult | null>;

/**
 * Header size indicator for an image card. An image change swaps the whole
 * binary, so rather than netting the two sizes the card surfaces them like a
 * text diff's `+/-` tally: the new file's bytes as added, the old file's bytes
 * as removed.
 */
export interface DiffImageSizeStat {
  addedBytes: number | null;
  removedBytes: number | null;
}

export type GitDiffCardSvgDisplayMode = "preview" | "raw";

/**
 * Unchanged lines revealed per expand-up / expand-down click; the library
 * default of 100 is too aggressive for our compact cards. Only sent for a
 * card that can actually fetch full file contents — see
 * {@link BbDiffProps.expansionLineCount}.
 */
const DIFF_EXPANSION_LINE_COUNT = 30;

const GIT_DIFF_CARD_BODY_STYLE: CSSProperties = {
  contain: "layout paint style",
  contentVisibility: "auto",
  containIntrinsicSize: "0 600px",
};

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
  | { status: "ready"; fileDiff: ParsedGitDiffFile }
  | {
      status: "ready-image";
      oldImageUrl: string | null;
      newImageUrl: string | null;
      oldSizeBytes: number | null;
      newSizeBytes: number | null;
    }
  | {
      status: "ready-svg";
      fileDiff: ParsedGitDiffFile;
      oldImageUrl: string | null;
      newImageUrl: string | null;
    }
  | { status: "unavailable" }
  | { status: "error" };

/**
 * The app-owned expand-context affordance for a text card. Full old/new file
 * contents are only needed so `@pierre/diffs` can offer expand-context buttons
 * between hunks; fetching them eagerly costs two whole-file reads and a second
 * tokenize/render pass per card, which phones cannot afford. So the card
 * renders from the patch alone and fetches the contents on demand (`request`),
 * or during idle time on fine-pointer devices where the eager behavior is
 * cheap enough to keep.
 *
 * - `unavailable`: no fetcher, no patch text, or the change kind has nothing
 *   to expand (added/deleted files already carry every line) — render nothing.
 * - `idle`: offer the "Expand context" action.
 * - `loading` / `error`: show progress or a retry.
 * - `ready`: pierre now owns expansion; the affordance retires.
 */
type DiffContextExpansionStatus =
  | "unavailable"
  | "idle"
  | "loading"
  | "ready"
  | "error";

interface DiffContextExpansionState {
  status: DiffContextExpansionStatus;
  request: () => void;
}

/**
 * Change kinds whose patch omits lines the user might want to see. Added and
 * deleted files carry the whole file in the patch, so there is no surrounding
 * context to reach for.
 */
function canExpandContextForChangeKind(
  changeKind: GitDiffFileChangeKind,
): boolean {
  return (
    changeKind === "modified" ||
    changeKind === "renamed" ||
    changeKind === "copied"
  );
}

/**
 * Run `work` when the main thread is idle. Falls back to a short timeout where
 * `requestIdleCallback` is unavailable so the fine-pointer auto-expansion still
 * happens, just after the current paint.
 */
function scheduleIdleWork(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(work, { timeout: 2_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 200);
  return () => window.clearTimeout(handle);
}

function buildDiffFileContentPlan(
  fileDiff: ParsedGitDiffFile,
  changeKind: GitDiffFileChangeKind,
  patchText: string | undefined,
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
      patchText ?? "",
      fileDiff.deletionLines.join(""),
      fileDiff.additionLines.join(""),
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

/**
 * An image change is conveyed as a single-binary swap rather than text hunks,
 * so the card renders inline `<img>` previews instead of a `<DiffView>`. A card
 * is an image preview when the file parses to zero hunks (binary diffs have
 * none), is not a pure rename (those stay body-less like their text
 * counterparts), has a content fetcher to source the preview bytes, and carries
 * a browser-renderable image extension.
 */
function isImagePreviewCard(
  fileDiff: ParsedGitDiffFile,
  onRequestFileContents: RequestDiffFileContents | undefined,
): boolean {
  return (
    fileDiff.hunks.length === 0 &&
    fileDiff.type !== "rename-pure" &&
    onRequestFileContents !== undefined &&
    isPreviewableImagePath(fileDiff.name)
  );
}

function isSvgPreviewCard(
  fileDiff: ParsedGitDiffFile,
  onRequestFileContents: RequestDiffFileContents | undefined,
): boolean {
  return (
    fileDiff.type !== "rename-pure" &&
    onRequestFileContents !== undefined &&
    isSvgGitDiffFile(fileDiff)
  );
}

function svgTextToDataUrl(contents: string): string | null {
  const trimmedContents = contents.trim();
  if (trimmedContents.length === 0) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(trimmedContents)}`;
}

interface UseGitDiffCardBodyArgs {
  fileDiff: ParsedGitDiffFile;
  changeKind: GitDiffFileChangeKind;
  /** When true, holds the body at a skeleton (queued render slots). */
  isRendering: boolean;
  onRequestFileContents: RequestDiffFileContents | undefined;
  /** Raw per-file patch text, used to reparse with full old/new contents. */
  patchText?: string;
}

interface GitDiffCardBodyState {
  bodySentinelRef: RefCallback<HTMLDivElement>;
  enrichment: DiffFileEnrichmentState;
  enrichedFileDiff: ParsedGitDiffFile;
  fileDiffLabel: string;
  isImageCard: boolean;
  isSvgPreviewCard: boolean;
  shouldGateDeletedDiff: boolean;
  shouldRenderDiffView: boolean;
  loadDeletedDiff: () => void;
  /** The header's `+/-` byte delta for an image card; `null` for text cards. */
  imageSizeStat: DiffImageSizeStat | null;
  /** On-demand full-file context for text cards; see {@link DiffContextExpansionState}. */
  contextExpansion: DiffContextExpansionState;
  /**
   * The raw per-file patch the caller supplied, forwarded to the host diff
   * boundary so a plugin replacement gets the caller's own bytes instead of a
   * reconstruction.
   */
  patchText: string | undefined;
}

/**
 * The diff-card body's data layer, owned by the hook so a card can read the
 * derived state (notably {@link DiffImageSizeStat} for the header, a sibling of
 * the body) synchronously in the same render as the body — lifting it through an
 * effect would lag the header behind the preview by a tick. Drives the lazy
 * content fetch (text or image), the deleted-file load gate, and the
 * in-viewport render skeleton. Pass the result to {@link GitDiffCardBody}.
 */
export function useGitDiffCardBody({
  fileDiff,
  changeKind,
  isRendering,
  onRequestFileContents,
  patchText,
}: UseGitDiffCardBodyArgs): GitDiffCardBodyState {
  const isDeletedFile = changeKind === "deleted";
  const isImageCard = isImagePreviewCard(fileDiff, onRequestFileContents);
  const isSvgCard = isSvgPreviewCard(fileDiff, onRequestFileContents);
  const fileDiffLabel = useMemo(
    () => formatGitDiffFileLabel(fileDiff),
    [fileDiff],
  );
  const fileContentPlan = useMemo(
    () => buildDiffFileContentPlan(fileDiff, changeKind, patchText),
    [fileDiff, changeKind, patchText],
  );
  const { ref: bodySentinelRef, isIntersecting: isBodyVisible } =
    useIntersectionObserver({
      initialIsIntersecting: false,
      rootMargin: "200px",
    });
  // The caller's `onRequestFileContents` may be a fresh function reference on
  // every render. We keep the latest in a ref so the fetch effect doesn't re-run
  // every panel re-render — a re-run would cancel the in-flight promise via its
  // cleanup before `setEnrichment` could apply.
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
  // Bumped by each explicit (or idle-scheduled) expand-context request. Zero
  // means nobody has asked for context yet; the fetch effect keys on the
  // version so a retry after an error re-runs it.
  const [contextRequestVersion, setContextRequestVersion] = useState(0);
  const isPointerCoarse = usePointerCoarse();
  // Reset cached enrichment when the body swaps to different diff contents. Keep
  // the viewport-entry flag: an already-visible sentinel does not emit another
  // intersection change when only the diff hunk identity changes.
  useEffect(() => {
    enrichmentStatusRef.current = "idle";
    setEnrichment({ status: "idle" });
    setHasLoadedDeletedDiff(false);
    setContextRequestVersion(0);
  }, [fileContentPlan.identity, isImageCard, isSvgCard]);
  useEffect(() => {
    if (isBodyVisible) {
      setHasBodyEnteredViewport(true);
    }
  }, [isBodyVisible]);
  // The deleted-file gate defers the expensive text-diff renderer (and the old
  // file fetch behind it) until the user asks for it. Image/SVG previews load
  // on viewport entry like added/modified images, so the header size and
  // preview appear without a "Load diff" step.
  const shouldGateDeletedDiff =
    isDeletedFile && !isImageCard && !isSvgCard && !hasLoadedDeletedDiff;
  const shouldRenderDiffView =
    hasBodyEnteredViewport && !isRendering && !shouldGateDeletedDiff;
  // Image and SVG cards cannot render anything without the file contents, so
  // they fetch on viewport entry. Text cards render from the patch alone; their
  // contents are only fetched once context expansion is requested.
  const needsContentsToRender = isImageCard || isSvgCard;
  const canExpandContext =
    !needsContentsToRender &&
    onRequestFileContents !== undefined &&
    patchText !== undefined &&
    fileDiff.hunks.length > 0 &&
    canExpandContextForChangeKind(changeKind);
  const shouldFetchContents =
    shouldRenderDiffView &&
    (needsContentsToRender || (canExpandContext && contextRequestVersion > 0));
  // Fine-pointer devices keep the zero-click expand-context experience: once
  // the card is renderable, request the contents during idle time. Coarse
  // pointers (phones, tablets) wait for the explicit affordance.
  useEffect(() => {
    if (
      isPointerCoarse ||
      !shouldRenderDiffView ||
      !canExpandContext ||
      contextRequestVersion > 0
    ) {
      return;
    }
    return scheduleIdleWork(() => {
      setContextRequestVersion((version) => (version === 0 ? 1 : version));
    });
  }, [
    canExpandContext,
    contextRequestVersion,
    isPointerCoarse,
    shouldRenderDiffView,
  ]);
  // Fire the fetch once the diff view is actually renderable and the contents
  // are wanted. Effect deps deliberately exclude `onRequestFileContents` (we
  // read the latest via the ref) so stable visibility doesn't re-trigger when
  // the panel re-renders.
  useEffect(() => {
    if (!shouldFetchContents || enrichmentStatusRef.current !== "idle") {
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
        const enrichedFileDiff = enrichGitDiffFileForContext({
          fileDiff,
          oldFile: oldResult.file,
          newFile: newResult.file,
          patchText,
        });
        if (isSvgCard) {
          enrichmentStatusRef.current = "ready-svg";
          setEnrichment({
            status: "ready-svg",
            fileDiff: enrichedFileDiff,
            oldImageUrl: svgTextToDataUrl(oldResult.file.contents),
            newImageUrl: svgTextToDataUrl(newResult.file.contents),
          });
          return;
        }
        enrichmentStatusRef.current = "ready";
        setEnrichment({
          status: "ready",
          fileDiff: enrichedFileDiff,
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
  }, [
    contextRequestVersion,
    fileContentPlan,
    fileDiff,
    isSvgCard,
    patchText,
    shouldFetchContents,
  ]);

  const requestContextExpansion = useCallback(() => {
    // A retry after a failed fetch must clear the terminal error first so the
    // fetch effect sees an idle slot when the version bump re-runs it.
    if (enrichmentStatusRef.current === "error") {
      enrichmentStatusRef.current = "idle";
      setEnrichment({ status: "idle" });
    }
    setContextRequestVersion((version) => version + 1);
  }, []);
  const contextExpansionStatus = getDiffContextExpansionStatus({
    canExpandContext,
    contextRequested: contextRequestVersion > 0,
    enrichmentStatus: enrichment.status,
  });
  const contextExpansion = useMemo<DiffContextExpansionState>(
    () => ({ status: contextExpansionStatus, request: requestContextExpansion }),
    [contextExpansionStatus, requestContextExpansion],
  );

  const enrichedFileDiff = useMemo<ParsedGitDiffFile>(() => {
    if (enrichment.status !== "ready" && enrichment.status !== "ready-svg") {
      return fileDiff;
    }
    return enrichment.fileDiff;
  }, [fileDiff, enrichment]);

  const loadDeletedDiff = useCallback(() => {
    setHasLoadedDeletedDiff(true);
    setHasBodyEnteredViewport(true);
  }, []);

  const imageSizeStat =
    isImageCard && enrichment.status === "ready-image"
      ? getGitDiffCardImageSizeStat(enrichment, changeKind)
      : null;

  return {
    bodySentinelRef,
    enrichment,
    enrichedFileDiff,
    fileDiffLabel,
    isImageCard,
    isSvgPreviewCard: isSvgCard,
    shouldGateDeletedDiff,
    shouldRenderDiffView,
    loadDeletedDiff,
    imageSizeStat,
    contextExpansion,
    patchText,
  };
}

function getDiffContextExpansionStatus({
  canExpandContext,
  contextRequested,
  enrichmentStatus,
}: {
  canExpandContext: boolean;
  contextRequested: boolean;
  enrichmentStatus: DiffFileEnrichmentState["status"];
}): DiffContextExpansionStatus {
  if (!canExpandContext) return "unavailable";
  switch (enrichmentStatus) {
    case "idle":
      return contextRequested ? "loading" : "idle";
    case "loading":
      return "loading";
    case "ready":
      return "ready";
    case "error":
      return "error";
    case "ready-image":
    case "ready-svg":
    case "unavailable":
      return "unavailable";
    default: {
      const _exhaustive: never = enrichmentStatus;
      return _exhaustive;
    }
  }
}

export function GitDiffCardBodySkeleton() {
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

interface GitDiffCardImageBodyProps {
  enrichment: DiffFileEnrichmentState;
  fileDiffLabel: string;
  fitToFrame?: boolean;
}

export interface GitDiffCardImagePreview {
  oldImageUrl: string | null;
  newImageUrl: string | null;
}

function getGitDiffCardImageUrls(
  enrichment: DiffFileEnrichmentState,
): GitDiffCardImagePreview | null {
  if (
    enrichment.status !== "ready-image" &&
    enrichment.status !== "ready-svg"
  ) {
    return null;
  }
  return {
    oldImageUrl: enrichment.oldImageUrl,
    newImageUrl: enrichment.newImageUrl,
  };
}

export function getGitDiffCardImageSizeStat(
  preview: {
    oldSizeBytes: number | null;
    newSizeBytes: number | null;
  },
  changeKind: GitDiffFileChangeKind,
): DiffImageSizeStat | null {
  const addedBytes = changeKind === "deleted" ? null : preview.newSizeBytes;
  const removedBytes = changeKind === "added" ? null : preview.oldSizeBytes;
  if (addedBytes === null && removedBytes === null) return null;
  return { addedBytes, removedBytes };
}

interface GitDiffCardImagePreviewBodyProps {
  preview: GitDiffCardImagePreview;
  fileDiffLabel: string;
  fitToFrame?: boolean;
}

export function GitDiffCardImagePreviewBody({
  preview,
  fileDiffLabel,
  fitToFrame = false,
}: GitDiffCardImagePreviewBodyProps) {
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const imageSides = buildGitDiffCardImageSides(
    preview.oldImageUrl,
    preview.newImageUrl,
  );
  if (imageSides.length === 0) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        No preview available for this image.
      </div>
    );
  }
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
      <div
        className={
          fitToFrame
            ? imageSides.length > 1
              ? "grid grid-cols-1 gap-3 px-3 py-3 sm:grid-cols-2"
              : "grid grid-cols-1 gap-3 px-3 py-3"
            : "flex items-start gap-3 px-3 py-3"
        }
      >
        {imageSides.map((side, index) => (
          <figure key={side.url} className="min-w-0">
            <button
              type="button"
              className={
                fitToFrame
                  ? "flex h-64 w-full cursor-zoom-in items-center justify-center rounded-md border border-border bg-surface-recessed p-3"
                  : "block max-w-full cursor-zoom-in"
              }
              onClick={() => setExpandedImageIndex(index)}
            >
              <img
                src={side.url}
                alt={getGitDiffCardImageAlt(fileDiffLabel, side)}
                style={IMAGE_TRANSPARENCY_CHECKER_STYLE}
                className={
                  fitToFrame
                    ? "block h-full w-full object-contain"
                    : "block max-h-80 max-w-full rounded-md border border-border object-contain"
                }
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

function GitDiffCardImageBody({
  enrichment,
  fileDiffLabel,
  fitToFrame = false,
}: GitDiffCardImageBodyProps) {
  if (enrichment.status === "idle" || enrichment.status === "loading") {
    return <GitDiffCardBodySkeleton />;
  }
  const preview = getGitDiffCardImageUrls(enrichment);
  if (preview === null) {
    return (
      <div className="px-3 py-3 text-xs text-muted-foreground">
        No preview available for this image.
      </div>
    );
  }
  return (
    <GitDiffCardImagePreviewBody
      preview={preview}
      fileDiffLabel={fileDiffLabel}
      fitToFrame={fitToFrame}
    />
  );
}

interface GitDiffCardSvgBodyProps {
  displayMode: GitDiffCardSvgDisplayMode;
  enrichment: DiffFileEnrichmentState;
  fileDiff: ParsedGitDiffFile;
  fileDiffLabel: string;
  patchText: string | undefined;
  presentation: DiffPresentation;
  expansionLineCount: number | undefined;
  onSelectionAddToChat?: (text: string) => void;
}

function GitDiffCardSvgBody({
  displayMode,
  enrichment,
  fileDiff,
  fileDiffLabel,
  patchText,
  presentation,
  expansionLineCount,
  onSelectionAddToChat,
}: GitDiffCardSvgBodyProps) {
  return displayMode === "preview" ? (
    <GitDiffCardImageBody
      enrichment={enrichment}
      fileDiffLabel={fileDiffLabel}
      fitToFrame
    />
  ) : (
    <DiffHost
      file={fileDiff}
      patchText={patchText}
      {...presentation}
      expansionLineCount={expansionLineCount}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}

interface GitDiffCardBodyProps {
  state: GitDiffCardBodyState;
  presentation: DiffPresentation;
  svgDisplayMode: GitDiffCardSvgDisplayMode;
  /**
   * Whether the surrounding card reserves a collapse-chevron gutter. The deleted
   * file message aligns to that gutter so its text lines up with the diff body.
   */
  reservesCollapseGutter: boolean;
  onSelectionAddToChat?: (text: string) => void;
}

/**
 * The single shared diff-card body for both the timeline ({@link GitDiffCard})
 * and the diff tab (`DiffFileCard`). It owns everything around the text diff —
 * the lazy enrichment that unlocks context expansion, the deleted-file load
 * gate, the in-viewport render skeleton, and inline `<img>` previews for binary
 * image changes or SVGs — and hands the text diff itself to
 * {@link DiffHost}, so an `experimental_diffRenderer` replacement covers this
 * surface too. The data layer lives in {@link useGitDiffCardBody}; both callers
 * feed its result in as `state` so the card can also read the image header stat
 * synchronously.
 */
export function GitDiffCardBody({
  state,
  presentation,
  svgDisplayMode,
  reservesCollapseGutter,
  onSelectionAddToChat,
}: GitDiffCardBodyProps) {
  const {
    bodySentinelRef,
    enrichment,
    enrichedFileDiff,
    fileDiffLabel,
    isImageCard,
    isSvgPreviewCard,
    shouldGateDeletedDiff,
    shouldRenderDiffView,
    loadDeletedDiff,
    contextExpansion,
    patchText,
  } = state;
  // pierre renders an empty diff when it gets an expansion budget for a
  // hunk-only patch, so only a card that can fetch full contents sends one.
  // The timeline never can; the diff panel can, through its fetcher.
  const expansionLineCount =
    contextExpansion.status === "unavailable"
      ? undefined
      : DIFF_EXPANSION_LINE_COUNT;

  return (
    <div
      ref={bodySentinelRef}
      className="overflow-hidden rounded-b-lg bg-background"
      style={GIT_DIFF_CARD_BODY_STYLE}
    >
      {shouldGateDeletedDiff ? (
        <div className="flex items-center py-3 pl-2 pr-3 text-xs text-muted-foreground">
          {reservesCollapseGutter ? (
            <span aria-hidden className="w-8 shrink-0" />
          ) : null}
          <span className="pl-[1ch]">
            <span>This file was deleted.</span>{" "}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs underline underline-offset-4 hover:underline"
              onClick={loadDeletedDiff}
            >
              Load diff
            </Button>
          </span>
        </div>
      ) : !shouldRenderDiffView ? (
        <GitDiffCardBodySkeleton />
      ) : isImageCard ? (
        <GitDiffCardImageBody
          enrichment={enrichment}
          fileDiffLabel={fileDiffLabel}
        />
      ) : isSvgPreviewCard ? (
        <GitDiffCardSvgBody
          displayMode={svgDisplayMode}
          enrichment={enrichment}
          fileDiff={enrichedFileDiff}
          fileDiffLabel={fileDiffLabel}
          patchText={patchText}
          presentation={presentation}
          expansionLineCount={expansionLineCount}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      ) : (
        <>
          <DiffHost
            file={enrichedFileDiff}
            patchText={patchText}
            {...presentation}
            expansionLineCount={expansionLineCount}
            fallback={<GitDiffCardBodySkeleton />}
            onSelectionAddToChat={onSelectionAddToChat}
          />
          <GitDiffCardContextExpansionFooter
            contextExpansion={contextExpansion}
            reservesCollapseGutter={reservesCollapseGutter}
          />
        </>
      )}
    </div>
  );
}

interface GitDiffCardContextExpansionFooterProps {
  contextExpansion: DiffContextExpansionState;
  reservesCollapseGutter: boolean;
}

/**
 * The on-demand "Expand context" row under a text diff. Once the contents are
 * in (`ready`) pierre renders its own expand buttons between hunks, so the row
 * retires; when there is nothing to expand (`unavailable`) it never shows.
 */
function GitDiffCardContextExpansionFooter({
  contextExpansion,
  reservesCollapseGutter,
}: GitDiffCardContextExpansionFooterProps) {
  const { status, request } = contextExpansion;
  if (status === "unavailable" || status === "ready") {
    return null;
  }
  return (
    <div className="flex items-center py-2 pl-2 pr-3 text-xs text-muted-foreground">
      {reservesCollapseGutter ? (
        <span aria-hidden className="w-8 shrink-0" />
      ) : null}
      <span className="pl-[1ch]">
        {status === "loading" ? (
          <span role="status">Loading context…</span>
        ) : (
          <>
            {status === "error" ? (
              <>
                <span className="text-destructive">
                  Couldn&apos;t load surrounding context.
                </span>{" "}
              </>
            ) : null}
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs underline underline-offset-4 hover:underline"
              onClick={request}
            >
              {status === "error" ? "Retry" : "Expand context"}
            </Button>
          </>
        )}
      </span>
    </div>
  );
}
