import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FileContents } from "@pierre/diffs";
import { FileDiff as DiffView } from "@pierre/diffs/react";
import { useIntersectionObserver } from "usehooks-ts";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  normalizeGitDiffPath,
  type GitDiffFileChangeKind,
  type ParsedGitDiffFile,
} from "./git-diff-parsing";

export type RequestDiffFileContents = (
  path: string,
  side: "old" | "new",
) => Promise<FileContents | null>;

const GIT_DIFF_CARD_VIEW_STYLE = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
} as CSSProperties;

const GIT_DIFF_CARD_BODY_STYLE: CSSProperties = {
  contain: "layout paint style",
  contentVisibility: "auto",
  containIntrinsicSize: "0 600px",
};

// `parseDiffFromFile` in @pierre/diffs splits file contents on this exact regex
// (positive lookbehind on \n) and tags the resulting arrays onto the parsed
// file as `oldLines` / `newLines`. The hunks renderer reads those arrays to know
// what's "expandable" between hunks. We do the same tagging directly on our
// parsed fileDiff once contents load — no need to make the library re-parse from
// scratch.
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
): Promise<FileContents | null> {
  if (source.kind === "empty") {
    return Promise.resolve({ name: source.path, contents: "" });
  }
  return fetcher(source.path, source.side);
}

function splitFileContentsForDiffContext(file: FileContents): string[] {
  if (file.contents.length === 0) return [];
  return file.contents.split(SPLIT_WITH_NEWLINES);
}

export interface GitDiffCardBodyProps {
  fileDiff: ParsedGitDiffFile;
  changeKind: GitDiffFileChangeKind;
  diffViewOptions: Record<string, string | boolean | number>;
  /** When true, replaces the body with a skeleton (queued render slots). */
  isRendering?: boolean;
  /**
   * When provided, the body lazy-fetches `oldFile`/`newFile` the first time it
   * scrolls into view and forwards them to `<DiffView>`, unlocking @pierre/diffs'
   * built-in expand-context buttons in the gaps between hunks. The callback
   * resolves to `null` for binary files so context stays disabled there.
   */
  onRequestFileContents?: RequestDiffFileContents;
  /**
   * Whether the surrounding card reserves a collapse-chevron gutter. The deleted
   * file message aligns to that gutter so its text lines up with the diff body.
   */
  reservesCollapseGutter: boolean;
}

/**
 * The diff card's body: the lazily-enriched `@pierre/diffs` `FileDiff` plus the
 * deleted-file load gate and the in-viewport render skeleton. Shared by the
 * parsed-patch `GitDiffCard` (timeline + legacy) and the tiered `DiffFileCard`
 * (diff tab) so there is exactly one diff renderer + context-expansion path.
 */
export function GitDiffCardBody({
  fileDiff,
  changeKind,
  diffViewOptions,
  isRendering = false,
  onRequestFileContents,
  reservesCollapseGutter,
}: GitDiffCardBodyProps) {
  const isDeletedFile = changeKind === "deleted";
  const fileDiffOptions = useMemo(
    () => ({ ...diffViewOptions, disableFileHeader: true }),
    [diffViewOptions],
  );
  const fileContentPlan = useMemo(
    () => buildDiffFileContentPlan(fileDiff, changeKind),
    [fileDiff, changeKind],
  );
  const { ref: bodySentinelRef, isIntersecting: isBodyVisible } =
    useIntersectionObserver({
      initialIsIntersecting: false,
      rootMargin: "200px",
    });
  // The parent's `onRequestFileContents` may be a fresh function reference on
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
  }, [fileContentPlan.identity]);
  useEffect(() => {
    if (isBodyVisible) {
      setHasBodyEnteredViewport(true);
    }
  }, [isBodyVisible]);
  const shouldGateDeletedDiff = isDeletedFile && !hasLoadedDeletedDiff;
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
      .then(([oldFile, newFile]) => {
        if (cancelled) return;
        if (!oldFile || !newFile) {
          enrichmentStatusRef.current = "unavailable";
          setEnrichment({ status: "unavailable" });
          return;
        }
        enrichmentStatusRef.current = "ready";
        setEnrichment({
          status: "ready",
          oldLines: splitFileContentsForDiffContext(oldFile),
          newLines: splitFileContentsForDiffContext(newFile),
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
        <div className="space-y-1.5 px-3 py-3">
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-[96%] rounded-sm" />
          <Skeleton className="h-3 w-[93%] rounded-sm" />
          <Skeleton className="h-3 w-[90%] rounded-sm" />
          <Skeleton className="h-3 w-[87%] rounded-sm" />
          <Skeleton className="h-3 w-[84%] rounded-sm" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="w-full max-w-full" style={GIT_DIFF_CARD_VIEW_STYLE}>
            <DiffView fileDiff={enrichedFileDiff} options={fileDiffOptions} />
          </div>
        </div>
      )}
    </div>
  );
}
