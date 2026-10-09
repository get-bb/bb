import { Skeleton } from "@bb/shared-ui/skeleton";

export function TimelineRowBodyPlaceholder() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="animate-in fade-in-0 fill-mode-backwards delay-150 duration-200"
    >
      <div className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-3">
        <Skeleton className="h-3 w-full rounded-sm" />
        <Skeleton className="h-3 w-[93%] rounded-sm" />
        <Skeleton className="h-3 w-[87%] rounded-sm" />
      </div>
    </div>
  );
}
