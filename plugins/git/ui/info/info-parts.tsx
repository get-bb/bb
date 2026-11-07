import type { ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";

const INFO_LIST_DEFAULT_LIMIT = 5;

export function InfoSubheading({
  label,
  count,
  trailing,
}: {
  label: string;
  count: number;
  trailing?: ReactNode;
}) {
  return (
    <div className="mt-3 mb-1 flex h-5 min-w-0 items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1 text-2xs text-subtle-foreground">
        <span className="truncate">{label}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{count}</span>
      </span>
      {trailing}
    </div>
  );
}

export function InfoListRail({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const collapses = count > INFO_LIST_DEFAULT_LIMIT + 1;
  return (
    <div className="relative">
      <span
        className={cn(
          "pointer-events-none absolute top-3 left-[5.5px] w-px bg-border [mask-image:linear-gradient(to_bottom,black_calc(100%-1rem),transparent)]",
          collapses ? "bottom-6" : "-bottom-3",
        )}
        aria-hidden
      />
      {children}
    </div>
  );
}
