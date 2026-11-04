import { useEffect } from "react";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";
import { usePluginFrontendBootComplete } from "@/lib/plugin-frontend-boot-state";
import { getPluginPanelRoutePluginId } from "@/lib/route-paths";

const PLUGIN_SURFACES = [
  "composer",
  "thread-list",
  "sidebar-navigation",
  "thread-panel-tab",
] as const;

export type PluginSurface = (typeof PLUGIN_SURFACES)[number];

const DEFAULT_SURFACE_PROVIDERS: Record<PluginSurface, string | null> = {
  composer: "bb--composer",
  "thread-list": "thread-list",
  "sidebar-navigation": "navigation",
  "thread-panel-tab": null,
};

const surfaceProviderCache = createLastKnownCache({
  prefix: "bb.plugin-surface-provider",
  version: "2",
  schema: z.object({ pluginId: z.string().min(1).nullable() }),
});

export function expectedSurfaceProviderIds(): string[] {
  const ids = PLUGIN_SURFACES.flatMap((surface) => {
    const remembered = surfaceProviderCache.read(
      surfaceProviderCache.key(surface),
    );
    const pluginId =
      remembered === null
        ? DEFAULT_SURFACE_PROVIDERS[surface]
        : remembered.pluginId;
    return pluginId === null ? [] : [pluginId];
  });
  return [...new Set(ids)];
}

export function frontendPriorityPluginIds(pathname: string): string[] {
  const routePluginId = getPluginPanelRoutePluginId(pathname);
  return [
    ...new Set([
      ...(routePluginId === null ? [] : [routePluginId]),
      ...expectedSurfaceProviderIds(),
    ]),
  ];
}

export function useRememberSurfaceProvider(
  surface: PluginSurface,
  pluginId: string | null,
): void {
  const bootComplete = usePluginFrontendBootComplete();
  useEffect(() => {
    if (pluginId === null && !bootComplete) return;
    const key = surfaceProviderCache.key(surface);
    if (surfaceProviderCache.read(key)?.pluginId !== pluginId) {
      surfaceProviderCache.write(key, { pluginId });
    }
  }, [bootComplete, pluginId, surface]);
}
