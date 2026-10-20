import {
  DEFAULT_DIFF_FILE_FILTERS,
  hasDiffFileFilters,
  type DiffFileFilters,
} from "./git-diff/diff-file-filters";
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
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { DiffStatsTally } from "@/components/ui/diff-stats-tally.js";
import {
  formatChangeSummary,
  renderChangeSummary,
} from "@/components/workspace/workspace-change-summary";
import {
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
        <Icon name="Filter" className="size-3.5" />
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
  isStatsLoading: boolean;
  totalFilesCount: number;
  isTruncated: boolean;

  fileFilter: string | null;
  filters: DiffFileFilters;
  onFiltersChange: (filters: DiffFileFilters) => void;
  extensionCounts: readonly (readonly [string, number])[];
  onFileFilterChange: (value: string | null) => void;

  areAllFilesCollapsed: boolean;
  isCollapseAllDisabled: boolean;
  collapseAllDisabledReason: "No changes" | "No files match filter" | null;
  onToggleAllCollapsed: () => void;

  displayMode: GitDiffDisplayMode;
  onDisplayModeChange: GitDiffDisplayModeChangeHandler;

  lineOverflowMode: CodeOverflowMode;
  onLineOverflowModeChange: CodeOverflowModeChangeHandler;

  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (ignoreWhitespace: boolean) => void;
}

export function GitDiffToolbar({
  selectionValue,
  selectionOptions,
  onSelectionChange,
  isSelectorDisabled,
  stats,
  isStatsLoading,
  totalFilesCount,
  isTruncated,
  fileFilter,
  filters,
  onFiltersChange,
  extensionCounts,
  onFileFilterChange,
  areAllFilesCollapsed,
  isCollapseAllDisabled,
  collapseAllDisabledReason,
  onToggleAllCollapsed,
  displayMode,
  onDisplayModeChange,
  lineOverflowMode,
  onLineOverflowModeChange,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
}: GitDiffToolbarProps) {
  const collapseAllLabel = areAllFilesCollapsed
    ? "Expand all files"
    : "Collapse all files";
  const rootRef = useRef<HTMLDivElement>(null!);
  const { width: rootWidth = 0 } = useResizeObserver({
    ref: rootRef,
    box: "content-box",
  });
  const changeTally = { ...stats, lineStatsComplete: true };
  const completeSummary = formatChangeSummary(changeTally);
  const truncatedFilesLabel = `${stats.filesCount}+ file${stats.filesCount === 1 ? "" : "s"}`;
  const hasShownLineChanges = stats.insertions > 0 || stats.deletions > 0;
  const isFiltering =
    Boolean(fileFilter?.trim()) || hasDiffFileFilters(filters);
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
          className="flex min-w-0 flex-1 basis-auto flex-wrap items-center gap-x-3 gap-y-2"
          data-testid="git-diff-toolbar-details"
        >
          <span
            className={cn(
              "min-w-0 max-w-full shrink-0 truncate pl-2.5 text-muted-foreground",
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
            {isStatsLoading ? (
              <Skeleton
                role="status"
                aria-label="Loading changes"
                className="inline-block h-3 w-24 rounded-sm align-middle"
              />
            ) : isFiltering ? (
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
                fileFilter === null
                  ? "Search filenames"
                  : "Close filename search"
              }
              aria-pressed={fileFilter !== null}
            >
              <Icon name="Search" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                    "relative text-muted-foreground",
                  )}
                  aria-label="Filter files"
                  aria-pressed={isFiltering}
                >
                  <Icon name="Filter" />
                  {isFiltering ? (
                    <span className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground" />
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-80 overflow-y-auto min-w-48"
              >
                <DropdownMenuLabel>File extensions</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={filters.selectedExtensions.length === 0}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() =>
                    onFiltersChange({ ...filters, selectedExtensions: [] })
                  }
                >
                  All types
                </DropdownMenuCheckboxItem>
                {extensionCounts.map(([extension, count]) => (
                  <DropdownMenuCheckboxItem
                    key={extension}
                    checked={filters.selectedExtensions.includes(extension)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      onFiltersChange({
                        ...filters,
                        selectedExtensions: checked
                          ? [...filters.selectedExtensions, extension]
                          : filters.selectedExtensions.filter(
                              (value) => value !== extension,
                            ),
                      })
                    }
                  >
                    <span className="flex w-full items-center justify-between gap-6">
                      <span>{extension || "No extension"}</span>
                      <span className="rounded-full bg-muted px-1.5 text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={filters.showDeleted}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(showDeleted) =>
                    onFiltersChange({ ...filters, showDeleted })
                  }
                >
                  Deleted files
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={filters.showViewed}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(showViewed) =>
                    onFiltersChange({ ...filters, showViewed })
                  }
                >
                  Viewed files
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!isFiltering}
                  onSelect={() => {
                    onFiltersChange(DEFAULT_DIFF_FILE_FILTERS);
                    onFileFilterChange(fileFilter === null ? null : "");
                  }}
                >
                  Reset filters
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    role={isCollapseAllDisabled ? "group" : undefined}
                    aria-label={
                      isCollapseAllDisabled
                        ? (collapseAllDisabledReason ?? collapseAllLabel)
                        : undefined
                    }
                    tabIndex={isCollapseAllDisabled ? 0 : undefined}
                  >
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
                      aria-label={collapseAllLabel}
                    >
                      {areAllFilesCollapsed ? (
                        <Icon name="ChevronsDown" />
                      ) : (
                        <Icon name="ChevronsUp" />
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {collapseAllDisabledReason ?? collapseAllLabel}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                    "text-muted-foreground",
                  )}
                  aria-label="Diff settings"
                >
                  <Icon name="Settings" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={displayMode === "unified"}
                  onCheckedChange={() => onDisplayModeChange("unified")}
                >
                  Unified
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={displayMode === "split"}
                  onCheckedChange={() => onDisplayModeChange("split")}
                >
                  Split
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={lineOverflowMode === "wrap"}
                  onCheckedChange={(checked) =>
                    onLineOverflowModeChange(checked ? "wrap" : "scroll")
                  }
                >
                  Wrap lines
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={ignoreWhitespace}
                  onCheckedChange={onIgnoreWhitespaceChange}
                >
                  Hide whitespace
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
