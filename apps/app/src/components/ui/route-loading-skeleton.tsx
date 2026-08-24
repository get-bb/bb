import { HEADER_SEAM_CLASS } from "@/components/layout/AppPageHeader";
import { CHROME_ROW_CLASS } from "@/lib/bb-desktop";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";

/**
 * Bleed to the edges of the AppLayout <main> padding, the same way PageShell
 * does, so the skeleton chrome lands where the real pane header and composer
 * will paint. Kept as a literal instead of importing PageShell: PageShell pulls
 * in the bottom-anchored scroll body, which is not on the boot path and must
 * stay off it — this component renders while the route chunk is still loading.
 */
const SHELL_BLEED_CLASS =
  "-mx-4 -mt-4 flex h-full min-h-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mt-5";

/**
 * Lightweight stand-in for a thread or new-thread pane while its code or data
 * is still loading: a header row on the shared chrome axis plus the composer
 * footprint at the bottom. Reused as the route-level Suspense fallback and by
 * the views' own loading branches, so the page keeps one silhouette from the
 * first paint until the real content mounts.
 */
export function RouteLoadingSkeleton() {
  return (
    <div
      className={SHELL_BLEED_CLASS}
      role="status"
      aria-busy="true"
      aria-label="Loading"
      data-testid="route-loading-skeleton"
    >
      <div
        className={cn(
          CHROME_ROW_CLASS,
          HEADER_SEAM_CLASS,
          "shrink-0 gap-2 px-3 pl-12",
        )}
      >
        <Skeleton className="h-4 w-40 max-w-[50%]" />
      </div>
      <div className="min-h-0 flex-1" />
      <div className="mx-auto w-full max-w-[760px] shrink-0 px-4 pb-4">
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}
