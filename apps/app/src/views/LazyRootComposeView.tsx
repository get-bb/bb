import { defineSplit } from "@/lib/define-split";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { usePaneContext } from "./thread-detail/PaneContext";

function RootComposeViewLoading() {
  const { isBoundedPane } = usePaneContext();
  return (
    <RouteLoadingSkeleton
      isBoundedPane={isBoundedPane}
      variant="root-compose"
    />
  );
}

export const LazyRootComposeView = defineSplit({
  id: "root-compose",
  tier: "preload",
  load: () =>
    import("./RootComposeView").then((module) => module.RootComposeView),
  loading: RootComposeViewLoading,
});
