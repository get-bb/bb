import { Skeleton } from "./skeleton";
import { useHostUiProps } from "../../lib/host-ui";

export function DiffLoadingSkeleton() {
  const hostUiProps = useHostUiProps();
  return (
    <div {...hostUiProps} className="space-y-1.5 px-3 py-3">
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-[96%] rounded-sm" />
      <Skeleton className="h-3 w-[93%] rounded-sm" />
      <Skeleton className="h-3 w-[90%] rounded-sm" />
      <Skeleton className="h-3 w-[87%] rounded-sm" />
      <Skeleton className="h-3 w-[84%] rounded-sm" />
    </div>
  );
}
