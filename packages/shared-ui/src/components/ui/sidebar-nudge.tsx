import { useId, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Icon } from "./icon";

export interface SidebarNudgeAction {
  label: string;
  onAction: () => void;
}

export interface SidebarNudgeProps {
  icon: ReactNode;
  children: ReactNode;
  action?: SidebarNudgeAction;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
  testId?: string;
}

export const SIDEBAR_NUDGE_CONTROL_CLASS =
  "flex size-6 cursor-pointer items-center justify-center rounded-md text-subtle-foreground transition-colors hover:bg-state-hover hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring motion-reduce:transition-none";

export function SidebarNudge({
  icon,
  children,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
  testId,
}: SidebarNudgeProps) {
  const bodyId = useId();
  return (
    <section
      aria-labelledby={bodyId}
      data-testid={testId}
      data-sidebar-nudge=""
      className={cn(
        "mx-1 flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-state-hover text-muted-foreground">
          {icon}
        </span>
        {onDismiss ? (
          <button
            type="button"
            aria-label={dismissLabel}
            onClick={onDismiss}
            className={cn("-mr-1.5 -mt-1.5", SIDEBAR_NUDGE_CONTROL_CLASS)}
          >
            <Icon aria-hidden name="X" className="size-3.5" />
          </button>
        ) : null}
      </div>
      <p id={bodyId} className="text-sm leading-snug text-foreground">
        {children}
      </p>
      {action ? (
        <button
          type="button"
          onClick={action.onAction}
          className="-mx-1 inline-flex min-h-6 cursor-pointer items-center gap-0.5 self-start rounded-md px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring motion-reduce:transition-none"
        >
          {action.label}
          <Icon aria-hidden name="ChevronRight" className="size-3" />
        </button>
      ) : null}
    </section>
  );
}
