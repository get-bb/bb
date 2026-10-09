import { HEADER_SEAM_CLASS } from "@/components/layout/AppPageHeader";
import { CHROME_ROW_CLASS } from "@/lib/bb-desktop";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { useEffect, type ReactNode } from "react";

interface RouteLoadingSkeletonProps {
  children?: ReactNode;
  isBoundedPane: boolean;
}

let mountedRouteLoadingSkeletons = 0;

export function isRouteLoadingSkeletonMounted(): boolean {
  return mountedRouteLoadingSkeletons > 0;
}

const SHELL_CLASS = "flex h-full min-h-0 flex-1 flex-col overflow-hidden";
const STANDALONE_SHELL_BLEED_CLASS = "-mx-4 -mt-4 md:-mx-5 md:-mt-5";

export function RouteLoadingSkeleton({
  children,
  isBoundedPane,
}: RouteLoadingSkeletonProps) {
  useEffect(() => {
    mountedRouteLoadingSkeletons += 1;
    return () => {
      mountedRouteLoadingSkeletons -= 1;
    };
  }, []);
  return (
    <div
      className={cn(
        SHELL_CLASS,
        !isBoundedPane && STANDALONE_SHELL_BLEED_CLASS,
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      data-testid="route-loading-skeleton"
    >
      <div
        className={cn(
          CHROME_ROW_CLASS,
          HEADER_SEAM_CLASS,
          "shrink-0 gap-2",
          isBoundedPane ? "px-4" : "px-3 pl-12",
        )}
      >
        <Skeleton className="h-4 w-40 max-w-[50%]" />
      </div>
      <div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-hidden px-4">
        {children}
      </div>
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
