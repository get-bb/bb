import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import {
  SETTINGS_PLUGINS_ROUTE_PATH,
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
  if (normalizedPathname === SETTINGS_PLUGINS_ROUTE_PATH) {
    return (
      <Navigate to={getToolsOwnedCollectionRoutePath("plugins")} replace />
    );
  }
  return children;
}
