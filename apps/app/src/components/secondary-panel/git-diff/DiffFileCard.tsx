import { memo, useEffect, useMemo, useState } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import type { DiffFileEntry } from "@bb/server-contract";
import {
  GitDiffCardBody,
  useGitDiffCardBody,
  type GitDiffCardSvgDisplayMode,
  type RequestDiffFileContents,
} from "@/components/git-diff/GitDiffCardBody";
import {
  GitDiffCardHeader,
  GitDiffCardRawToggle,
  gitDiffCardHeaderWrapperClass,
  type GitDiffCardHeaderModel,
} from "@/components/git-diff/GitDiffCardHeader";
import {
  isSvgGitDiffFile,
  parseGitDiffFiles,
  type ParsedGitDiffFile,
} from "@/components/git-diff/git-diff-parsing";
import { Button } from "@/components/ui/button.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { DiffPatchState } from "@/hooks/queries/use-environment-diff-patches";
import { cn } from "@/lib/utils";

/**
 * Build the file label for a TOC entry. Renames/copies read as `old -> new`;
 * everything else is just the path.
 */
function formatDiffEntryLabel(entry: DiffFileEntry): string {
  if (
    (entry.changeKind === "renamed" || entry.changeKind === "copied") &&
    entry.previousPath &&
    entry.previousPath !== entry.path
  ) {
    return `${entry.previousPath} -> ${entry.path}`;
  }
  return entry.path;
}

function buildDiffEntryHeaderModel(
  entry: DiffFileEntry,
): GitDiffCardHeaderModel {
  return {
    label: formatDiffEntryLabel(entry),
    path: entry.path,
    openablePath: entry.path,
    changeKind: entry.changeKind,
    insertions: entry.additions,
    deletions: entry.deletions,
  };
}

export interface DiffFileCardProps {
  entry: DiffFileEntry;
  diffViewOptions: Record<string, string | boolean | number>;
  filePathRoot?: string | null;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  /** Patch load state for `auto`/`on_demand` tiers from the patch hook. */
  patchState: DiffPatchState;
  /** Request this file's patch now (used by the `on_demand` "Load diff" CTA). */
  onLoadPatch: () => void;
  /** Re-request after a per-card error. */
  onRetry: () => void;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
}

/**
 * The diff tab's per-file card. Its header always renders from the
 * {@link DiffFileEntry} (so `on_demand` / `too_large` / loading rows show a real
 * header with no patch in hand); its body is gated by the entry's `loadMode`
 * tier:
 *
 * - `auto`: render the parsed patch once it arrives (reusing
 *   {@link GitDiffCardBody}); a `truncated` patch shows a "Show full diff"
 *   affordance; a loaded patch that parses to no renderable file (empty / pure
 *   rename / mode-only) shows a terminal "No renderable diff" notice; while the
 *   patch loads it shows a skeleton.
 * - `on_demand`: header + stat + a "Load diff" button that triggers the fetch.
 * - `too_large`: header + a "too large" notice + a link to open the file.
 *
 * Per-card errors surface a Retry that re-requests just this path.
 */
/**
 * `patchState` is freshly allocated on every parent render, which would defeat
 * `memo`'s default referential check. Compare it by value (and shallow-compare
 * the remaining props) so an unchanged row skips re-rendering its `DiffView`
 * when the panel re-renders on scroll / an unrelated file's patch settling.
 */
function arePatchStatesEqual(a: DiffPatchState, b: DiffPatchState): boolean {
  return (
    a.status === b.status &&
    a.patch === b.patch &&
    a.truncated === b.truncated &&
    a.error === b.error
  );
}

function areDiffFileCardPropsEqual(
  previous: DiffFileCardProps,
  next: DiffFileCardProps,
): boolean {
  return (
    previous.entry === next.entry &&
    previous.diffViewOptions === next.diffViewOptions &&
    previous.filePathRoot === next.filePathRoot &&
    previous.isCollapsed === next.isCollapsed &&
    previous.onToggleCollapsed === next.onToggleCollapsed &&
    previous.onLoadPatch === next.onLoadPatch &&
    previous.onRetry === next.onRetry &&
    previous.onOpenFileInEditor === next.onOpenFileInEditor &&
    previous.onOpenFilePreview === next.onOpenFilePreview &&
    previous.onRequestFileContents === next.onRequestFileContents &&
    arePatchStatesEqual(previous.patchState, next.patchState)
  );
}

export const DiffFileCard = memo(function DiffFileCard({
  entry,
  diffViewOptions,
  filePathRoot,
  isCollapsed,
  onToggleCollapsed,
  patchState,
  onLoadPatch,
  onRetry,
  onOpenFileInEditor,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFileCardProps) {
  const headerModel = useMemo(() => buildDiffEntryHeaderModel(entry), [entry]);
  // The single file's patch, parsed only once it has loaded. The patch hook
  // returns whole-file patch text; we parse just this file (not a blob).
  const parsedFile = useMemo<ParsedGitDiffFile | null>(() => {
    if (patchState.status !== "loaded" || patchState.patch === undefined) {
      return null;
    }
    return parseGitDiffFiles(patchState.patch)[0] ?? null;
  }, [patchState.patch, patchState.status]);
  const [svgDisplayMode, setSvgDisplayMode] =
    useState<GitDiffCardSvgDisplayMode>("preview");
  useEffect(() => {
    setSvgDisplayMode("preview");
  }, [entry.path, entry.previousPath, patchState.patch]);
  const toggleSvgDisplayMode = () => {
    setSvgDisplayMode((currentMode) =>
      currentMode === "preview" ? "raw" : "preview",
    );
  };
  const changedLines = entry.additions + entry.deletions;
  const isBodyHidden = isCollapsed;
  const supportsSvgRawToggle =
    !isBodyHidden &&
    parsedFile !== null &&
    parsedFile.type !== "rename-pure" &&
    onRequestFileContents !== undefined &&
    isSvgGitDiffFile(parsedFile);

  // Detect when this card's sticky header is pinned to the panel top: a
  // zero-height sentinel sits just above the header, so once it scrolls out of
  // the scroll container the header is stuck. When stuck we square the header's
  // top and draw a non-layout top edge — the card's own rounded top has
  // scrolled off-screen by then, and a rounded header top would otherwise show
  // the scrolling diff through its corners. (`overflow-clip` below keeps the
  // bottom rounded; the top can't be fixed by clipping because the rounded
  // corners are the header's own, over live content.)
  const { ref: stickySentinelRef, isIntersecting } = useIntersectionObserver({
    initialIsIntersecting: true,
    threshold: 1,
  });
  const isHeaderStuck = !isIntersecting;

  return (
    // `overflow-clip` clips the header/body to the card's rounded shape so a
    // short file's square-bottomed sticky header can't poke its corners past the
    // card's rounded bottom. `clip` (unlike `hidden`) is NOT a scroll container,
    // so it doesn't capture the sticky header — it still pins to the panel.
    <div className="overflow-clip rounded-lg border border-border bg-background">
      <div ref={stickySentinelRef} className="h-0" />
      <div
        className={cn(
          gitDiffCardHeaderWrapperClass({
            stickyHeader: true,
            isBodyHidden,
            isStuck: isHeaderStuck,
            showStuckHeaderEdge: false,
          }),
          "-mt-px border-t border-border",
        )}
      >
        <GitDiffCardHeader
          model={headerModel}
          previousPath={entry.previousPath}
          filePathRoot={filePathRoot}
          onOpenFileInEditor={onOpenFileInEditor}
          onOpenFilePreview={onOpenFilePreview}
          isCollapsed={isCollapsed}
          onToggleCollapsed={onToggleCollapsed}
          hasChanges
          actionSlot={
            supportsSvgRawToggle ? (
              <GitDiffCardRawToggle
                fileLabel={headerModel.label}
                isRaw={svgDisplayMode === "raw"}
                onToggle={toggleSvgDisplayMode}
              />
            ) : undefined
          }
        />
      </div>
      {isBodyHidden ? null : (
        <DiffFileCardBody
          entry={entry}
          changedLines={changedLines}
          diffViewOptions={diffViewOptions}
          parsedFile={parsedFile}
          patchState={patchState}
          svgDisplayMode={svgDisplayMode}
          onLoadPatch={onLoadPatch}
          onRetry={onRetry}
          onOpenFilePreview={onOpenFilePreview}
          onRequestFileContents={onRequestFileContents}
        />
      )}
    </div>
  );
}, areDiffFileCardPropsEqual);

interface DiffFileCardBodyProps {
  entry: DiffFileEntry;
  changedLines: number;
  diffViewOptions: Record<string, string | boolean | number>;
  parsedFile: ParsedGitDiffFile | null;
  patchState: DiffPatchState;
  svgDisplayMode: GitDiffCardSvgDisplayMode;
  onLoadPatch: () => void;
  onRetry: () => void;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
}

const DIFF_FILE_CARD_NOTICE_CLASS =
  "flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-3 text-xs text-muted-foreground";

function DiffFileCardBody({
  entry,
  changedLines,
  diffViewOptions,
  parsedFile,
  patchState,
  svgDisplayMode,
  onLoadPatch,
  onRetry,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFileCardBodyProps) {
  if (patchState.status === "error") {
    return (
      <div className={DIFF_FILE_CARD_NOTICE_CLASS}>
        <span className="text-destructive">
          {patchState.error ?? "Failed to load this file's diff."}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs underline underline-offset-4 hover:underline"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (entry.loadMode === "too_large") {
    return (
      <div className={DIFF_FILE_CARD_NOTICE_CLASS}>
        <span>
          Too large to display ({changedLines.toLocaleString()} changed lines).
        </span>
        {onOpenFilePreview ? (
          <FilePathLink
            path={entry.path}
            displayName="Open file"
            onClick={() => onOpenFilePreview(entry.path)}
            className="text-xs underline underline-offset-4"
          />
        ) : null}
      </div>
    );
  }

  if (entry.loadMode === "on_demand" && patchState.status === "idle") {
    return (
      <div className={DIFF_FILE_CARD_NOTICE_CLASS}>
        <span>
          {entry.binary
            ? "Binary file."
            : `${changedLines.toLocaleString()} changed lines.`}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs underline underline-offset-4 hover:underline"
          onClick={onLoadPatch}
        >
          Load diff
        </Button>
      </div>
    );
  }

  if (parsedFile === null) {
    // A `loaded` patch that parses to no renderable file (empty patch / parse
    // error — common for pure renames and mode-only changes) is terminal: show
    // a notice with the same open-file affordance the `too_large` tier uses,
    // never a skeleton that would spin forever. The skeleton is reserved for the
    // genuinely-not-yet-loaded states below.
    if (patchState.status === "loaded") {
      return (
        <div className={DIFF_FILE_CARD_NOTICE_CLASS}>
          <span>No renderable diff for this file.</span>
          {onOpenFilePreview ? (
            <FilePathLink
              path={entry.path}
              displayName="Open file"
              onClick={() => onOpenFilePreview(entry.path)}
              className="text-xs underline underline-offset-4"
            />
          ) : null}
        </div>
      );
    }

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

  return (
    <DiffFileCardRenderedBody
      entry={entry}
      parsedFile={parsedFile}
      patchText={patchState.truncated ? undefined : patchState.patch}
      diffViewOptions={diffViewOptions}
      svgDisplayMode={svgDisplayMode}
      truncated={patchState.truncated ?? false}
      onOpenFilePreview={onOpenFilePreview}
      onRequestFileContents={onRequestFileContents}
    />
  );
}

interface DiffFileCardRenderedBodyProps {
  entry: DiffFileEntry;
  parsedFile: ParsedGitDiffFile;
  patchText?: string;
  diffViewOptions: Record<string, string | boolean | number>;
  svgDisplayMode: GitDiffCardSvgDisplayMode;
  truncated: boolean;
  onOpenFilePreview?: (path: string) => void;
  onRequestFileContents?: RequestDiffFileContents;
}

/**
 * The diff tab's loaded-and-parsed body: the shared {@link GitDiffCardBody}
 * (text diff with context expansion, or an inline image preview for binary image
 * changes) plus the truncated-patch "Show full diff" affordance. Split out so
 * {@link useGitDiffCardBody} is only called once a renderable parsed file exists
 * (the gate/notice branches above have no file to enrich).
 */
function DiffFileCardRenderedBody({
  entry,
  parsedFile,
  patchText,
  diffViewOptions,
  svgDisplayMode,
  truncated,
  onOpenFilePreview,
  onRequestFileContents,
}: DiffFileCardRenderedBodyProps) {
  const bodyState = useGitDiffCardBody({
    fileDiff: parsedFile,
    changeKind: entry.changeKind,
    isRendering: false,
    onRequestFileContents,
    patchText,
  });
  return (
    <>
      <GitDiffCardBody
        state={bodyState}
        diffViewOptions={diffViewOptions}
        svgDisplayMode={svgDisplayMode}
        reservesCollapseGutter
      />
      {truncated ? (
        <div className={DIFF_FILE_CARD_NOTICE_CLASS}>
          <span>This diff was truncated for display.</span>
          {onOpenFilePreview ? (
            <FilePathLink
              path={entry.path}
              displayName="Show full diff"
              onClick={() => onOpenFilePreview(entry.path)}
              className="text-xs underline underline-offset-4"
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
