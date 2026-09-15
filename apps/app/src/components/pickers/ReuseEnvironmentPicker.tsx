import type {
  ReuseThreadOption,
  ReuseDiscoveryFailure,
} from "./reuse-environment/reuse-options";
import {
  reuseThreadOptionDisplay,
  ReuseEnvironmentMenuItem,
  ReuseDiscoveryFailureRow,
} from "./reuse-environment/ReuseEnvironmentRows";
import { useMemo } from "react";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { REUSE_ENVIRONMENT_ICON_NAME } from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

function reuseThreadOptionKey(option: ReuseThreadOption): string {
  return (
    option.value ??
    JSON.stringify([option.environmentId, option.hostId, option.path])
  );
}

interface ReuseEnvironmentPickerProps {
  options: readonly ReuseThreadOption[];
  failures: readonly ReuseDiscoveryFailure[];
  value: string | null;
  onChange: (value: string) => void;
  onRetry?: () => void;
  loading?: boolean;
  muted?: boolean;
  disabled?: boolean;
  modal?: boolean;
}

export function ReuseEnvironmentPicker({
  options,
  failures,
  value,
  onChange,
  onRetry,
  loading = false,
  muted,
  disabled = false,
  modal,
}: ReuseEnvironmentPickerProps) {
  const { providers } = useSystemEnvironmentProviders();
  const activeOption = useMemo(
    () =>
      value === null
        ? null
        : (options.find((option) => option.value === value) ?? null),
    [options, value],
  );
  const trigger =
    activeOption === null
      ? { label: "Pick an environment", icon: REUSE_ENVIRONMENT_ICON_NAME }
      : reuseThreadOptionDisplay(activeOption, providers);
  const isEmpty = options.length === 0 && failures.length === 0;
  return (
    <DropdownMenu modal={modal}>
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
            !disabled && LIST_HOVER_TRANSITION,
            muted && OPTION_MUTED_CLASS_NAME,
            disabled && "cursor-default disabled:opacity-100",
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={trigger.icon}
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {trigger.label}
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
        className={cn(OPTION_MENU_CONTENT_CLASS_NAME, "max-w-96")}
        mobileTitle="Environment"
      >
        <DropdownMenuLabel>Reuse an existing environment</DropdownMenuLabel>
        {isEmpty ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">
            {loading ? "Discovering worktrees…" : "Nothing to reuse yet."}
          </div>
        ) : (
          <>
            {options.map((option) => (
              <ReuseEnvironmentMenuItem
                key={reuseThreadOptionKey(option)}
                option={option}
                providers={providers}
                isSelected={option.value !== null && option.value === value}
                onSelect={onChange}
              />
            ))}
            {failures.map((failure) => (
              <ReuseDiscoveryFailureRow
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
