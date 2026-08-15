import { useEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";
import {
  getRootComposeRoutePath,
  getPluginsRoutePath,
  isToolsRoutePath,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";

interface AppSettingsRouteMemory {
  appRoutePath: string;
  settingsRoutePath: string;
  toolsRoutePath: string;
  toolsBackRoutePath: string;
}

function getLocationRoutePath(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function isGlobalSettingsRoute(pathname: string): boolean {
  return matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null;
}

function isPluginSettingsCompatibilityRoute(pathname: string): boolean {
  // Only the bare /settings/plugins list is legacy — it redirects to the
  // Extensions collection. /settings/plugins/:pluginId is a real Settings
  // page now that Settings hosts plugin configuration, so it participates in
  // settings route memory like any other section.
  return matchPath(SETTINGS_PLUGINS_ROUTE_PATH, pathname) !== null;
}

/**
 * Remembers the most recently visited core-app and global Settings routes
 * while the app shell is mounted. Extensions route memory is intentionally
 * scoped to its mounted sidebar; leaving Extensions resets its entry route.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  const currentRoutePath = getLocationRoutePath(location);
  const isCompatibilityRoute = isPluginSettingsCompatibilityRoute(
    location.pathname,
  );
  const isSettingsRoute =
    !isCompatibilityRoute && isGlobalSettingsRoute(location.pathname);
  const isCurrentToolsRoute = isToolsRoutePath(location.pathname);
  const lastAppRoutePathRef = useRef(
    isSettingsRoute || isCompatibilityRoute
      ? getRootComposeRoutePath()
      : currentRoutePath,
  );
  const lastCoreAppRoutePathRef = useRef(
    isSettingsRoute || isCurrentToolsRoute || isCompatibilityRoute
      ? getRootComposeRoutePath()
      : currentRoutePath,
  );
  const lastSettingsRoutePathRef = useRef(
    isSettingsRoute ? currentRoutePath : SETTINGS_ROUTE_PATH,
  );

  useEffect(() => {
    if (isCompatibilityRoute) {
      return;
    }
    if (isSettingsRoute) {
      lastSettingsRoutePathRef.current = currentRoutePath;
      return;
    }
    lastAppRoutePathRef.current = currentRoutePath;
    if (isCurrentToolsRoute) {
      return;
    }
    lastCoreAppRoutePathRef.current = currentRoutePath;
  }, [
    currentRoutePath,
    isCompatibilityRoute,
    isCurrentToolsRoute,
    isSettingsRoute,
  ]);

  return {
    appRoutePath:
      isSettingsRoute || isCompatibilityRoute
        ? lastAppRoutePathRef.current
        : currentRoutePath,
    settingsRoutePath: isSettingsRoute
      ? currentRoutePath
      : lastSettingsRoutePathRef.current,
    toolsRoutePath: isCurrentToolsRoute
      ? currentRoutePath
      : getPluginsRoutePath(),
    toolsBackRoutePath:
      isCurrentToolsRoute || isCompatibilityRoute
        ? lastCoreAppRoutePathRef.current
        : currentRoutePath,
  };
}
