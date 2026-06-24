import { useMemo } from "react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Icon } from "@/components/ui/icon.js";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "./OptionPicker";

const REUSE_THREAD_PREVIEW_LIMIT = 2;

/** One row in the worktree picker dropdown. Each row represents a worktree
 * env in the project, surfaced through a representative thread so the user
 * can identify which worktree they want by recognizing thread titles. */
export interface ReuseThreadOption {
  environmentId: string;
  branchName: string | null;
  name: string | null;
  /** Threads in this worktree, ordered most-recently-active first. */
  threads: ReadonlyArray<{ id: string; title: string }>;
}

export interface WorktreePickerProps {
  options: readonly ReuseThreadOption[];
  /** Currently-selected env id, or null when reuse mode is active but no
   * worktree has been chosen yet. */
  value: string | null;
  onChange: (environmentId: string) => void;
  /** Match the dim hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render as a non-interactive label while preserving the selected worktree. */
  disabled?: boolean;
  /** Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction; defaults to Radix's true. */
  modal?: boolean;
}

/**
 * Secondary picker shown in the prompt box when env mode is `reuse`. Mirrors
 * the BranchPicker's role for host modes — once the user picks "Reuse
 * existing worktree" in the env picker, this picker picks which worktree.
 */
export function WorktreePicker({
  options,
  value,
  onChange,
  muted,
  disabled = false,
  defaultOpen,
  modal,
}: WorktreePickerProps) {
  const branchIcon = getEnvironmentWorkspaceLabelIconName("managed-worktree");
  const activeOption = useMemo(
    () => options.find((option) => option.environmentId === value) ?? null,
    [options, value],
  );
  const triggerLabel =
    activeOption?.name ?? activeOption?.branchName ?? "Pick a worktree";
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Worktree"
          disabled={disabled}
          title={`Worktree: ${triggerLabel}`}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            muted && OPTION_MUTED_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={branchIcon}
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {triggerLabel}
            </span>
          </span>
          {disabled ? null : (
            <Icon
              name="ChevronDown"
              className={cn(
                "shrink-0 text-muted-foreground",
                COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
              )}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(OPTION_MENU_CONTENT_CLASS_NAME, "max-w-80")}
        mobileTitle="Worktree"
      >
        <DropdownMenuLabel>Reuse existing worktree</DropdownMenuLabel>
        {options.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            No worktrees in this project yet.
          </div>
        ) : (
          options.map((option) => (
            <WorktreeMenuItem
              key={option.environmentId}
              option={option}
              isSelected={option.environmentId === value}
              onSelect={onChange}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorktreeMenuItemProps {
  option: ReuseThreadOption;
  isSelected: boolean;
  onSelect: (environmentId: string) => void;
}

function WorktreeMenuItem({
  option,
  isSelected,
  onSelect,
}: WorktreeMenuItemProps) {
  const previewThreads = option.threads.slice(0, REUSE_THREAD_PREVIEW_LIMIT);
  const additionalCount = option.threads.length - previewThreads.length;
  const branchIcon = getEnvironmentWorkspaceLabelIconName("managed-worktree");
  const label = option.name ?? option.branchName ?? "Worktree";
  const branchDetail = option.name ? option.branchName : null;
  return (
    <DropdownMenuItem
      onSelect={() => onSelect(option.environmentId)}
      className="flex flex-col items-stretch gap-1 py-2"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          name={branchIcon}
          className={cn(
            "shrink-0 text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
          )}
        />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate text-xs">
          <span className="min-w-0 truncate font-medium">{label}</span>
          {branchDetail ? (
            <span className="min-w-0 truncate text-muted-foreground">
              {branchDetail}
            </span>
          ) : null}
        </span>
        <Icon
          name="Check"
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            isSelected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
      {previewThreads.length > 0 ? (
        <span className="flex flex-col gap-0.5 pl-6 text-xs text-muted-foreground">
          {previewThreads.map((thread) => (
            <span key={thread.id} className="truncate">
              {thread.title}
            </span>
          ))}
          {additionalCount > 0 ? (
            <span className="text-muted-foreground">
              +{additionalCount} more
            </span>
          ) : null}
        </span>
      ) : null}
    </DropdownMenuItem>
  );
}
