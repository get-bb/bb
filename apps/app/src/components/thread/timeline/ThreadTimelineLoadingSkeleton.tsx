import { Skeleton } from "@bb/shared-ui/skeleton";

export function ThreadTimelineLoadingSkeleton() {
  return (
    <div className="mt-6 space-y-5" role="status" aria-label="Loading thread">
      <div className="flex justify-end px-2">
        <Skeleton className="h-12 w-3/5" />
      </div>
      <div className="space-y-2 px-2">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      <div className="space-y-2.5 px-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="space-y-2 px-2">
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}
