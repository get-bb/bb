import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "../icon";
import { cn } from "../../../lib/utils";

export type ResourceStatusTone = "success" | "warning" | "error" | "muted";

export function ResourceStatus({
  tone,
  children,
}: {
  tone: ResourceStatusTone;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "success" && "bg-success",
          tone === "warning" && "bg-warning",
          tone === "error" && "bg-destructive",
          tone === "muted" && "bg-muted-foreground/50",
        )}
      />
      <span className="truncate">{children}</span>
    </span>
  );
}

export function ResourceIconFrame({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: (glyphClassName: string) => ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center overflow-hidden",
        className,
      )}
      style={style}
    >
      {children("size-3.5")}
    </span>
  );
}

export function ResourceMeta({
  items,
}: {
  items: readonly (ReactNode | null | undefined | false)[];
}) {
  const visibleItems = items.filter(Boolean);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {visibleItems.map((item, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden className="text-subtle-foreground">
              ·
            </span>
          ) : null}
          <span className="min-w-0 truncate">{item}</span>
        </span>
      ))}
    </span>
  );
}

export function ResourceCardStat({
  icon,
  iconClassName,
  accessibleLabel,
  children,
}: {
  icon: IconName;
  iconClassName?: string;
  accessibleLabel?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-label={accessibleLabel}
      className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap px-1 text-muted-foreground"
    >
      <Icon
        name={icon}
        className={cn("size-3 shrink-0", iconClassName)}
        aria-hidden
      />
      <span>{children}</span>
    </span>
  );
}
