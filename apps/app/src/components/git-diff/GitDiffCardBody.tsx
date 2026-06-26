import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  FileContents,
  FileDiffOptions,
  SelectedLineRange,
  SelectionSide,
} from "@pierre/diffs";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { useIntersectionObserver } from "usehooks-ts";
import { Button } from "@/components/ui/button.js";
import { usePierreLineSelectionActions } from "./PierreLineSelectionActions.js";
import {
  getWrappedImageIndex,
  ImageLightbox,
  IMAGE_TRANSPARENCY_CHECKER_STYLE,
} from "@/components/ui/image-lightbox.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  formatGitDiffFileLabel,
  enrichGitDiffFileForContext,
  isImageGitDiffFile,
  isSvgGitDiffFile,
  normalizeGitDiffPath,
  type GitDiffFileChangeKind,
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

const GIT_DIFF_CARD_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

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
    isImageGitDiffFile(fileDiff)
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

function getImageSizeStat(
  enrichment: DiffFileEnrichmentState,
  changeKind: GitDiffFileChangeKind,
): DiffImageSizeStat | null {
  if (enrichment.status !== "ready-image") return null;
  return getGitDiffCardImageSizeStat(enrichment, changeKind);
}

export interface UseGitDiffCardBodyArgs {
  fileDiff: ParsedGitDiffFile;
  changeKind: GitDiffFileChangeKind;
  /** When true, holds the body at a skeleton (queued render slots). */
  isRendering: boolean;
  onRequestFileContents: RequestDiffFileContents | undefined;
  /** Raw per-file patch text, used to reparse with full old/new contents. */
  patchText?: string;
}

export interface GitDiffCardBodyState {
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
  // Reset cached enrichment when the body swaps to different diff contents. Keep
  // the viewport-entry flag: an already-visible sentinel does not emit another
  // intersection change when only the diff hunk identity changes.
  useEffect(() => {
    enrichmentStatusRef.current = "idle";
    setEnrichment({ status: "idle" });
    setHasLoadedDeletedDiff(false);
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
  }, [fileContentPlan, fileDiff, isSvgCard, patchText, shouldRenderDiffView]);

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

  const imageSizeStat = isImageCard
    ? getImageSizeStat(enrichment, changeKind)
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
  };
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

export interface GitDiffCardImagePreviewBodyProps {
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

interface GitDiffCardRawDiffBodyProps {
  fileDiff: ParsedGitDiffFile;
  fileDiffOptions: Record<string, string | boolean | number>;
  onSelectionAddToChat?: (text: string) => void;
}

function formatLineRange(startLineNumber: number, endLineNumber: number) {
  return startLineNumber === endLineNumber
    ? String(startLineNumber)
    : `${startLineNumber}-${endLineNumber}`;
}

function getDiffLineText({
  fileDiff,
  lineNumber,
  side,
}: {
  fileDiff: ParsedGitDiffFile;
  lineNumber: number;
  side?: SelectionSide;
}): string | null {
  if (side === undefined) {
    return (
      getDiffLineText({ fileDiff, lineNumber, side: "additions" }) ??
      getDiffLineText({ fileDiff, lineNumber, side: "deletions" })
    );
  }

  const lines =
    side === "additions" ? fileDiff.additionLines : fileDiff.deletionLines;
  for (const hunk of fileDiff.hunks) {
    const hunkStart =
      side === "additions" ? hunk.additionStart : hunk.deletionStart;
    const hunkCount =
      side === "additions" ? hunk.additionCount : hunk.deletionCount;
    if (lineNumber < hunkStart || lineNumber >= hunkStart + hunkCount) {
      continue;
    }
    const lineIndex =
      (side === "additions" ? hunk.additionLineIndex : hunk.deletionLineIndex) +
      (lineNumber - hunkStart);
    return lines[lineIndex] ?? null;
  }
  return lines[lineNumber - 1] ?? null;
}

function getDiffSelectionPath(
  fileDiff: ParsedGitDiffFile,
  side: SelectionSide,
) {
  if (side === "deletions") {
    return normalizeGitDiffPath(fileDiff.prevName) ?? fileDiff.name;
  }
  return normalizeGitDiffPath(fileDiff.name) ?? fileDiff.name;
}

function buildSingleSideDiffSelectionText({
  endLineNumber,
  fileDiff,
  side,
  startLineNumber,
}: {
  endLineNumber: number;
  fileDiff: ParsedGitDiffFile;
  side: SelectionSide;
  startLineNumber: number;
}): string | null {
  const start = Math.min(startLineNumber, endLineNumber);
  const end = Math.max(startLineNumber, endLineNumber);
  const selectedLines: string[] = [];
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    const lineText = getDiffLineText({ fileDiff, lineNumber, side });
    if (lineText !== null) {
      selectedLines.push(lineText);
    }
  }
  const selectedText = selectedLines.join("\n").trimEnd();
  if (selectedText.trim().length === 0) {
    return null;
  }
  const sideLabel = side === "additions" ? "new" : "old";
  return `${getDiffSelectionPath(fileDiff, side)}:${formatLineRange(
    start,
    end,
  )} (${sideLabel})\n${selectedText}`;
}

function buildDiffLineSelectionText({
  fileDiff,
  range,
}: {
  fileDiff: ParsedGitDiffFile;
  range: SelectedLineRange;
}): string | null {
  const startSide = range.side ?? range.endSide ?? "additions";
  const endSide = range.endSide ?? startSide;
  if (startSide === endSide) {
    return buildSingleSideDiffSelectionText({
      fileDiff,
      side: startSide,
      startLineNumber: range.start,
      endLineNumber: range.end,
    });
  }

  const selections = [
    buildSingleSideDiffSelectionText({
      fileDiff,
      side: startSide,
      startLineNumber: range.start,
      endLineNumber: range.start,
    }),
    buildSingleSideDiffSelectionText({
      fileDiff,
      side: endSide,
      startLineNumber: range.end,
      endLineNumber: range.end,
    }),
  ].filter((selection) => selection !== null);
  return selections.length > 0 ? selections.join("\n\n") : null;
}

function getDiffShadowRoots(containerElement: HTMLElement | null) {
  if (containerElement === null) {
    return [];
  }
  return Array.from(containerElement.querySelectorAll("diffs-container"))
    .map((container) => container.shadowRoot)
    .filter((root) => root !== null);
}

function getDiffDomLineSide(lineElement: HTMLElement): SelectionSide {
  const codeElement = lineElement.closest("[data-deletions],[data-additions]");
  if (codeElement?.hasAttribute("data-deletions")) {
    return "deletions";
  }
  if (codeElement?.hasAttribute("data-additions")) {
    return "additions";
  }
  return lineElement.dataset.lineType === "change-deletion"
    ? "deletions"
    : "additions";
}

function getDiffDomLineNumber(lineElement: HTMLElement): number | null {
  const lineNumber = Number.parseInt(lineElement.dataset.line ?? "", 10);
  return Number.isFinite(lineNumber) ? lineNumber : null;
}

function getDiffDomLineText(lineElement: HTMLElement): string {
  return (lineElement.textContent ?? "").trimEnd();
}

function buildDiffDomSelectionSection({
  fileDiff,
  range,
  rows,
  side,
}: {
  fileDiff: ParsedGitDiffFile;
  range: SelectedLineRange;
  rows: HTMLElement[];
  side: SelectionSide;
}): string | null {
  const selectedText = rows
    .map(getDiffDomLineText)
    .filter((text) => text.trim().length > 0)
    .join("\n")
    .trimEnd();
  if (selectedText.trim().length === 0) {
    return null;
  }

  const lineNumbers = rows
    .map(getDiffDomLineNumber)
    .filter((lineNumber) => lineNumber !== null);
  const start =
    lineNumbers.length > 0
      ? Math.min(...lineNumbers)
      : Math.min(range.start, range.end);
  const end =
    lineNumbers.length > 0
      ? Math.max(...lineNumbers)
      : Math.max(range.start, range.end);
  const sideLabel = side === "additions" ? "new" : "old";
  return `${getDiffSelectionPath(fileDiff, side)}:${formatLineRange(
    start,
    end,
  )} (${sideLabel})\n${selectedText}`;
}

function buildDiffDomSelectionText({
  containerElement,
  fileDiff,
  range,
}: {
  containerElement: HTMLElement | null;
  fileDiff: ParsedGitDiffFile;
  range: SelectedLineRange;
}): string | null {
  if (containerElement === null) {
    return null;
  }

  const selectedRows: HTMLElement[] = [];
  const seenRows = new Set<string>();
  for (const root of getDiffShadowRoots(containerElement)) {
    for (const row of root.querySelectorAll<HTMLElement>(
      "[data-selected-line][data-line]",
    )) {
      const text = getDiffDomLineText(row);
      if (text.trim().length === 0) {
        continue;
      }
      const lineIndex = row.dataset.lineIndex ?? "";
      const side = getDiffDomLineSide(row);
      const key = `${lineIndex}:${side}:${text}`;
      if (seenRows.has(key)) {
        continue;
      }
      seenRows.add(key);
      selectedRows.push(row);
    }
  }

  if (selectedRows.length === 0) {
    return null;
  }

  const deletionRows = selectedRows.filter(
    (row) => getDiffDomLineSide(row) === "deletions",
  );
  const additionRows = selectedRows.filter(
    (row) => getDiffDomLineSide(row) === "additions",
  );
  const sections = [
    deletionRows.length === 0
      ? null
      : buildDiffDomSelectionSection({
          fileDiff,
          range,
          rows: deletionRows,
          side: "deletions",
        }),
    additionRows.length === 0
      ? null
      : buildDiffDomSelectionSection({
          fileDiff,
          range,
          rows: additionRows,
          side: "additions",
        }),
  ].filter((section) => section !== null);

  return sections.length > 0 ? sections.join("\n\n") : null;
}

function GitDiffCardRawDiffBody({
  fileDiff,
  fileDiffOptions,
  onSelectionAddToChat,
}: GitDiffCardRawDiffBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buildSelectionText = useCallback(
    (range: SelectedLineRange) =>
      buildDiffLineSelectionText({ fileDiff, range }),
    [fileDiff],
  );
  const buildFallbackSelectionText = useCallback(
    ({
      containerElement,
      range,
    }: {
      containerElement: HTMLElement | null;
      range: SelectedLineRange;
    }) => buildDiffDomSelectionText({ containerElement, fileDiff, range }),
    [fileDiff],
  );
  const lineSelectionActions = usePierreLineSelectionActions({
    buildFallbackSelectionText,
    buildSelectionText,
    containerRef,
    enabled: onSelectionAddToChat !== undefined,
    onSelectionAddToChat,
  });
  const options = useMemo<FileDiffOptions<undefined>>(
    () => ({
      ...fileDiffOptions,
      enableGutterUtility: onSelectionAddToChat !== undefined,
      enableLineSelection: onSelectionAddToChat !== undefined,
      lineHoverHighlight:
        onSelectionAddToChat === undefined ? "disabled" : "number",
      onGutterUtilityClick:
        onSelectionAddToChat === undefined
          ? undefined
          : lineSelectionActions.onGutterUtilityClick,
      onLineSelectionChange: lineSelectionActions.onLineSelectionChange,
      onLineSelectionEnd: lineSelectionActions.onLineSelectionEnd,
      onLineSelectionStart: lineSelectionActions.onLineSelectionStart,
    }),
    [
      fileDiffOptions,
      lineSelectionActions.onGutterUtilityClick,
      lineSelectionActions.onLineSelectionChange,
      lineSelectionActions.onLineSelectionEnd,
      lineSelectionActions.onLineSelectionStart,
      onSelectionAddToChat,
    ],
  );
  return (
    <div
      ref={containerRef}
      className="overflow-x-auto"
      onPointerDownCapture={lineSelectionActions.onPointerDownCapture}
      onPointerMoveCapture={lineSelectionActions.onPointerMoveCapture}
      onPointerUpCapture={lineSelectionActions.onPointerUpCapture}
    >
      <div className="w-full max-w-full" style={GIT_DIFF_CARD_VIEW_STYLE}>
        <DiffView
          fileDiff={fileDiff}
          options={options}
          selectedLines={lineSelectionActions.selectedRange}
        />
      </div>
      {lineSelectionActions.menu}
    </div>
  );
}

interface GitDiffCardSvgBodyProps {
  displayMode: GitDiffCardSvgDisplayMode;
  enrichment: DiffFileEnrichmentState;
  fileDiff: ParsedGitDiffFile;
  fileDiffLabel: string;
  fileDiffOptions: Record<string, string | boolean | number>;
  onSelectionAddToChat?: (text: string) => void;
}

function GitDiffCardSvgBody({
  displayMode,
  enrichment,
  fileDiff,
  fileDiffLabel,
  fileDiffOptions,
  onSelectionAddToChat,
}: GitDiffCardSvgBodyProps) {
  return displayMode === "preview" ? (
    <GitDiffCardImageBody
      enrichment={enrichment}
      fileDiffLabel={fileDiffLabel}
      fitToFrame
    />
  ) : (
    <GitDiffCardRawDiffBody
      fileDiff={fileDiff}
      fileDiffOptions={fileDiffOptions}
      onSelectionAddToChat={onSelectionAddToChat}
    />
  );
}

export interface GitDiffCardBodyProps {
  state: GitDiffCardBodyState;
  diffViewOptions: Record<string, string | boolean | number>;
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
 * and the diff tab (`DiffFileCard`). It renders the lazily-enriched
 * `@pierre/diffs` `FileDiff` (with context expansion), the deleted-file load
 * gate, the in-viewport render skeleton, and inline `<img>` previews for binary
 * image changes or SVGs. The data layer lives in {@link useGitDiffCardBody};
 * both callers feed its result in as `state` so the card can also read the image
 * header stat synchronously.
 */
export function GitDiffCardBody({
  state,
  diffViewOptions,
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
  } = state;
  const fileDiffOptions = useMemo(
    () => ({ ...diffViewOptions, disableFileHeader: true }),
    [diffViewOptions],
  );

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
          fileDiffOptions={fileDiffOptions}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      ) : (
        <GitDiffCardRawDiffBody
          fileDiff={enrichedFileDiff}
          fileDiffOptions={fileDiffOptions}
          onSelectionAddToChat={onSelectionAddToChat}
        />
      )}
    </div>
  );
}
