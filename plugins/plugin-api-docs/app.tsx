import { PluginBrandIcon } from "@bb/shared-ui/plugin-icon";
import {
  copyPluginSurfaceAgentReference,
  firstPartyPluginId,
  ProductMap,
} from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useSdk,
  type PluginBrowserBbSdk,
} from "@get-bb/plugin-sdk/app";

export interface PluginReference {
  id: string;
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
}

export async function loadPluginReferences(
  sdk: Pick<PluginBrowserBbSdk, "plugins">,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, PluginReference>> {
  const [installed, catalog] = await Promise.all([
    sdk.plugins
      .list({ signal })
      .then((response) =>
        response.plugins.map(
          (plugin): PluginReference => ({
            id: plugin.id,
            icon: plugin.icon,
            iconUrl: plugin.iconUrl,
            iconTinted: true,
          }),
        ),
      )
      .catch((): PluginReference[] => []),
    sdk.plugins.catalog
      .search({ query: "", signal })
      .then((response) =>
        response.results.map(
          (result): PluginReference => ({
            id: result.pluginId,
            icon: result.icon,
            iconUrl: result.iconUrl,
            iconTinted: result.iconTinted,
          }),
        ),
      )
      .catch((): PluginReference[] => []),
  ]);
  return new Map([...catalog, ...installed].map((plugin) => [plugin.id, plugin]));
}

function usePluginReferences(): ReadonlyMap<string, PluginReference> {
  const sdk = useSdk();
  const [plugins, setPlugins] = useState<ReadonlyMap<string, PluginReference>>(
    () => new Map(),
  );
  useEffect(() => {
    const controller = new AbortController();
    void loadPluginReferences(sdk, controller.signal).then((references) => {
      if (!controller.signal.aborted) setPlugins(references);
    });
    return () => controller.abort();
  }, [sdk]);
  return plugins;
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
