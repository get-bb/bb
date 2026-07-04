import { useParams } from "react-router-dom";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import { PageShell } from "@/components/ui/page-shell.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { usePluginSlots } from "@/lib/plugin-slots";

// Plugins can render `@pierre/diffs` FileDiff (the specifier is shimmed to
// the host's copy); syntax highlighting needs a worker pool in React context.
// Thread routes get theirs from ThreadDetailRoute — nav panels get one here.
const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

/**
 * The route surface for plugin `navPanel` slots (plugin design §5.2):
 * /plugins/:pluginId/:panelPath renders the matching registered panel
 * component inside its per-plugin error boundary. An unknown panel (plugin
 * not loaded, disabled, or removed) degrades to a quiet placeholder — plugin
 * frontends load after first paint, so a deep link can land here briefly
 * before registrations arrive.
 *
 * This view renders ONLY the panel body. The title chrome (plugin logo +
 * panel title + the registration's `headerContent`) lives in the shared app
 * header — AppLayout's AppHeader + PluginPanelHeader — so plugin panels get
 * the same chrome as Settings/Automations. Body per the registration's
 * `chrome` (default "page"):
 * - "page": full-width PageShell body (no prose max-width cap).
 * - "none": the plugin component owns the entire body region — no host
 *   padding — with only the error boundary remaining.
 */
export function PluginPanelView() {
  const params = useParams<{
    pluginId: string;
    panelPath: string;
    "*": string;
  }>();
  const { pluginId, panelPath } = params;
  // The route's trailing splat: panel-internal location ("" at the root).
  const subPath = params["*"] ?? "";
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === pluginId && candidate.path === panelPath,
    ) ?? null;

  if (panel === null) {
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          This plugin panel is not available. The plugin may still be
          loading, or it has been disabled or removed.
        </EmptyStatePanel>
      </PageShell>
    );
  }

  // Generation in the key: a P3.4 reload remounts the slot (fresh
  // error-boundary state).
  const slotMount = (
    <PluginSlotMount
      key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
      pluginId={panel.pluginId}
      slotKind="navPanel"
      slotId={panel.id}
    >
      <panel.component subPath={subPath} />
    </PluginSlotMount>
  );
  // The provider spawns workers eagerly; environments without Worker
  // (jsdom tests) just render diffs unhighlighted.
  const mount =
    typeof Worker === "undefined" ? (
      slotMount
    ) : (
      <WorkerPoolContextProvider
        poolOptions={WORKER_POOL_OPTIONS}
        highlighterOptions={HIGHLIGHTER_OPTIONS}
      >
        {slotMount}
      </WorkerPoolContextProvider>
    );

  if (panel.chrome === "none") {
    // Full-bleed: the component owns the entire body region. The negative
    // margins undo the app layout's `p-4 md:p-5` route padding (same trick
    // as PageShell's bleed, plus the bottom edge).
    return (
      <div className="-m-4 flex min-h-0 flex-1 flex-col overflow-hidden md:-m-5">
        {mount}
      </div>
    );
  }

  return (
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-none">
      {mount}
    </PageShell>
  );
}
