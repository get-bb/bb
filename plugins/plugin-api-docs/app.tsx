// bb-plugin-plugin-api-docs frontend.
//
// The plugin API docs, inside bb. It renders the same product map the docs
// site does, one annotated surface fixture at a time, from the shared
// @bb/plugin-api-map package, so the two can never disagree about what bb can
// be extended with. Composer illustrations are deterministic fixtures, so
// globally installed plugins cannot rewrite the Guide's example UI.
//
// One surface, which the map itself documents: `navPanel`, the map as its own
// full-window page in the sidebar. The fixtures want the whole window, so
// there is deliberately no thread-panel tab.
import {
  copyPluginSurfaceAgentReference,
  firstPartyPluginId,
  ProductMap,
} from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";

/**
 * The plugin ids this bb can actually open a page for: the ones installed on
 * this machine, plus the ones its catalog lists. A built-in that is neither
 * (an uninstalled provider, say) has no page, and linking to it would land on
 * "Plugin not found" — so those names stay plain text.
 */
function useResolvablePluginIds(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url: string, pick: (row: never) => string) => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return [];
        const body = (await response.json()) as unknown;
        const rows = Array.isArray(body)
          ? body
          : ((body as { plugins?: unknown[]; results?: unknown[] }).plugins ??
            (body as { results?: unknown[] }).results ??
            []);
        return rows.map((row) => pick(row as never)).filter(Boolean);
      } catch {
        return [];
      }
    };
    void Promise.all([
      read("/api/v1/plugins", (row: { id?: string }) => row.id ?? ""),
      read(
        "/api/v1/plugin-catalog/search?q=",
        (row: { pluginId?: string }) => row.pluginId ?? "",
      ),
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
  // The slide lives in the panel's subPath (replace, not push), so history
  // entries record which screen the reader was on: coming Back from a plugin
  // detail page reopens the guide on that slide instead of the first one.
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
    // The page owns its scrolling: the host's nav-panel region is a clipped
    // flex column, so without this the part of the page below the fold (the
    // detail card, on a short window) is cut off rather than scrollable.
    // Full width, no reading-column cap: the fixture and its in-flow card use
    // the available panel width before either needs to scroll.
    //
    // data-guide-stage-viewport + the container declaration are ProductMap's
    // height contract: fixtures derive their scale from this scrollport's
    // height, and the stage-to-card gap grows with it (3cqh within its
    // clamp). Without a declared container the map keeps its 8px gap floor
    // and width-only scaling.
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
