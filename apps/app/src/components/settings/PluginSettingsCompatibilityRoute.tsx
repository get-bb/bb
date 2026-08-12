import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import { useToolsHubExperiment } from "@/components/tools/tools-experiment-context";
import { SETTINGS_PLUGINS_ROUTE_PATH } from "@/lib/route-paths";

/**
 * The Extensions collection replaces legacy plugin management while enabled.
 * Plugin-registered settings keep their own Settings routes in both modes.
 */
export function PluginSettingsCompatibilityRoute({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const toolsHubEnabled = useToolsHubExperiment();
  if (toolsHubEnabled && location.pathname === SETTINGS_PLUGINS_ROUTE_PATH) {
    return (
      <Navigate to={getToolsOwnedCollectionRoutePath("plugins")} replace />
    );
  }
  return children;
}
