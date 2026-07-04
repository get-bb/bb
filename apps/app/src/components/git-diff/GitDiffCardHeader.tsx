import { useMemo, type ReactNode } from "react";
import type { GitDiffFileChangeKind } from "@bb/server-contract";
import { CopyButton } from "@/components/ui/copy-button.js";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { Icon } from "@/components/ui/icon.js";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { cn } from "@/lib/utils";
import type { DiffImageSizeStat } from "./GitDiffCardBody";

/**
 * Explicit, patch-independent description of a diff card's header. Both the
 * parsed-patch card ({@link GitDiffCard}) and the tiered TOC card
 * (`DiffFileCard`) build one of these — the latter directly from a
 * `DiffFileEntry`, so it can render a header for `on_demand` / `too_large` /
 * loading rows that have no parsed patch in hand.
 */
export interface GitDiffCardHeaderModel {
  /** Human label for aria/title text (e.g. `old -> new` for renames). */
  label: string;
  /** Current path used as the file-link target and copy/open path. */
  path: string;
  /** Path to open in the editor / preview; null when nothing is openable. */
  openablePath: string | null;
  changeKind: GitDiffFileChangeKind;
  insertions: number;
  deletions: number;
}

export interface GitDiffCardHeaderProps {
  model: GitDiffCardHeaderModel;
  /** Rename/copy source path; null when not a rename or copy. */
  previousPath: string | null;
  /**
   * Working-tree provenance. Only the diff sidepane knows this; passing it
   * switches the header into its dense treatment (dimmed directory, always-shown
   * filename, and a far-right porcelain status glyph).
   */
  origin?: "tracked" | "untracked";
  filePathRoot?: string | null;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  /**
   * Collapse affordance. When both `isCollapsed` and `onToggleCollapsed` are
   * provided the header renders a chevron and reserves its column; omit both to
   * render no collapse control (timeline rows collapse at the row level).
   */
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Whether there is body content to expand. A pure rename / empty file has no
   * hunks, so the chevron is disabled even when collapse is otherwise
   * supported.
   */
  hasChanges: boolean;
  /**
   * Replaces the right-side `+/-` line tally. Image cards pass their byte-size
   * delta here (rendered via {@link GitDiffCardImageSizeStat}) since an image
   * swap has no line counts to tally.
   */
  statSlot?: ReactNode;
  /** Small controls rendered beside the stats, such as the SVG raw toggle. */
  actionSlot?: ReactNode;
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

export interface GitDiffCardImageSizeStatProps {
  stat: DiffImageSizeStat;
}

/**
 * Header size indicator for an image card. An image change swaps the whole
 * binary, so rather than netting the two sizes it surfaces them like a text
 * diff's `+/-` tally: the new file's bytes as added, the old file's bytes as
 * removed. Adds show only `+`, deletes only `-`, edits show both.
 */
export function GitDiffCardImageSizeStat({
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

export interface GitDiffCardRawToggleProps {
  fileLabel: string;
  isRaw: boolean;
  onToggle: () => void;
}

export function GitDiffCardRawToggle({
  fileLabel,
  isRaw,
  onToggle,
}: GitDiffCardRawToggleProps) {
  const label = isRaw
    ? `Show image preview for ${fileLabel}`
    : `Show raw SVG diff for ${fileLabel}`;
  return (
    <button
      type="button"
      className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-state-active aria-pressed:text-foreground"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={isRaw}
    >
      <Icon name="Code" aria-hidden className="size-3.5" />
    </button>
  );
}

/**
 * Returns the old/new path pair to render as a `from -> to` rename affordance,
 * or null when the file is not a rename/copy. Renames and copies both carry a
 * distinct source path the user benefits from seeing.
 */
function resolveRenameInfo(
  model: GitDiffCardHeaderModel,
  previousPath: string | null,
): { from: string; to: string } | null {
  if (model.changeKind !== "renamed" && model.changeKind !== "copied") {
    return null;
  }
  if (previousPath && previousPath !== model.path) {
    return { from: previousPath, to: model.path };
  }
  return null;
}

/**
 * Split a path into its directory and basename, keeping the separator on the
 * basename (`apps/foo` + `/bar.ts`) so the filename always shows its leading
 * slash even when the directory is truncated away.
 */
function splitDirBasename(path: string): {
  directory: string;
  basename: string;
} {
  const separator = path.lastIndexOf("/");
  if (separator < 0) {
    return { directory: "", basename: path };
  }
  return {
    directory: path.slice(0, separator),
    basename: path.slice(separator),
  };
}

type PorcelainMark = "plus" | "minus" | "dot";

interface PorcelainStatus {
  mark: PorcelainMark;
  label: string;
  className: string;
}

/** Boxed git-porcelain status glyph + color for a working-tree diff entry. */
function resolvePorcelainStatus(
  changeKind: GitDiffFileChangeKind,
  origin: "tracked" | "untracked",
): PorcelainStatus {
  if (origin === "untracked") {
    return {
      mark: "plus",
      label: "Untracked",
      className: "text-muted-foreground",
    };
  }
  switch (changeKind) {
    case "added":
      return { mark: "plus", label: "Added", className: "text-diff-added" };
    case "deleted":
      return {
        mark: "minus",
        label: "Deleted",
        className: "text-diff-removed",
      };
    case "renamed":
      return { mark: "dot", label: "Renamed", className: "text-warning-text" };
    case "copied":
      return { mark: "dot", label: "Copied", className: "text-warning-text" };
    case "type_changed":
      return {
        mark: "dot",
        label: "Type changed",
        className: "text-warning-text",
      };
    case "modified":
      return { mark: "dot", label: "Modified", className: "text-warning-text" };
  }
}

/**
 * A rounded-square status glyph with an inner plus (added), minus (deleted), or
 * dot (modified). Rendered inline so the box matches the reference exactly
 * rather than depending on the icon set's square variants.
 */
function PorcelainStatusGlyph({ mark, label, className }: PorcelainStatus) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <rect x="2.75" y="2.75" width="10.5" height="10.5" rx="3" />
      {mark !== "dot" ? <line x1="5.5" y1="8" x2="10.5" y2="8" /> : null}
      {mark === "plus" ? <line x1="8" y1="5.5" x2="8" y2="10.5" /> : null}
      {mark === "dot" ? (
        <circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
      ) : null}
    </svg>
  );
}

export function GitDiffCardHeader({
  model,
  previousPath,
  origin,
  filePathRoot,
  onOpenFileInEditor,
  onOpenFilePreview,
  isCollapsed,
  onToggleCollapsed,
  hasChanges,
  statSlot,
  actionSlot,
}: GitDiffCardHeaderProps) {
  const isAddedFile = model.changeKind === "added";
  const isDeletedFile = model.changeKind === "deleted";
  const headerInsertions = isDeletedFile ? 0 : model.insertions;
  const headerDeletions = isAddedFile ? 0 : model.deletions;
  const hideEmptyHeaderStats = isAddedFile || isDeletedFile;
  const renameInfo = useMemo(
    () => resolveRenameInfo(model, previousPath),
    [model, previousPath],
  );
  const openablePath = model.openablePath;
  const copyablePath = openablePath
    ? resolveAbsoluteFilePath({ path: openablePath, rootPath: filePathRoot })
    : null;
  const canOpenFile = Boolean(openablePath);
  const supportsCollapse =
    isCollapsed !== undefined && onToggleCollapsed !== undefined;
  const isDense = origin !== undefined;
  const porcelainStatus = isDense
    ? resolvePorcelainStatus(model.changeKind, origin)
    : null;
  const denseDisplayPath = renameInfo ? renameInfo.to : model.path;
  const { directory: denseDirectory, basename: denseBasename } =
    splitDirBasename(denseDisplayPath);

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center">
        {supportsCollapse ? (
          <button
            type="button"
            className={cn(
              // Width matches the in-diff expand-button's 32px slot so the
              // header chevron occupies the same column as the expand chevrons
              // the library renders between hunks.
              "inline-flex w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors",
              hasChanges
                ? "hover:text-foreground"
                : "cursor-not-allowed opacity-40",
            )}
            onClick={hasChanges ? onToggleCollapsed : undefined}
            disabled={!hasChanges}
            aria-label={
              hasChanges
                ? `${isCollapsed ? "Expand" : "Collapse"} ${model.label}`
                : `${model.label} has no changes to expand`
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
            // Mirror the diff body's `[data-column-content] { padding-inline:
            // 1ch }` so the file name is offset from the card's left edge by the
            // same gutter the diff body uses between its column boundary and the
            // content text.
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
          {isDense ? (
            <DenseFilePath
              directory={denseDirectory}
              basename={denseBasename}
              title={openablePath ?? denseDisplayPath}
              onClick={
                canOpenFile && openablePath && onOpenFilePreview
                  ? () => onOpenFilePreview(openablePath)
                  : undefined
              }
            />
          ) : (
            <FilePathLink
              path={openablePath ?? model.path}
              displayName={renameInfo ? renameInfo.to : model.label}
              onClick={
                canOpenFile && openablePath && onOpenFilePreview
                  ? () => onOpenFilePreview(openablePath)
                  : undefined
              }
              className="font-mono font-medium text-foreground"
            />
          )}
          {copyablePath ? (
            <CopyButton
              text={copyablePath}
              label={`Copy path for ${model.label}`}
              className="rounded-md hover:bg-state-hover"
            />
          ) : null}
          {canOpenFile && openablePath && onOpenFileInEditor ? (
            <OpenInEditorButton
              onClick={() => onOpenFileInEditor(openablePath)}
              label={`Open ${model.label} in editor`}
            />
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {actionSlot}
        {statSlot ?? (
          <DiffStatsTally
            insertions={headerInsertions}
            deletions={headerDeletions}
            hideZero={hideEmptyHeaderStats}
            className="text-xs"
          />
        )}
        {porcelainStatus ? <PorcelainStatusGlyph {...porcelainStatus} /> : null}
      </span>
    </div>
  );
}

interface DenseFilePathProps {
  directory: string;
  basename: string;
  title: string;
  onClick?: () => void;
}

/**
 * Dense sidepane path: the directory dims and truncates from the start while the
 * basename stays fully opaque and never truncates, so the filename is always the
 * legible focus.
 */
function DenseFilePath({
  directory,
  basename,
  title,
  onClick,
}: DenseFilePathProps) {
  const segments = (
    <span className="flex min-w-0 items-baseline font-mono text-xs leading-5">
      {directory ? (
        <TruncateStart className="min-w-0 font-medium text-subtle-foreground">
          {directory}
        </TruncateStart>
      ) : null}
      <span className="shrink-0 whitespace-nowrap font-medium text-foreground">
        {basename}
      </span>
    </span>
  );

  if (!onClick) {
    return (
      <span className="flex min-w-0" title={title}>
        {segments}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="flex min-w-0 cursor-pointer text-left underline-offset-2 hover:underline"
      title={title}
      onClick={onClick}
    >
      {segments}
    </button>
  );
}

const GIT_DIFF_CARD_HEADER_WRAPPER_BASE_CLASS =
  // Left padding matches the in-diff expand-button's margin-left
  // (`--diffs-gap-inline` defaults to `--diffs-gap-fallback: 8px` in the lib's
  // style.js). The header's collapse chevron sits at the same X as the expand
  // chevrons the library renders between hunks below.
  "rounded-lg bg-background py-1.5 pl-2 pr-3 text-xs font-medium text-foreground";

export interface GitDiffCardHeaderWrapperClassArgs {
  stickyHeader: boolean;
  stickyHeaderTopClassName?: string;
  isBodyHidden: boolean;
  isStuck: boolean;
  applyStuckHeaderChrome?: boolean;
  showStuckHeaderEdge?: boolean;
}

/**
 * The wrapper classes for the header row, shared so the parsed-patch card and
 * the tiered card render an identical sticky/rounded header chrome.
 */
export function gitDiffCardHeaderWrapperClass({
  stickyHeader,
  stickyHeaderTopClassName = "top-0",
  isBodyHidden,
  isStuck,
  applyStuckHeaderChrome = true,
  showStuckHeaderEdge = true,
}: GitDiffCardHeaderWrapperClassArgs): string {
  return cn(
    GIT_DIFF_CARD_HEADER_WRAPPER_BASE_CLASS,
    stickyHeader && "sticky z-30",
    stickyHeader && stickyHeaderTopClassName,
    !isBodyHidden && "rounded-b-none",
    isStuck && applyStuckHeaderChrome && "rounded-t-none",
    // When stuck, the card's own rounded top border scrolls out of view. Draw
    // the replacement top edge as an inset shadow instead of a real border so
    // the stuck transition does not change layout.
    isStuck &&
      applyStuckHeaderChrome &&
      showStuckHeaderEdge &&
      "shadow-[inset_0_1px_0_var(--border)]",
  );
}
