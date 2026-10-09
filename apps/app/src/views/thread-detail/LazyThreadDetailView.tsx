import type { ComponentProps } from "react";
import { defineSplit } from "@/lib/define-split";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { ThreadTimelineLoadingSkeleton } from "@/components/thread/timeline/ThreadTimelineLoadingSkeleton";
import { usePaneContext } from "./PaneContext";
import type { ThreadDetailView } from "./ThreadDetailView";

function ThreadDetailViewLoading() {
  const { isBoundedPane } = usePaneContext();
  return (
    <RouteLoadingSkeleton isBoundedPane={isBoundedPane}>
      <ThreadTimelineLoadingSkeleton />
    </RouteLoadingSkeleton>
  );
}

export const LazyThreadDetailView = defineSplit<
  ComponentProps<typeof ThreadDetailView>
>({
  id: "thread-detail",
  tier: "preload",
  load: () =>
    import("./ThreadDetailView").then((module) => module.ThreadDetailView),
  loading: ThreadDetailViewLoading,
});
