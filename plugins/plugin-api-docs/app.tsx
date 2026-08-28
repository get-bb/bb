import {
  copyPluginSurfaceAgentReference,
  firstPartyPluginId,
  ProductMap,
} from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  type JsonValue,
} from "@get-bb/plugin-sdk/app";

type JsonObject = { [key: string]: JsonValue };

interface PluginIdRow {
  id?: string;
  pluginId?: string;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

function isStringValue(value: JsonValue | undefined): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function pluginIdRow(value: JsonValue): PluginIdRow | null {
  if (!isJsonObject(value)) return null;
  const id = isStringValue(value.id) ? value.id : undefined;
  const pluginId = isStringValue(value.pluginId) ? value.pluginId : undefined;
  return id === undefined && pluginId === undefined ? null : { id, pluginId };
}

function pluginIdRows(value: JsonValue): PluginIdRow[] {
  if (Array.isArray(value))
    return value.flatMap((row) => {
      const parsed = pluginIdRow(row);
      return parsed === null ? [] : [parsed];
    });
  if (!isJsonObject(value)) return [];
  const rows = Array.isArray(value.plugins)
    ? value.plugins
    : Array.isArray(value.results)
      ? value.results
      : [];
  return rows.flatMap((row) => {
    const parsed = pluginIdRow(row);
    return parsed === null ? [] : [parsed];
  });
}
type PluginIdField = "id" | "pluginId";

function useResolvablePluginIds(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (
      url: string,
      field: PluginIdField,
    ): Promise<string[]> => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const rows = pluginIdRows(await response.json());
        return rows.flatMap((row) => (row[field] ? [row[field]] : []));
      } catch {
        return [];
      }
    };
    void Promise.all([
      read("/api/v1/plugins", "id"),
      read("/api/v1/plugin-catalog/search?q=", "pluginId"),
    ]).then(([installed, catalog]) => {
      if (!controller.signal.aborted) {
        setIds(new Set([...installed, ...catalog]));
      }
    });
    return () => controller.abort();
  }, []);
  return ids;
}

function PluginApiMapPage({ subPath }: { subPath: string }) {
  const resolvable = useResolvablePluginIds();
  const bbNavigate = useBbNavigate();
  const pluginPageHref = useCallback(
    (displayName: string) => {
      const id = firstPartyPluginId(displayName);
      if (!id || !resolvable?.has(id)) return null;
      return `/extensions/plugins/${id}`;
    },
    [resolvable],
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
