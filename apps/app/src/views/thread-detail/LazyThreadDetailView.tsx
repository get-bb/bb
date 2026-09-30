import type { ComponentProps } from "react";
import { defineSplit } from "@/lib/define-split";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import type { ThreadDetailView } from "./ThreadDetailView";

export const LazyThreadDetailView = defineSplit<
  ComponentProps<typeof ThreadDetailView>
>({
  id: "thread-detail",
  preload: "render",
  load: () =>
    import("./ThreadDetailView").then((module) => module.ThreadDetailView),
  loading: ({ surface }) => (
    <RouteLoadingSkeleton isBoundedPane={surface === "pane"} />
  ),
});
