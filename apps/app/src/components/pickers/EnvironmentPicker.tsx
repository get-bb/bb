import { useMemo } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { cn } from "@/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "./OptionPicker";
import {
  encodeHostValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "./environment-picker-value";

// ---------------------------------------------------------------------------
// Pure presentational picker. Use directly in stories with mocked data.
// App callers should use EnvironmentPicker (the connected wrapper below).
// ---------------------------------------------------------------------------

interface SelectedEnvironment {
  modeLabel: string;
  compactModeLabel: string;
  icon: IconName;
}

export interface EnvironmentPickerUIProps {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  /** The host bb runs work on, or null while it loads / before one connects. */
  host: Host | null;
  /** Whether `host` is the machine this browser runs on. When false (e.g. a
   * phone on the tailnet), the picker surfaces the host name so it's clear work
   * runs on a remote machine, and "Work locally" becomes "Work on host". */
  isLocal: boolean;
  /** When true, the "Reuse existing worktree" entry is disabled — the
   * caller signals that the project has no worktree envs available to
   * reuse. The entry is always rendered so the affordance stays
   * discoverable; it just can't be selected. */
  reuseDisabled?: boolean;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render as a non-interactive label while preserving the selected mode. */
  disabled?: boolean;
  className?: string;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
}

export function EnvironmentPickerUI({
  value,
  onChange,
  sources,
  host,
  isLocal,
  reuseDisabled,
  muted,
  disabled = false,
  className,
  defaultOpen,
  modal,
}: EnvironmentPickerUIProps) {
  const hostId = host?.id ?? null;
  const hostConnected = host?.status === "connected";
  const hasSource = useMemo(
    () =>
      hostId !== null &&
      findLocalPathProjectSourceForHost(sources, hostId) !== undefined,
    [hostId, sources],
  );
  // Plain "Work locally" labels read wrong from a phone on the tailnet, where
  // work runs on a different machine — surface the host name there instead.
  const localLabel = isLocal ? "Work locally" : "Work remotely";

  // An unreachable host blocks every option, so the menu collapses to a single
  // reason instead of repeating it on each row. Source/worktree availability
  // only narrows the individual options once the host itself is reachable.
  const hostUnavailableReason = !host
    ? "No host connected"
    : !hostConnected
      ? "Host is offline"
      : null;
  const workspaceDisabledReason = hasSource
    ? null
    : "Project source unavailable";
  const reuseDisabledReason = reuseDisabled
    ? "No worktrees in this project yet"
    : null;

  const parsed = useMemo(() => parseEnvironmentValue(value), [value]);

  const selected = useMemo((): SelectedEnvironment => {
    // A down host overrides whatever mode is persisted: surfacing "Host
    // offline" is clearer than a stale "Work remotely" or a blank "Environment"
    // that hides why nothing can run. The selection itself is kept so it
    // resumes once the host reconnects.
    if (hostUnavailableReason !== null) {
      return {
        modeLabel: hostUnavailableReason,
        compactModeLabel: host ? "Offline" : "No host",
        icon: "AlertTriangle" as const,
      };
    }
    if (!parsed) {
      return {
        modeLabel: "Environment",
        compactModeLabel: "Env",
        icon: "Laptop" as const,
      };
    }
    if (parsed.type === "reuse") {
      return {
        modeLabel: "Reuse worktree",
        compactModeLabel: "Reuse",
        icon: getEnvironmentWorkspaceLabelIconName("managed-worktree"),
      };
    }
    const modeLabel = parsed.mode === "worktree" ? "New worktree" : localLabel;
    const compactModeLabel =
      parsed.mode === "worktree" ? "Worktree" : isLocal ? "Local" : "Remote";
    const icon = getEnvironmentWorkspaceLabelIconName(
      parsed.mode === "worktree" ? "managed-worktree" : "other",
    );
    return { modeLabel, compactModeLabel, icon };
  }, [parsed, localLabel, isLocal, hostUnavailableReason, host]);

  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Environment"
          disabled={disabled}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            !disabled && OPTION_INTERACTIVE_CLASS_NAME,
            muted && OPTION_MUTED_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
            className,
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={selected.icon}
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {selected.modeLabel}
            </span>
            <span
              className="min-w-0 truncate"
              data-promptbox-compact-label=""
              data-promptbox-hide-tiny=""
            >
              {selected.compactModeLabel}
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
        mobileTitle="Environment"
      >
        <EnvironmentOptionsSection
          hostId={hostId}
          hostName={isLocal ? null : (host?.name ?? null)}
          hostUnavailableReason={hostUnavailableReason}
          localLabel={localLabel}
          workspaceDisabledReason={workspaceDisabledReason}
          reuseDisabledReason={reuseDisabledReason}
          selectedType={parsed?.type}
          value={value}
          onChange={onChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface EnvironmentOptionsSectionProps {
  hostId: string | null;
  /** Host name to label the group with, or null when the host is this machine. */
  hostName: string | null;
  /** When set, the host can't run any work — the group shows this reason alone
   * and renders none of the options. Null when the host is reachable. */
  hostUnavailableReason: string | null;
  /** Label for the non-worktree option ("Work locally" vs "Work remotely"). */
  localLabel: string;
  /** Why the local/worktree options are unavailable, or null when usable. */
  workspaceDisabledReason: string | null;
  /** Why the reuse option is unavailable, or null when usable. */
  reuseDisabledReason: string | null;
  selectedType:
    | NonNullable<ReturnType<typeof parseEnvironmentValue>>["type"]
    | undefined;
  value: string;
  onChange: (value: string) => void;
}

function EnvironmentOptionsSection({
  hostId,
  hostName,
  hostUnavailableReason,
  localLabel,
  workspaceDisabledReason,
  reuseDisabledReason,
  selectedType,
  value,
  onChange,
}: EnvironmentOptionsSectionProps) {
  const localValue = hostId ? encodeHostValue(hostId, "local") : null;
  const worktreeValue = hostId ? encodeHostValue(hostId, "worktree") : null;
  const workspaceDisabled = workspaceDisabledReason !== null;
  const workspaceDisabledDescription = workspaceDisabledReason ?? undefined;

  return (
    <DropdownMenuGroup>
      {hostName ? (
        <DropdownMenuLabel className="whitespace-normal break-words text-muted-foreground">
          {hostName}
        </DropdownMenuLabel>
      ) : null}
      {hostUnavailableReason !== null ? (
        <DropdownMenuItem
          disabled
          className="whitespace-normal break-words text-xs text-muted-foreground"
        >
          {hostUnavailableReason}
        </DropdownMenuItem>
      ) : (
        <>
          <EnvironmentMenuItem
            label={localLabel}
            description={workspaceDisabledDescription}
            icon={getEnvironmentWorkspaceLabelIconName("other")}
            selected={localValue !== null && value === localValue}
            disabled={workspaceDisabled || localValue === null}
            onSelect={() => {
              if (localValue !== null) onChange(localValue);
            }}
          />
          <EnvironmentMenuItem
            label="New worktree"
            description={workspaceDisabledDescription}
            icon={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
            selected={worktreeValue !== null && value === worktreeValue}
            disabled={workspaceDisabled || worktreeValue === null}
            onSelect={() => {
              if (worktreeValue !== null) onChange(worktreeValue);
            }}
          />
          <EnvironmentMenuItem
            label="Existing worktree"
            description={reuseDisabledReason ?? undefined}
            icon={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
            selected={selectedType === "reuse"}
            disabled={reuseDisabledReason !== null}
            onSelect={() => onChange(REUSE_VALUE_WITHOUT_ENVIRONMENT)}
          />
        </>
      )}
    </DropdownMenuGroup>
  );
}

// Shared menu item
// ---------------------------------------------------------------------------

interface EnvironmentMenuItemProps {
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function EnvironmentMenuItem({
  label,
  description,
  icon,
  selected,
  onSelect,
  disabled,
}: EnvironmentMenuItemProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => {
        if (disabled) return;
        onSelect();
      }}
      className="flex items-start justify-between gap-3 whitespace-normal"
    >
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <Icon
          name={icon}
          className={cn(
            "mt-0.5",
            "text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
          )}
        />
        <span className="flex min-w-0 flex-col">
          <span className="whitespace-normal break-words text-xs">
            {label}
          </span>
          {description ? (
            <span className="mt-0.5 whitespace-normal break-words text-xs leading-snug text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          "shrink-0",
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}
