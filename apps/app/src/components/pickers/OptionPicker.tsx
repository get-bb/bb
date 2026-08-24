import type { ComponentType } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MENU_CONTENT_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "@bb/shared-ui/option-display";

// Inline picker triggers keep flat resting chrome (no border/background/shadow
// so they sit inline with surrounding text) but use the ghost button variant's
// natural state backgrounds — bg-state-hover on hover and bg-state-active while
// the menu is open — so they read as interactive affordances.
const OPTION_WARNING_TEXT_CLASS_NAME = "text-warning-text";
const OPTION_WARNING_INTERACTIVE_CLASS_NAME =
  "hover:text-warning-text data-[state=open]:text-warning-text";
const OPTION_WARNING_ICON_CLASS_NAME = "text-warning-text";

export interface PickerOption<T extends string> {
  value: T;
  label: string;
  compactLabel?: string;
  description?: string;
  tone?: "default" | "warning";
  icon?: ComponentType<{ className?: string }>;
  /**
   * Block selection while still listing the option, so the user sees the
   * choice exists and why it is unavailable (e.g. a permission mode above the
   * machine's permission limit).
   */
  disabled?: boolean;
  /** Shown in place of the description while the option is disabled. */
  disabledReason?: string;
}

interface OptionPickerProps<T extends string> {
  label: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  contentClassName?: string;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
  /** How the menu aligns to the trigger. Defaults to "start". */
  align?: "start" | "end" | "center";
  /**
   * Display a temporary effective state for the selected value without
   * changing the actual picker value or menu options.
   */
  displayOverride?: {
    label: string;
    compactLabel?: string;
    description?: string;
    title?: string;
  };
  /**
   * Render the trigger as a non-interactive, dimmed label showing the same
   * selected value — the menu never opens. Used by read-only surfaces (e.g. the
   * side chat) so they render the identical control as their interactive
   * counterpart, just disabled.
   */
  disabled?: boolean;
  /** Keep the chevron visible even when disabled, for effective modes that explain why the menu is locked. */
  showChevronWhenDisabled?: boolean;
}

export function OptionPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  contentClassName,
  muted,
  defaultOpen,
  modal,
  align = "start",
  displayOverride,
  disabled,
  showChevronWhenDisabled,
}: OptionPickerProps<T>) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedTone = displayOverride ? "default" : selectedOption?.tone;
  const selectedIsWarning = selectedTone === "warning";
  const SelectedIcon = selectedOption?.icon;
  const selectedLabel =
    displayOverride?.label ?? selectedOption?.label ?? value;
  const selectedCompactLabel =
    displayOverride?.compactLabel ?? selectedOption?.compactLabel;
  const selectedDescription =
    displayOverride?.description ?? selectedOption?.description;
  const selectedTitle = displayOverride?.title
    ? displayOverride.title
    : selectedDescription
      ? `${label}: ${selectedLabel} - ${selectedDescription}`
      : `${label}: ${selectedLabel}`;

  // The trigger renders identically whether interactive or disabled — the only
  // difference is the `disabled` button state — so the disabled read-only
  // surface (e.g. the side chat) shows the same label in the same position as
  // its editable counterpart.
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      disabled={disabled}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        muted && OPTION_MUTED_CLASS_NAME,
        selectedIsWarning && OPTION_WARNING_TEXT_CLASS_NAME,
        selectedIsWarning && OPTION_WARNING_INTERACTIVE_CLASS_NAME,
        // Disabled triggers stay legible (no opacity-50 dimming on top of the
        // muted treatment) and drop the affordance cursor.
        disabled && "cursor-default disabled:opacity-100",
        className,
      )}
    >
      <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME} title={selectedTitle}>
        {SelectedIcon ? <SelectedIcon className="size-3.5 shrink-0" /> : null}
        {selectedCompactLabel ? (
          <>
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {selectedLabel}
            </span>
            <span className="min-w-0 truncate" data-promptbox-compact-label="">
              {selectedCompactLabel}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate">{selectedLabel}</span>
        )}
      </span>
      {disabled && !showChevronWhenDisabled ? null : (
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3.5 shrink-0",
            selectedIsWarning
              ? OPTION_WARNING_ICON_CLASS_NAME
              : "text-muted-foreground",
          )}
        />
      )}
    </Button>
  );

  if (disabled) {
    return trigger;
  }

  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={cn(OPTION_MENU_CONTENT_CLASS_NAME, contentClassName)}
        mobileTitle={label}
      >
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((option) => {
          const OptionIcon = option.icon;
          return (
            <DropdownMenuItem
              key={option.value}
              disabled={option.disabled}
              onSelect={() => onChange(option.value)}
              className={cn(
                "flex items-start justify-between gap-3 whitespace-normal",
                LIST_HOVER_TRANSITION,
              )}
            >
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-start gap-2",
                  option.tone === "warning" && "text-warning-text",
                )}
              >
                {/* 16px icon matches the label's 16px first line; coarse
                    pointers keep size-4 while the line grows to 20px. */}
                {OptionIcon ? (
                  <OptionIcon className="size-4 shrink-0 max-md:pointer-coarse:mt-0.5" />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span
                    className="block whitespace-normal break-words font-medium"
                    title={option.label}
                  >
                    {option.label}
                  </span>
                  {option.disabled && option.disabledReason ? (
                    <span className="mt-0.5 block whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                      {option.disabledReason}
                    </span>
                  ) : option.description ? (
                    <span className="mt-0.5 block whitespace-normal break-words text-xs leading-snug text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </span>
              <Icon
                name="Check"
                className={cn(
                  COARSE_POINTER_ICON_SIZE_CLASS,
                  "shrink-0",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
