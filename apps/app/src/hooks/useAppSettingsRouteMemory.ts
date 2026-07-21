import { useEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";
import {
  getRootComposeRoutePath,
  getSkillsRoutePath,
  SETTINGS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
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

function isToolsRoute(pathname: string): boolean {
  return (
    pathname === TOOLS_ROUTE_PATH ||
    matchPath(`${TOOLS_ROUTE_PATH}/*`, pathname) !== null
  );
}

/**
 * Remembers the most recently visited core-app, Tools, and global Settings
 * routes while the app shell is mounted. Each focused sidebar can return to
 * the right parent context without resetting another surface to its root.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  const currentRoutePath = getLocationRoutePath(location);
  const isSettingsRoute = isGlobalSettingsRoute(location.pathname);
  const isCurrentToolsRoute = isToolsRoute(location.pathname);
  const lastAppRoutePathRef = useRef(
    isSettingsRoute ? getRootComposeRoutePath() : currentRoutePath,
  );
  const lastCoreAppRoutePathRef = useRef(
    isSettingsRoute || isCurrentToolsRoute
      ? getRootComposeRoutePath()
      : currentRoutePath,
  );
  const lastSettingsRoutePathRef = useRef(
    isSettingsRoute ? currentRoutePath : SETTINGS_ROUTE_PATH,
  );
  const lastToolsRoutePathRef = useRef(
    isCurrentToolsRoute ? currentRoutePath : getSkillsRoutePath(),
  );

  useEffect(() => {
    if (isSettingsRoute) {
      lastSettingsRoutePathRef.current = currentRoutePath;
      return;
    }
    lastAppRoutePathRef.current = currentRoutePath;
    if (isCurrentToolsRoute) {
      lastToolsRoutePathRef.current = currentRoutePath;
      return;
    }
    lastCoreAppRoutePathRef.current = currentRoutePath;
  }, [currentRoutePath, isCurrentToolsRoute, isSettingsRoute]);

  return {
    appRoutePath: isSettingsRoute
      ? lastAppRoutePathRef.current
      : currentRoutePath,
    settingsRoutePath: isSettingsRoute
      ? currentRoutePath
      : lastSettingsRoutePathRef.current,
    toolsRoutePath: isCurrentToolsRoute
      ? currentRoutePath
      : lastToolsRoutePathRef.current,
    toolsBackRoutePath: isCurrentToolsRoute
      ? lastCoreAppRoutePathRef.current
      : currentRoutePath,
  };
}
