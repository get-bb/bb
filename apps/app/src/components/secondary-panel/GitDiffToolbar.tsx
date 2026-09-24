import { useEffect, useRef } from "react";
import { useResizeObserver } from "usehooks-ts";
import { Button } from "@bb/shared-ui/button";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { Input } from "@bb/shared-ui/input";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import {
  formatChangeSummary,
  renderChangeSummary,
} from "@/components/workspace/workspace-change-summary";
import {
  getNextCodeOverflowMode,
  type CodeOverflowMode,
  type CodeOverflowModeChangeHandler,
} from "@/lib/code-overflow-mode";
import { cn } from "@bb/shared-ui/lib/utils";
import type { GitDiffStats } from "../git-diff/git-diff-parsing";

const GIT_DIFF_SELECTOR_MENU_MIN_WIDTH = "20rem";

export type GitDiffDisplayMode = "unified" | "split";
export type GitDiffDisplayModeChangeHandler = (
  mode: GitDiffDisplayMode,
) => void;

export interface GitDiffSelectionOption {
  value: string;
  label: string;
  monoPrefix?: string;
}

interface GitDiffSelectorProps {
  value: string;
  options: readonly GitDiffSelectionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  panelWidthPx: number;
}

function GitDiffSelector({
  value,
  options,
  onChange,
  disabled,
  panelWidthPx,
}: GitDiffSelectorProps) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? value;
  const selectedMonoPrefix = selectedOption?.monoPrefix;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn(
            "h-8 w-full min-w-0 justify-between gap-2 rounded-lg border border-border bg-transparent px-2.5 font-normal max-md:pointer-coarse:h-10",
            COARSE_POINTER_TEXT_SM_CLASS,
            disabled && "opacity-60",
          )}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            {selectedMonoPrefix ? (
              <span className="shrink-0 font-mono text-muted-foreground">
                {selectedMonoPrefix}
              </span>
            ) : null}
            <span className="truncate">{selectedLabel}</span>
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
              "text-muted-foreground",
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
        style={{
          maxWidth: `min(var(--radix-popper-available-width), max(${GIT_DIFF_SELECTOR_MENU_MIN_WIDTH}, ${panelWidthPx}px))`,
        }}
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="flex items-center justify-between gap-2"
          >
            <span
              className="flex min-w-0 items-baseline gap-2"
              title={
                option.monoPrefix
                  ? `${option.monoPrefix} ${option.label}`
                  : option.label
              }
            >
              {option.monoPrefix ? (
                <span className="shrink-0 font-mono text-muted-foreground">
                  {option.monoPrefix}
                </span>
              ) : null}
              <span className="truncate">{option.label}</span>
            </span>
            <Icon
              name="Check"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
                option.value === value ? "opacity-100" : "opacity-0",
              )}
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface GitDiffFileFilterInputProps {
  value: string;
  onChange: (value: string | null) => void;
}

function GitDiffFileFilterInput({
  value,
  onChange,
}: GitDiffFileFilterInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isPointerCoarse = usePointerCoarse();

  useEffect(() => {
    if (!isPointerCoarse) {
      inputRef.current?.focus();
    }
  }, [isPointerCoarse]);

  return (
    <div className="relative mt-2">
      <span className="pointer-events-none absolute inset-y-0 left-2.25 flex w-8 items-center justify-center text-muted-foreground">
        <Icon name="Search" className="size-3.5" />
      </span>
      <Input
        ref={inputRef}
        aria-label="Filter changed files by path"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={cn(
          "h-8 rounded-lg border-border pl-12 pr-8 text-xs focus-visible:ring-0 max-md:pointer-coarse:h-10 max-md:pointer-coarse:text-base",
        )}
        placeholder="Filter files, e.g. *.md, docs/**, !*.test.ts"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange(null);
          }
        }}
      />
      {value ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center text-muted-foreground hover:text-foreground"
          aria-label="Clear file filter"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <Icon name="X" className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS} />
        </button>
      ) : null}
    </div>
  );
}

interface GitDiffToolbarProps {
  selectionValue: string;
  selectionOptions: readonly GitDiffSelectionOption[];
  onSelectionChange: (value: string) => void;
  isSelectorDisabled: boolean;

  stats: GitDiffStats;
  totalFilesCount: number;
  isTruncated: boolean;

  fileFilter: string | null;
  onFileFilterChange: (value: string | null) => void;

  areAllFilesCollapsed: boolean;
  isCollapseAllDisabled: boolean;
  onToggleAllCollapsed: () => void;

  displayMode: GitDiffDisplayMode;
  onDisplayModeChange: GitDiffDisplayModeChangeHandler;

  lineOverflowMode: CodeOverflowMode;
  onLineOverflowModeChange: CodeOverflowModeChangeHandler;
}

export function GitDiffToolbar({
  selectionValue,
  selectionOptions,
  onSelectionChange,
  isSelectorDisabled,
  stats,
  totalFilesCount,
  isTruncated,
  fileFilter,
  onFileFilterChange,
  areAllFilesCollapsed,
  isCollapseAllDisabled,
  onToggleAllCollapsed,
  displayMode,
  onDisplayModeChange,
  lineOverflowMode,
  onLineOverflowModeChange,
}: GitDiffToolbarProps) {
  const rootRef = useRef<HTMLDivElement>(null!);
  const { width: rootWidth = 0 } = useResizeObserver({
    ref: rootRef,
    box: "content-box",
  });
  const changeTally = { ...stats, lineStatsComplete: true };
  const completeSummary = formatChangeSummary(changeTally);
  const truncatedFilesLabel = `${stats.filesCount}+ file${stats.filesCount === 1 ? "" : "s"}`;
  const hasShownLineChanges = stats.insertions > 0 || stats.deletions > 0;
  const isFiltering = Boolean(fileFilter?.trim());
  const filteredFilesLabel = `${stats.filesCount} of ${totalFilesCount}${isTruncated ? "+" : ""} files`;

  return (
    <div ref={rootRef} className="px-4 pb-3 pt-3">
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
        data-testid="git-diff-toolbar-layout"
      >
        <div
          className="min-w-0 basis-48 grow-[999]"
          data-testid="git-diff-toolbar-selector-slot"
        >
          <GitDiffSelector
            value={selectionValue}
            options={selectionOptions}
            onChange={onSelectionChange}
            disabled={isSelectorDisabled}
            panelWidthPx={rootWidth}
          />
        </div>
        <div
          className="flex min-w-0 flex-1 basis-auto items-center gap-2"
          data-testid="git-diff-toolbar-details"
        >
          <span
            className={cn(
              "min-w-0 shrink truncate pl-2.5 text-muted-foreground",
              COARSE_POINTER_TEXT_SM_CLASS,
            )}
            data-testid="git-diff-toolbar-summary"
            title={
              isFiltering
                ? `${stats.filesCount} of ${totalFilesCount}${isTruncated ? "+" : ""} changed files match the filter`
                : isTruncated
                  ? `Showing the first ${stats.filesCount} changed file${stats.filesCount === 1 ? "" : "s"}; shown slice: ${stats.insertions} insertion${stats.insertions === 1 ? "" : "s"}, ${stats.deletions} deletion${stats.deletions === 1 ? "" : "s"}`
                  : completeSummary
            }
          >
            {isFiltering ? (
              <>
                {filteredFilesLabel}
                {hasShownLineChanges ? (
                  <>
                    {" · "}
                    <DiffStatsTally
                      insertions={stats.insertions}
                      deletions={stats.deletions}
                    />
                  </>
                ) : null}
              </>
            ) : isTruncated ? (
              <>
                {truncatedFilesLabel}
                {hasShownLineChanges ? (
                  <>
                    {" · shown "}
                    <DiffStatsTally
                      insertions={stats.insertions}
                      deletions={stats.deletions}
                    />
                  </>
                ) : null}
              </>
            ) : (
              renderChangeSummary(changeTally)
            )}
          </span>
          <div
            className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1"
            data-testid="git-diff-toolbar-actions"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "text-muted-foreground",
              )}
              onClick={() =>
                onFileFilterChange(fileFilter === null ? "" : null)
              }
              aria-label={
                fileFilter === null ? "Filter files" : "Close file filter"
              }
              aria-pressed={fileFilter !== null}
            >
              <Icon name="Search" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "text-muted-foreground",
              )}
              onClick={onToggleAllCollapsed}
              disabled={isCollapseAllDisabled}
              aria-label={
                areAllFilesCollapsed ? "Expand all files" : "Collapse all files"
              }
            >
              {areAllFilesCollapsed ? (
                <Icon name="ChevronsDown" />
              ) : (
                <Icon name="ChevronsUp" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "text-muted-foreground",
              )}
              onClick={() =>
                onLineOverflowModeChange(
                  getNextCodeOverflowMode(lineOverflowMode),
                )
              }
              aria-label={
                lineOverflowMode === "wrap"
                  ? "Disable diff line wrap"
                  : "Wrap diff lines"
              }
              aria-pressed={lineOverflowMode === "wrap"}
            >
              <Icon name="TextWrap" />
            </Button>
            <div
              className="inline-flex items-center gap-1 rounded-lg border border-border p-0.5"
              role="tablist"
              aria-label="Diff view mode"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                  "text-muted-foreground",
                )}
                onClick={() => onDisplayModeChange("unified")}
                aria-label="Stacked diff view"
                aria-pressed={displayMode === "unified"}
              >
                <Icon name="Rows2" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                  "text-muted-foreground",
                )}
                onClick={() => onDisplayModeChange("split")}
                aria-label="Split diff view"
                aria-pressed={displayMode === "split"}
              >
                <Icon name="Columns2" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      {fileFilter !== null ? (
        <GitDiffFileFilterInput
          value={fileFilter}
          onChange={onFileFilterChange}
        />
      ) : null}
    </div>
  );
}
