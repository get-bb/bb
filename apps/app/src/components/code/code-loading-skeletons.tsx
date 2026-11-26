import { Skeleton } from "@bb/shared-ui/skeleton";
import { useHostUiProps } from "@/lib/host-ui";

export function SourceLoadingSkeleton() {
  const hostUiProps = useHostUiProps();
  return (
    <div {...hostUiProps} className="space-y-2 px-4 pt-4" aria-busy>
      <Skeleton className="h-3 w-3/4 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-3/5 rounded-sm" />
    </div>
  );
}
