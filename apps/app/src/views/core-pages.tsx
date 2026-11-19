import { lazy, Suspense } from "react";
import { useLocation } from "react-router-dom";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import { trackCriticalLoad } from "@/lib/split-prefetch";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { ThreadTimelineLoadingSkeleton } from "@/components/thread/timeline/ThreadTimelineLoadingSkeleton";
import { useRouteState } from "@/hooks/useRouteState";
import { APP_ROOT_ROUTE_PATH } from "@/lib/route-paths";

export const CORE_PAGE_PLUGIN_ID = "core";

let splitWorkspaceRouteModule: Promise<
  typeof import("./SplitWorkspaceRoute")
> | null = null;

export function loadCoreWorkspacePage() {
  if (splitWorkspaceRouteModule === null) {
    splitWorkspaceRouteModule = trackCriticalLoad(
      import("./SplitWorkspaceRoute"),
    );
    splitWorkspaceRouteModule.catch(() => {});
  }
  return splitWorkspaceRouteModule;
}

const SplitWorkspaceRoute = lazy(loadCoreWorkspacePage);

export function CoreWorkspacePage() {
  const { isThreadView } = useRouteState();
  const isRootComposeView = useLocation().pathname === APP_ROOT_ROUTE_PATH;
  return (
    <Suspense
      fallback={
        <RouteLoadingSkeleton
          isBoundedPane={false}
          variant={isRootComposeView ? "root-compose" : "default"}
        >
          {isThreadView ? <ThreadTimelineLoadingSkeleton /> : null}
        </RouteLoadingSkeleton>
      }
    >
      <SplitWorkspaceRoute />
    </Suspense>
  );
}

export const corePages = collectPluginAppRegistrations(
  definePluginApp((app) => {
    app.slots.experimental_page({
      id: "workspace",
      title: "bb",
      routes: ["home", "thread"],
      chrome: { sidebar: "shown" },
      component: CoreWorkspacePage,
    });
  }),
).pages.map((slot) => ({
  ...slot,
  pluginId: CORE_PAGE_PLUGIN_ID,
  generation: 0,
}));
