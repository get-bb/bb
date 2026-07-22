import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  getPluginDetailRoutePath,
  getPluginsRoutePath,
} from "@/lib/route-paths";

/** Keeps the existing Settings manager available while Tools Hub is off. */
export function PluginSettingsCompatibilityRoute({
  children,
}: {
  children: ReactNode;
}) {
  const { pluginId } = useParams<{ pluginId?: string }>();
  const systemConfig = useSystemConfig();
  const toolsHubEnabled = systemConfig.data?.experiments.toolsHub;

  if (toolsHubEnabled === undefined) return null;
  if (!toolsHubEnabled) return children;

  return (
    <Navigate
      to={
        pluginId
          ? getPluginDetailRoutePath({ pluginId })
          : getPluginsRoutePath()
      }
      replace
    />
  );
}
