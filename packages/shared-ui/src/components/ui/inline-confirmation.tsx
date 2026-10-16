import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Icon } from "./icon";

export function InlineConfirmation({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-diff-added",
        className,
      )}
    >
      <Icon aria-hidden name="CircleCheck" className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}
