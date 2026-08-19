import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { Icon, type IconName } from "./icon";

export interface EmptyStateProps {
  message: string;
  icon?: IconName;
  className?: string;
  iconClassName?: string;
  messageClassName?: string;
  "data-select-all-scope"?: string;
}

export function EmptyState({
  message,
  icon,
  className,
  iconClassName,
  messageClassName,
  "data-select-all-scope": selectAllScope,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      data-select-all-scope={selectAllScope}
    >
      {icon ? (
        <Icon
          name={icon}
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-subtle-foreground",
            iconClassName,
          )}
        />
      ) : null}
      <p
        className={cn(
          "text-xs leading-5 text-muted-foreground",
          messageClassName,
        )}
      >
        {message}
      </p>
    </div>
  );
}

type EmptyStatePanelProps = HTMLAttributes<HTMLDivElement>;

/**
 * Boxed zero-state placeholder: a dashed-outline, centered, muted panel with no
 * surface fill, so it never clashes with the page background. Use for empty
 * regions that should read as a framed placeholder; for an inline list/heading
 * hint use {@link EmptyState} instead. Per-context sizing (padding, text size,
 * margin, radius) passes through `className`.
 */
export function EmptyStatePanel({
  className,
  children,
  ...props
}: EmptyStatePanelProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
