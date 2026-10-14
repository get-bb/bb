import { useEffect, useRef } from "react";
import { matchPath, useLocation } from "react-router-dom";
import {
  getRootComposeRoutePath,
  isToolsRoutePath,
  SETTINGS_ROUTE_PATH,
  LEGACY_PROJECT_SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";

interface AppSettingsRouteMemory {
  appRoutePath: string;
  settingsRoutePath: string;
  toolsBackRoutePath: string;
}

function getLocationRoutePath(location: {
  pathname: string;
  search: string;
  hash: string;
}): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function isSettingsRoutePath(pathname: string): boolean {
  return (
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null ||
    matchPath(LEGACY_PROJECT_SETTINGS_ROUTE_PATH, pathname) !== null
  );
}

export interface AppSettingsRoute {
  routePath: string;
  isSettingsRoute: boolean;
  isToolsRoute: boolean;
}

export interface AppSettingsRouteMemoryState {
  lastAppRoutePath: string;
  lastCoreAppRoutePath: string;
  lastSettingsRoutePath: string;
}

export function classifyAppSettingsRoute(location: {
  pathname: string;
  search: string;
  hash: string;
}): AppSettingsRoute {
  return {
    routePath: getLocationRoutePath(location),
    isSettingsRoute: isSettingsRoutePath(location.pathname),
    isToolsRoute: isToolsRoutePath(location.pathname),
  };
}

export function createAppSettingsRouteMemory(
  route: AppSettingsRoute,
): AppSettingsRouteMemoryState {
  return {
    lastAppRoutePath: route.isSettingsRoute
      ? getRootComposeRoutePath()
      : route.routePath,
    lastCoreAppRoutePath:
      route.isSettingsRoute || route.isToolsRoute
        ? getRootComposeRoutePath()
        : route.routePath,
    lastSettingsRoutePath: route.isSettingsRoute
      ? route.routePath
      : SETTINGS_ROUTE_PATH,
  };
}

export function advanceAppSettingsRouteMemory(
  state: AppSettingsRouteMemoryState,
  route: AppSettingsRoute,
): AppSettingsRouteMemoryState {
  if (route.isSettingsRoute) {
    return { ...state, lastSettingsRoutePath: route.routePath };
  }
  if (route.isToolsRoute) {
    return { ...state, lastAppRoutePath: route.routePath };
  }
  return {
    ...state,
    lastAppRoutePath: route.routePath,
    lastCoreAppRoutePath: route.routePath,
  };
}

export function resolveAppSettingsRouteMemory(
  state: AppSettingsRouteMemoryState,
  route: AppSettingsRoute,
): AppSettingsRouteMemory {
  return {
    appRoutePath: route.isSettingsRoute
      ? state.lastAppRoutePath
      : route.routePath,
    settingsRoutePath: route.isSettingsRoute
      ? route.routePath
      : state.lastSettingsRoutePath,
    toolsBackRoutePath: route.isToolsRoute
      ? state.lastCoreAppRoutePath
      : route.routePath,
  };
}

export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const route = classifyAppSettingsRoute(useLocation());
  const memoryRef = useRef(createAppSettingsRouteMemory(route));
  const { routePath, isSettingsRoute, isToolsRoute } = route;

  useEffect(() => {
    memoryRef.current = advanceAppSettingsRouteMemory(memoryRef.current, {
      routePath,
      isSettingsRoute,
      isToolsRoute,
    });
  }, [routePath, isSettingsRoute, isToolsRoute]);

  return resolveAppSettingsRouteMemory(memoryRef.current, route);
}
