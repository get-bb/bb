import type { QueryClient } from "@tanstack/react-query";
import type { InstalledPlugin } from "@bb/server-contract";
import { pluginListQueryOptions } from "@/hooks/queries/plugin-settings-queries";
import { readFirstScreenOwners } from "./plugin-first-screen-owners";

type PluginFrontendBundle = NonNullable<InstalledPlugin["app"]["bundle"]>;

export function loadablePluginFrontendBundle(
  plugin: InstalledPlugin,
): PluginFrontendBundle | null {
  if (
    plugin.status !== "running" &&
    plugin.status !== "needs-configuration" &&
    plugin.status !== "degraded"
  ) {
    return null;
  }
  return plugin.app.bundle;
}

export function preloadModule(href: string): void {
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  for (const existing of document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel="modulepreload"]',
  )) {
    if (existing.href === link.href) return;
  }
  document.head.append(link);
}

interface PreloadFirstScreenPluginBundlesArgs {
  preload: (href: string) => void;
  queryClient: QueryClient;
}

export async function preloadFirstScreenPluginBundles({
  preload,
  queryClient,
}: PreloadFirstScreenPluginBundlesArgs): Promise<void> {
  const owners = new Set(readFirstScreenOwners());
  if (owners.size === 0) return;
  let plugins: InstalledPlugin[];
  try {
    plugins = await queryClient.fetchQuery(
      pluginListQueryOptions({ enabled: true }),
    );
  } catch {
    return;
  }
  for (const plugin of plugins) {
    if (!owners.has(plugin.id)) continue;
    const bundle = loadablePluginFrontendBundle(plugin);
    if (bundle !== null) preload(bundle.jsUrl);
  }
}
