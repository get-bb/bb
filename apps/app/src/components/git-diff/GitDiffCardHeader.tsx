import { useMemo, type ReactNode } from "react";
import type { GitDiffFileChangeKind } from "@bb/server-contract";
import { CopyButton } from "@/components/ui/copy-button.js";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import { FilePathLink } from "@/components/ui/file-path-link.js";
import { Icon } from "@bb/shared-ui/icon";
import { OpenInEditorButton } from "@/components/ui/open-in-editor-button.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import { resolveAbsoluteFilePath } from "@/lib/absolute-file-path";
import { cn } from "@bb/shared-ui/lib/utils";
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
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[13px] font-normal tabular-nums">
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

interface GitDiffChangeIconProps {
  changeKind: GitDiffFileChangeKind;
}

/**
 * Mirrors the 16px change-state symbols used by Pierre's default file header.
 * BB keeps a custom header for collapse and file actions, so the library cannot
 * render this symbol for us when `disableFileHeader` is enabled.
 */
function GitDiffChangeIcon({ changeKind }: GitDiffChangeIconProps) {
  const isAdded = changeKind === "added";
  const isDeleted = changeKind === "deleted";
  const isMoved = changeKind === "renamed" || changeKind === "copied";

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      data-diff-change-icon={changeKind}
      className={cn(
        "size-4 shrink-0 fill-current",
        isAdded
          ? "text-diff-added"
          : isDeleted
            ? "text-diff-removed"
            : "text-[var(--diff-view-modified)]",
      )}
    >
      <path d="M1.788 4.296c.196-.88.478-1.381.802-1.706s.826-.606 1.706-.802C5.194 1.588 6.387 1.5 8 1.5s2.806.088 3.704.288c.88.196 1.381.478 1.706.802s.607.826.802 1.706c.2.898.288 2.091.288 3.704s-.088 2.806-.288 3.704c-.195.88-.478 1.381-.802 1.706s-.826.607-1.706.802c-.898.2-2.091.288-3.704.288s-2.806-.088-3.704-.288c-.88-.195-1.381-.478-1.706-.802s-.606-.826-.802-1.706C1.588 10.806 1.5 9.613 1.5 8s.088-2.806.288-3.704M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8" />
      {isAdded ? (
        <path d="M8 4a.75.75 0 0 1 .75.75v2.5h2.5a.75.75 0 0 1 0 1.5h-2.5v2.5a.75.75 0 0 1-1.5 0v-2.5h-2.5a.75.75 0 0 1 0-1.5h2.5v-2.5A.75.75 0 0 1 8 4" />
      ) : isDeleted ? (
        <path d="M4 8a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 8" />
      ) : isMoved ? (
        <path d="M8.495 4.695a.75.75 0 0 0-.05 1.06L10.486 8l-2.041 2.246a.75.75 0 0 0 1.11 1.008l2.5-2.75a.75.75 0 0 0 0-1.008l-2.5-2.75a.75.75 0 0 0-1.06-.051m-4 0a.75.75 0 0 0-.05 1.06l2.044 2.248-1.796 1.995a.75.75 0 0 0 1.114 1.004l2.25-2.5a.75.75 0 0 0-.002-1.007l-2.5-2.75a.75.75 0 0 0-1.06-.05" />
      ) : (
        <circle cx="8" cy="8" r="3" />
      )}
    </svg>
  );
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

export function GitDiffCardHeader({
  model,
  previousPath,
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

  return (
    <div className="flex h-full w-full min-w-0 items-center justify-between gap-2">
      <span className="flex h-full min-w-0 items-center">
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
            "flex min-w-0 items-center gap-2",
            // Mirror the diff body's `[data-column-content] { padding-inline:
            // 1ch }` so the file name is offset from the card's left edge by the
            // same gutter the diff body uses between its column boundary and the
            // content text.
            "pl-[1ch]",
          )}
        >
          <GitDiffChangeIcon changeKind={model.changeKind} />
          {renameInfo ? (
            <TruncateStart
              className="min-w-0 font-sans text-[13px] font-normal leading-5 text-muted-foreground"
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
            path={openablePath ?? model.path}
            displayName={renameInfo ? renameInfo.to : model.label}
            onClick={
              canOpenFile && openablePath && onOpenFilePreview
                ? () => onOpenFilePreview(openablePath)
                : undefined
            }
            className="font-sans text-[13px] font-normal text-foreground"
          />
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
      <span className="flex shrink-0 items-center gap-1 font-mono text-[13px] font-normal">
        {actionSlot}
        {statSlot ?? (
          <DiffStatsTally
            insertions={headerInsertions}
            deletions={headerDeletions}
            hideZero={hideEmptyHeaderStats}
            className="font-mono text-[13px] font-normal"
          />
        )}
      </span>
    </div>
  );
}

const GIT_DIFF_CARD_HEADER_WRAPPER_BASE_CLASS =
  // Left padding matches the in-diff expand-button's margin-left
  // (`--diffs-gap-inline` defaults to `--diffs-gap-fallback: 8px` in the lib's
  // style.js). The header's collapse chevron sits at the same X as the expand
  // chevrons the library renders between hunks below.
  "flex h-10 shrink-0 items-center rounded-lg bg-background py-0 pl-2 pr-4 font-sans text-[13px] font-normal text-foreground";

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
