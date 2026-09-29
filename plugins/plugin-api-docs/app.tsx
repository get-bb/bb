import { PluginBrandIcon } from "@/components/ui/plugin-icon";
import { useCallback, useMemo } from "react";
import {
  definePluginApp,
  useBbNavigate,
  experimental_usePlugins,
  experimental_usePluginCatalogSearch,
} from "@get-bb/plugin-sdk/app";
import { copyPluginSurfaceAgentReference } from "./src/agent-reference";
import { firstPartyPluginId } from "./src/plugin-icons";
import { ProductMap } from "./src/product-map";

export interface PluginReference {
  id: string;
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
}

function usePluginReferences(): ReadonlyMap<string, PluginReference> {
  const installed = experimental_usePlugins();
  const catalog = experimental_usePluginCatalogSearch({ query: "" });
  return useMemo(
    () =>
      new Map([
        ...(catalog.data?.results ?? []).map(
          (plugin): [string, PluginReference] => [
            plugin.pluginId,
            {
              id: plugin.pluginId,
              icon: plugin.icon,
              iconUrl: plugin.iconUrl,
              iconTinted: plugin.iconTinted,
            },
          ],
        ),
        ...(installed.data?.plugins ?? []).map(
          (plugin): [string, PluginReference] => [
            plugin.id,
            {
              id: plugin.id,
              icon: plugin.icon,
              iconUrl: plugin.iconUrl,
              iconTinted: true,
            },
          ],
        ),
      ]),
    [installed.data, catalog.data],
  );
}

function PluginApiMapPage({ subPath }: { subPath: string }) {
  const plugins = usePluginReferences();
  const bbNavigate = useBbNavigate();
  const pluginPageHref = useCallback(
    (displayName: string) => {
      const id = firstPartyPluginId(displayName);
      if (!id || !plugins.has(id)) return null;
      return `/plugins/${id}`;
    },
    [plugins],
  );
  const renderPluginIcon = useCallback(
    (displayName: string) => {
      const id = firstPartyPluginId(displayName);
      const plugin = id ? plugins.get(id) : undefined;
      if (!plugin) return null;
      return (
        <PluginBrandIcon
          icon={plugin.icon}
          iconUrl={plugin.iconUrl}
          iconTinted={plugin.iconTinted}
          className="inline-block size-3.5 shrink-0 text-subtle-foreground"
        />
      );
    },
    [plugins],
  );
  const onSlideChange = useCallback(
    (slideId: string) => {
      bbNavigate.toPluginPanel("plugin-api", {
        subPath: slideId,
        replace: true,
      });
    },
    [bbNavigate],
  );
  return (
    <div
      data-guide-stage-viewport
      className="h-full min-h-0 w-full flex-1 overflow-y-auto px-3 pb-6 pt-5 sm:px-6 [container-type:size] [--guide-stage-gap:3cqh] lg:pb-0 lg:pt-4"
    >
      <ProductMap
        pluginPageHref={pluginPageHref}
        renderPluginIcon={renderPluginIcon}
        initialSlideId={subPath.split("/")[0] || undefined}
        onSlideChange={onSlideChange}
        onCopyForAgent={copyPluginSurfaceAgentReference}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api",
    title: "Plugin Guide",
    icon: "Puzzle",
    path: "plugin-api",
    component: PluginApiMapPage,
  });
});
