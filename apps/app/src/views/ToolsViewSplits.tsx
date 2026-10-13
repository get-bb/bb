import { defineSplit } from "@/lib/define-split";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { SecondaryPanelContentSkeleton } from "@/components/secondary-panel/lazySecondaryPanelComponents";

export const LazyPluginsView = defineSplit<{ detailKey?: string }>({
  id: "plugins-view",
  load: () => import("./ToolsView").then((module) => module.PluginsView),
  loading: () => <RouteLoadingSkeleton isBoundedPane={false} />,
  tier: "intent",
});

export const LazyPluginDetailPaneView = defineSplit<{ pluginId: string }>({
  id: "plugin-detail-pane-view",
  load: () =>
    import("./ToolsView").then((module) => module.PluginDetailPaneView),
  loading: SecondaryPanelContentSkeleton,
  tier: "intent",
});
