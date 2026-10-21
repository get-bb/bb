import { HEADER_SEAM_CLASS } from "@/components/layout/AppPageHeader";
import {
  useIsSidebarFramed,
  useOptionalIsSidebarShowing,
} from "@/components/ui/sidebar.js";
import {
  CHROME_ROW_CLASS,
  MACOS_TITLE_BAR_BAND_CLASS,
  MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { useEffect, type ReactNode } from "react";

interface RouteLoadingSkeletonProps {
  children?: ReactNode;
  isBoundedPane: boolean;
  variant?: "default" | "root-compose";
}

let mountedRouteLoadingSkeletons = 0;

export function isRouteLoadingSkeletonMounted(): boolean {
  return mountedRouteLoadingSkeletons > 0;
}

const SHELL_CLASS = "flex h-full min-h-0 flex-1 flex-col overflow-hidden";
const STANDALONE_SHELL_BLEED_CLASS =
  "-mx-4 -mt-4 -mb-4 md:-mx-5 md:-mt-5 md:-mb-5";

export function RouteLoadingSkeleton({
  children,
  isBoundedPane,
  variant = "default",
}: RouteLoadingSkeletonProps) {
  const isRootCompose = variant === "root-compose";
  const isCompactViewport = useIsCompactViewport();
  const isSidebarFramed = useIsSidebarFramed();
  const isSidebarShowing = useOptionalIsSidebarShowing();
  const isInTitleBar = isSidebarFramed && !isBoundedPane;
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
        (!isBoundedPane || isRootCompose) && STANDALONE_SHELL_BLEED_CLASS,
        isRootCompose && "pt-(--bb-window-frame-top)",
      )}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      data-testid="route-loading-skeleton"
    >
      {!isRootCompose ? (
        <div
          className={cn(
            CHROME_ROW_CLASS,
            "shrink-0 gap-2",
            isInTitleBar
              ? [MACOS_TITLE_BAR_BAND_CLASS, "px-4"]
              : [HEADER_SEAM_CLASS, isBoundedPane ? "px-4" : "px-3 pl-12"],
          )}
        >
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center",
              isInTitleBar &&
                isSidebarShowing === false &&
                MACOS_TITLE_BAR_COLLAPSED_SIDEBAR_RESERVE_CLASS,
            )}
          >
            <Skeleton className="h-4 w-40 max-w-[50%]" />
          </div>
        </div>
      ) : null}
      {isRootCompose ? (
        <div
          className={cn(
            "mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-4 pb-4",
            isCompactViewport ? "justify-end pt-2" : "pt-14",
          )}
        >
          <Skeleton className="h-32 w-full shrink-0 rounded-xl max-md:pointer-coarse:h-34" />
          <div className="mt-1 flex h-8 shrink-0 items-center justify-between px-3.5 max-md:mt-0 max-md:px-1 max-md:pointer-coarse:h-11">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-24 max-md:w-12" />
          </div>
        </div>
      ) : (
        <>
          <div className="mx-auto min-h-0 w-full max-w-[760px] flex-1 overflow-hidden px-4 pt-4">
            {children}
          </div>
          <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
            <div className="pb-7 max-md:pb-6 max-md:pointer-coarse:pb-11">
              <Skeleton className="h-[151px] w-full rounded-xl" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
