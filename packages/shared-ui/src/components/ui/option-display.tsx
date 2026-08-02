import type { ComponentType, ReactNode } from "react";
import { cn } from "../../lib/utils";

export const OPTION_BASE_CLASS_NAME =
  "h-8 w-fit max-w-full min-w-0 items-center justify-start gap-1 px-1 text-xs leading-tight";
export const OPTION_INTERACTIVE_CLASS_NAME =
  "border-none bg-transparent shadow-none";
export const OPTION_CONTENT_CLASS_NAME = "flex min-w-0 items-center gap-1.5";
export const OPTION_TRIGGER_CONTENT_CLASS_NAME = "contents";
export const OPTION_MENU_CONTENT_CLASS_NAME = "w-max min-w-0 max-w-96";
export const OPTION_MUTED_CLASS_NAME =
  "text-muted-foreground hover:text-foreground";

export interface OptionDisplayProps {
  label: string;
  value: ReactNode;
  tone?: "default" | "warning";
  icon?: ComponentType<{ className?: string }>;
  /** Pre-rendered leading element (e.g. an Icon). Takes precedence over `icon`. */
  leading?: ReactNode;
  compactValue?: ReactNode;
  compactValueHiddenWhenTiny?: boolean;
  className?: string;
  title?: string;
  /** Render with the dim treatment used by options inside the prompt box. */
  muted?: boolean;
}

/**
 * Non-interactive counterpart to the composer's inline option triggers.
 *
 * Read-only surfaces use the same dimensions, responsive labels, icon spacing,
 * and muted hierarchy without implying that the value can be changed there.
 */
export function OptionDisplay({
  label,
  value,
  tone = "default",
  icon: BrandIcon,
  leading,
  compactValue,
  compactValueHiddenWhenTiny,
  className,
  title,
  muted,
}: OptionDisplayProps) {
  const defaultTitle =
    typeof value === "string" ? `${label}: ${value}` : undefined;

  return (
    <div
      data-option-display=""
      title={title ?? defaultTitle}
      className={cn(
        "inline-flex",
        OPTION_BASE_CLASS_NAME,
        muted && OPTION_MUTED_CLASS_NAME,
        tone === "warning" && "text-warning-text",
        className,
      )}
    >
      <span className={OPTION_CONTENT_CLASS_NAME}>
        {leading ??
          (BrandIcon ? <BrandIcon className="size-4 shrink-0" /> : null)}
        <span className="sr-only">{label}: </span>
        <span className="min-w-0 truncate" data-promptbox-full-label="">
          {value}
        </span>
        {compactValue ? (
          <span
            className="min-w-0 truncate"
            data-promptbox-compact-label=""
            data-promptbox-hide-tiny={
              compactValueHiddenWhenTiny ? "" : undefined
            }
          >
            {compactValue}
          </span>
        ) : null}
      </span>
    </div>
  );
}
