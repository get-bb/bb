import { useRef } from "react";
import { useResizeObserver } from "usehooks-ts";
import { Button } from "@/components/ui/button.js";
import {
  COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import {
  formatChangeSummary,
  renderChangeSummary,
} from "@/components/workspace/workspace-change-summary";
import {
  getNextCodeOverflowMode,
  type CodeOverflowMode,
  type CodeOverflowModeChangeHandler,
} from "@/lib/code-overflow-mode";
import { cn } from "@/lib/utils";
import type { GitDiffStats } from "../git-diff/git-diff-parsing";

const GIT_DIFF_SELECTOR_MENU_MIN_WIDTH = "20rem";

export type GitDiffDisplayMode = "unified" | "split";
export type GitDiffDisplayModeChangeHandler = (
  mode: GitDiffDisplayMode,
) => void;

export interface GitDiffSelectionOption {
  value: string;
  label: string;
  /** When set, rendered in monospace before the label (e.g. a short commit SHA). */
  monoPrefix?: string;
}

interface GitDiffSelectorProps {
  value: string;
  options: readonly GitDiffSelectionOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Width of the surrounding diff panel, used to cap the open menu's width. */
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
        // Match the panel width so the menu lines up with the diff cards below,
        // but stay at least GIT_DIFF_SELECTOR_MENU_MIN_WIDTH so labels stay
        // readable when the panel is narrow. Viewport-capped as a safety net.
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

export interface GitDiffToolbarProps {
  selectionValue: string;
  selectionOptions: readonly GitDiffSelectionOption[];
  onSelectionChange: (value: string) => void;
  /** Disables the selector while data is loading or unavailable. */
  isSelectorDisabled: boolean;

  stats: GitDiffStats;

  /** Whether the collapse-all action would expand or collapse next. */
  areAllFilesCollapsed: boolean;
  /** Disabled when there are no parsed files (or while loading). */
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

  return (
    <div ref={rootRef} className="px-4 pb-3 pt-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <GitDiffSelector
            value={selectionValue}
            options={selectionOptions}
            onChange={onSelectionChange}
            disabled={isSelectorDisabled}
            panelWidthPx={rootWidth}
          />
        </div>
        <span
          className={cn(
            "min-w-0 shrink truncate text-muted-foreground",
            COARSE_POINTER_TEXT_SM_CLASS,
          )}
          title={formatChangeSummary(stats)}
        >
          {renderChangeSummary(stats)}
        </span>
        <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1">
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
  );
}
