import {
  copyPluginSurfaceAgentReference,
  firstPartyPluginId,
  ProductMap,
} from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";

interface PluginReference {
  id: string;
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
}

function usePluginReferences(): ReadonlyMap<string, PluginReference> {
  const [plugins, setPlugins] = useState<ReadonlyMap<string, PluginReference>>(
    () => new Map(),
  );
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string): Promise<PluginReference[]> => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const body: unknown = await response.json();
        const rows = Array.isArray(body)
          ? body
          : body !== null && typeof body === "object"
            ? "plugins" in body
              ? body.plugins
              : "results" in body
                ? body.results
                : []
            : [];
        if (!Array.isArray(rows)) return [];
        return rows.flatMap((row: unknown) => {
          if (row === null || typeof row !== "object") return [];
          const id =
            "pluginId" in row ? row.pluginId : "id" in row ? row.id : null;
          if (typeof id !== "string" || !id) return [];
          return [
            {
              id,
              icon:
                "icon" in row && typeof row.icon === "string" ? row.icon : null,
              iconUrl:
                "iconUrl" in row && typeof row.iconUrl === "string"
                  ? row.iconUrl
                  : null,
              iconTinted: !("iconTinted" in row) || row.iconTinted === true,
            },
          ];
        });
      } catch {
        return [];
      }
    };
    void Promise.all([
      read("/api/v1/plugins"),
      read("/api/v1/plugin-catalog/search?q="),
    ]).then(([installed, catalog]) => {
      if (!controller.signal.aborted) {
        setPlugins(
          new Map(
            [...catalog, ...installed].map((plugin) => [plugin.id, plugin]),
          ),
        );
      }
    });
    return () => controller.abort();
  }, []);
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
      const className = "inline-block size-3.5 shrink-0 text-subtle-foreground";
      if (plugin.iconUrl) {
        if (!plugin.iconTinted) {
          return <img src={plugin.iconUrl} alt="" className={className} />;
        }
        const maskImage = `url(${JSON.stringify(plugin.iconUrl)})`;
        return (
          <span
            aria-hidden="true"
            className={className}
            style={{
              backgroundColor: "currentColor",
              maskImage,
              maskPosition: "center",
              maskRepeat: "no-repeat",
              maskSize: "contain",
              WebkitMaskImage: maskImage,
              WebkitMaskPosition: "center",
              WebkitMaskRepeat: "no-repeat",
              WebkitMaskSize: "contain",
            }}
          />
        );
      }
      return plugin.icon ? (
        <Icon name={plugin.icon} className={className} aria-hidden />
      ) : null;
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
      className="h-full min-h-0 w-full flex-1 overflow-y-auto px-6 pb-6 pt-5 [container-type:size] [--guide-stage-gap:3cqh] lg:pb-0 lg:pt-4"
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
