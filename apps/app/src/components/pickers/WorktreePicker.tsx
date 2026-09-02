import { useMemo } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import type { ProjectWorktreeCheckout } from "@bb/server-contract";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

const REUSE_THREAD_PREVIEW_LIMIT = 2;

export interface WorktreeOption {
  value: string | null;
  environmentId: string | null;
  hostId: string;
  hostName: string | null;
  name: string | null;
  checkout: ProjectWorktreeCheckout;
  displayPath: string;
  availability: "selectable" | "missing" | "prunable";
  lock: { reason: string | null } | null;
  ownership: "bb-managed" | "user-managed";
  threads: ReadonlyArray<{ id: string; title: string }>;
}

export interface WorktreeDiscoveryFailure {
  hostId: string;
  hostName: string | null;
  message: string;
}

export function worktreeOptionLabel(option: WorktreeOption): string {
  if (option.name !== null) {
    return option.name;
  }
  return option.checkout.kind === "branch"
    ? option.checkout.branchName
    : `Detached at ${option.checkout.headSha.slice(0, 7)}`;
}

const UNAVAILABLE_REMEDIATION =
  "Inspect with `git worktree list`; clean up with `git worktree prune`.";

interface WorktreePickerProps {
  options: readonly WorktreeOption[];
  failures: readonly WorktreeDiscoveryFailure[];
  value: string | null;
  onChange: (value: string) => void;
  onRetry?: () => void;
  loading?: boolean;
  muted?: boolean;
  disabled?: boolean;
  defaultOpen?: boolean;
  modal?: boolean;
}

export function WorktreePicker({
  options,
  failures,
  value,
  onChange,
  onRetry,
  loading = false,
  muted,
  disabled = false,
  defaultOpen,
  modal,
}: WorktreePickerProps) {
  const branchIcon = getEnvironmentWorkspaceLabelIconName("managed-worktree");
  const activeOption = useMemo(
    () =>
      value === null
        ? null
        : (options.find((option) => option.value === value) ?? null),
    [options, value],
  );
  const triggerLabel = activeOption
    ? worktreeOptionLabel(activeOption)
    : "Pick a worktree";
  // Machine grouping only exists in multi-machine projects: the option
  // builder sets hostName exactly then.
  const groups = useMemo(() => {
    const grouped = new Map<string | null, WorktreeOption[]>();
    for (const option of options) {
      const bucket = grouped.get(option.hostName);
      if (bucket) {
        bucket.push(option);
      } else {
        grouped.set(option.hostName, [option]);
      }
    }
    return [...grouped.entries()];
  }, [options]);
  const showMachineHeaders = groups.some(([hostName]) => hostName !== null);
  const isEmpty = options.length === 0 && failures.length === 0;
  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Worktree"
          disabled={disabled}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            !disabled && LIST_HOVER_TRANSITION,
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
        className={cn(
          OPTION_MENU_CONTENT_CLASS_NAME,
          "max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-96 overflow-x-hidden overflow-y-auto overscroll-contain",
        )}
        mobileTitle="Worktree"
      >
        <DropdownMenuLabel>Existing worktrees</DropdownMenuLabel>
        {isEmpty ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {loading
              ? "Discovering worktrees…"
              : "No existing worktrees found."}
          </div>
        ) : (
          <>
            {groups.map(([hostName, groupOptions]) => (
              <div key={hostName ?? "single-machine"}>
                {showMachineHeaders && hostName !== null ? (
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    {hostName}
                  </DropdownMenuLabel>
                ) : null}
                {groupOptions.map((option) => (
                  <WorktreeMenuItem
                    key={JSON.stringify([option.hostId, option.displayPath])}
                    option={option}
                    isSelected={option.value !== null && option.value === value}
                    onSelect={onChange}
                  />
                ))}
              </div>
            ))}
            {failures.map((failure) => (
              <WorktreeFailureRow
                key={failure.hostId}
                failure={failure}
                onRetry={onRetry}
              />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorktreeMenuItemProps {
  option: WorktreeOption;
  isSelected: boolean;
  onSelect: (value: string) => void;
}

function WorktreeMenuItem({
  option,
  isSelected,
  onSelect,
}: WorktreeMenuItemProps) {
  const previewThreads = option.threads.slice(0, REUSE_THREAD_PREVIEW_LIMIT);
  const additionalCount = option.threads.length - previewThreads.length;
  const branchIcon = getEnvironmentWorkspaceLabelIconName("managed-worktree");
  const label = worktreeOptionLabel(option);
  const branchDetail =
    option.name !== null && option.checkout.kind === "branch"
      ? option.checkout.branchName
      : null;
  const unavailable = option.availability !== "selectable";
  const optionValue = option.value;
  return (
    <DropdownMenuItem
      disabled={unavailable || optionValue === null}
      onSelect={() => {
        if (optionValue !== null) {
          onSelect(optionValue);
        }
      }}
      className={cn(
        "flex flex-col items-stretch gap-1 py-2",
        LIST_HOVER_TRANSITION,
      )}
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
        {option.ownership === "user-managed" ? (
          <span className="shrink-0 rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-2xs leading-none text-subtle-foreground">
            User-managed
          </span>
        ) : null}
        <Icon
          name="Check"
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            isSelected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
      <span className="truncate pl-6 text-xs text-muted-foreground">
        {option.displayPath}
      </span>
      {option.lock !== null && !unavailable ? (
        <span className="truncate pl-6 text-xs text-warning-foreground">
          {option.lock.reason === null
            ? "Locked"
            : `Locked: ${option.lock.reason}`}
        </span>
      ) : null}
      {unavailable ? (
        <span className="pl-6 text-xs text-muted-foreground">
          {option.availability === "missing"
            ? "Directory is missing. "
            : "Registration is prunable. "}
          {UNAVAILABLE_REMEDIATION}
        </span>
      ) : null}
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

interface WorktreeFailureRowProps {
  failure: WorktreeDiscoveryFailure;
  onRetry?: () => void;
}

function WorktreeFailureRow({ failure, onRetry }: WorktreeFailureRowProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
      <Icon
        name="AlertTriangle"
        className={cn(
          "shrink-0",
          COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
        )}
      />
      <span className="min-w-0 flex-1 truncate">
        {failure.hostName !== null
          ? `${failure.hostName}: ${failure.message}`
          : failure.message}
      </span>
      {onRetry ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-2 text-xs"
          onClick={(event) => {
            event.preventDefault();
            onRetry();
          }}
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
