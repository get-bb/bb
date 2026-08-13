import type { ReactNode } from "react";
import { matchPath, Navigate, useLocation } from "react-router-dom";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import {
  getPluginConfigurationRoutePath,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
} from "@/lib/route-paths";

/**
 * The Extensions collection replaces legacy plugin management.
 * Plugin-registered settings keep their own Settings routes.
 */
export function PluginSettingsCompatibilityRoute({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const normalizedPathname = location.pathname.replace(/\/+$/u, "");
  const detailMatch = matchPath(SETTINGS_PLUGIN_ROUTE_PATH, normalizedPathname);
  const pluginId = detailMatch?.params.pluginId;
  if (pluginId !== undefined) {
    return (
      <Navigate to={getPluginConfigurationRoutePath({ pluginId })} replace />
    );
  }
  if (normalizedPathname === SETTINGS_PLUGINS_ROUTE_PATH) {
    return (
      <Navigate to={getToolsOwnedCollectionRoutePath("plugins")} replace />
    );
  }
  return children;
}
