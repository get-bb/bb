import { lazy, useMemo } from "react";
import { disableGlobalCursorStyles } from "react-resizable-panels";
import { matchPath, Navigate, useLocation } from "react-router-dom";
import { useAtomValue } from "jotai";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { holdsPluginDetailPane } from "@/lib/split-layout/openPaneContentInSplit";
import "@bb/shared-ui/icon-extended";
import {
  APP_ROOT_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PLUGIN_DETAIL_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
} from "@/lib/route-paths";
import type { PaneContent } from "@/lib/split-layout";
import { useRouteState } from "@/hooks/useRouteState";
import { parseDraftRouteId } from "@/lib/draft-route";
import {
  RootComposeView,
  LegacyProjectComposeRedirect,
} from "./RootComposeView";
import { SplitThreadArea } from "./thread-detail/SplitThreadArea";

disableGlobalCursorStyles();

const PluginsView = lazy(() =>
  import("./ToolsView").then((m) => ({ default: m.PluginsView })),
);

export default function SplitWorkspaceRoute() {
  const location = useLocation();
  const { projectId, threadId, isThreadView } = useRouteState();
  const pluginMatch = matchPath(PLUGIN_PANEL_ROUTE_PATH, location.pathname);
  const pluginDetailMatch = matchPath(
    PLUGIN_DETAIL_ROUTE_PATH,
    location.pathname,
  );
  const legacyProjectMatch = matchPath(
    LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
    location.pathname,
  );
  const pluginId = pluginMatch?.params.pluginId;
  const panelPath = pluginMatch?.params.panelPath;
  const pluginSubPath = pluginMatch?.params["*"] ?? "";
  const detailPluginId = pluginDetailMatch?.params.pluginId;

  const routeContent = useMemo<PaneContent | null>(() => {
    if (location.pathname === APP_ROOT_ROUTE_PATH) {
      const draftId = parseDraftRouteId(location.search);
      return draftId === null ? null : { kind: "new-thread", draftId };
    }
    if (isThreadView && projectId && threadId) {
      return { kind: "thread", projectId, threadId };
    }
    if (detailPluginId) {
      return { kind: "plugin-detail", pluginId: detailPluginId };
    }
    if (pluginId && panelPath) {
      return {
        kind: "plugin-panel",
        pluginId,
        panelPath,
        subPath: pluginSubPath,
      };
    }
    return null;
  }, [
    detailPluginId,
    isThreadView,
    location.pathname,
    location.search,
    panelPath,
    pluginId,
    pluginSubPath,
    projectId,
    threadId,
  ]);

  const layout = useAtomValue(splitLayoutAtom);

  const legacyProjectId = legacyProjectMatch?.params.projectId;
  if (legacyProjectId) {
    return <LegacyProjectComposeRedirect projectId={legacyProjectId} />;
  }
  if (location.pathname === APP_ROOT_ROUTE_PATH && routeContent === null) {
    return <RootComposeView />;
  }
  if (routeContent === null) {
    return <Navigate to={APP_ROOT_ROUTE_PATH} replace />;
  }
  if (
    routeContent.kind === "plugin-detail" &&
    !holdsPluginDetailPane(layout, routeContent.pluginId)
  ) {
    return <PluginsView pluginId={routeContent.pluginId} />;
  }
  return <SplitThreadArea routeContent={routeContent} />;
}
