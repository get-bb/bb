import { Skeleton } from "@bb/shared-ui/skeleton";

export type TimelineRowBodyPlaceholderShape = "block" | "rows";

const ROW_SKELETON_WIDTHS = ["w-2/5", "w-1/2", "w-1/3"] as const;

export function TimelineRowBodyPlaceholder({
  shape,
}: {
  shape: TimelineRowBodyPlaceholderShape;
}) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="animate-in fade-in-0 fill-mode-backwards delay-150 duration-200"
    >
      {shape === "block" ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-background px-3 py-3">
          <Skeleton className="h-3 w-full rounded-sm" />
          <Skeleton className="h-3 w-[93%] rounded-sm" />
          <Skeleton className="h-3 w-[87%] rounded-sm" />
        </div>
      ) : (
        <div className="space-y-2.5 px-2 py-1">
          {ROW_SKELETON_WIDTHS.map((width) => (
            <div key={width} className="flex items-center gap-2">
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
