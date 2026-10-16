import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { sdk } from "@/lib/sdk";
import { getPluginPanelRoutePluginId } from "@/lib/route-paths";

export function recordPluginPanelOpen(pluginId: string): void {
  try {
    void sdk.plugins
      .experimental_recordPanelOpen({ pluginId })
      .catch(() => undefined);
  } catch {}
}

export function usePluginPageUsage(): void {
  const { pathname } = useLocation();
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current === pathname) return;
    const previousPlugin = getPluginPanelRoutePluginId(previous.current);
    const pluginId = getPluginPanelRoutePluginId(pathname);
    previous.current = pathname;
    if (pluginId !== null && pluginId !== previousPlugin)
      recordPluginPanelOpen(pluginId);
  }, [pathname]);
}
