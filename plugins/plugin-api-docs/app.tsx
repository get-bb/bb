// bb-plugin-plugin-api-docs frontend.
//
// The plugin API docs, inside bb. It renders the same product map the docs
// site does, one annotated skeleton of the bb UI at a time, from the shared
// @bb/plugin-api-map package, so the two can never disagree about what bb can
// be extended with. Because this copy runs inside bb, both composers in the
// diagrams are the host's real experimental_NewThreadComposer: live on the
// Home slide, inert on the composer slide, where it is annotated in place
// and no live menu can open over the annotations.
//
// One surface, which the map itself documents: `navPanel`, the map as its own
// full-window page in the sidebar. The skeletons want the whole window, so
// there is deliberately no thread-panel tab.
import {
  firstPartyPluginId,
  pluginSurfaceAgentMention,
  ProductMap,
  type PluginSurface,
} from "@bb/plugin-api-map";
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer,
  useBbNavigate,
  useComposer,
} from "@get-bb/plugin-sdk/app";

// JSX reads lowercase-first tags as DOM elements, so the experimental_
// export needs a capitalized alias to render as a component.
const LiveNewThreadComposer = experimental_NewThreadComposer;

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
  const composer = useComposer();
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
  const onCopyForAgent = useCallback(
    (surface: PluginSurface) =>
      composer.experimental_copyMention(pluginSurfaceAgentMention(surface)),
    [composer],
  );
  return (
    // The page owns its scrolling: the host's nav-panel region is a clipped
    // flex column, so without this the part of the page below the fold (the
    // detail card, on a short window) is cut off rather than scrollable.
    // Full width, no reading-column cap: the wider the page, the more room
    // the annotation cards have to open beside the skeleton instead of below.
    <div className="h-full min-h-0 w-full flex-1 overflow-y-auto px-6 pb-6 pt-5">
      <ProductMap
        pluginPageHref={pluginPageHref}
        initialSlideId={subPath.split("/")[0] || undefined}
        onSlideChange={onSlideChange}
        onCopyForAgent={onCopyForAgent}
        realComposer={
          <LiveNewThreadComposer
            layout="document"
            // Its own draft key with a short seed: the Home diagram's
            // composer is width-capped to the product's ratio, and the draft
            // must hold one line there so the diagram keeps its proportions.
            draftKey="home-anatomy-2"
            initialPrompt="Fix the flaky checkout tests"
            // Illustration, not a working surface: another plugin's composer
            // UI (an inline action, a banner) must not land inside the
            // diagram, and nothing must rewrite the seeded example draft.
            experimental_pluginCustomizations="none"
            // A docs page should never create threads; the draft is kept.
            onSubmit={() => {
              throw new Error("Submitting is disabled in the docs preview.");
            }}
          />
        }
        annotatedComposer={
          <LiveNewThreadComposer
            layout="document"
            // Its own draft key: the anatomy diagram must keep this exact
            // one-line draft (the overlay markers anchor to it) no matter
            // what gets typed into the Home slide's live copy.
            draftKey="composer-anatomy-2"
            initialPrompt="Summarize @release-notes and fix the TODO in checkout."
            experimental_pluginCustomizations="none"
            onSubmit={() => {
              throw new Error("Submitting is disabled in the docs preview.");
            }}
          />
        }
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "plugin-api",
    title: "bb Plugin Guide",
    icon: "Puzzle",
    path: "plugin-api",
    component: PluginApiMapPage,
  });
});
