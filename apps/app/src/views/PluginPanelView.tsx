import { useParams } from "react-router-dom";
import { PageShell } from "@/components/ui/page-shell.js";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { usePluginSlots } from "@/lib/plugin-slots";

/**
 * The route surface for plugin `navPanel` slots (plugin design §5.2):
 * /plugins/:pluginId/:panelPath renders the matching registered panel
 * component inside its per-plugin error boundary. An unknown panel (plugin
 * not loaded, disabled, or removed) degrades to a quiet placeholder — plugin
 * frontends load after first paint, so a deep link can land here briefly
 * before registrations arrive.
 *
 * This view renders ONLY the panel body. The shared title bar (plugin icon +
 * panel title + the registration's `headerContent`) lives in the shared app
 * header — AppLayout's AppHeader + PluginPanelHeader. The component owns the
 * entire body below it with zero host padding; only the crash boundary remains.
 *
 * Plugins can render `@pierre/diffs` FileDiff (the specifier is shimmed to
 * the host's copy). Every plugin panel is a pane of the split workspace, so
 * the workspace's ThreadDetailWorkerPoolProvider supplies the worker pool.
 */
interface PluginPanelViewProps {
  pluginId?: string;
  panelPath?: string;
  subPath?: string;
}

export function PluginPanelView(props: PluginPanelViewProps = {}) {
  const params = useParams<{
    pluginId: string;
    panelPath: string;
    "*": string;
  }>();
  const pluginId = props.pluginId ?? params.pluginId;
  const panelPath = props.panelPath ?? params.panelPath;
  // The route's trailing splat: panel-internal location ("" at the root).
  const subPath = props.subPath ?? params["*"] ?? "";
  const { navPanels } = usePluginSlots();
  const pluginsSettled = usePluginFrontendsSettled();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === pluginId && candidate.path === panelPath,
    ) ?? null;

  if (panel === null) {
    // Registrations arrive after first paint, so on a reload or deep link this
    // is the normal state for a moment: stay blank rather than announce a
    // problem. Only a settled boot that still has no panel is worth a message.
    if (!pluginsSettled) {
      return <PageShell contentClassName="pt-4 md:pt-5">{null}</PageShell>;
    }
    return (
      <PageShell contentClassName="pt-4 md:pt-5">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          This plugin panel is not available. The plugin may have been disabled
          or removed.
        </EmptyStatePanel>
      </PageShell>
    );
  }

  // Full-bleed: the negative margins undo the app layout's `p-4 md:p-5`
  // route padding. Plugins opt into their own padding and scrolling.
  // Generation in the key: a P3.4 reload remounts the slot (fresh
  // error-boundary state).
  return (
    <div
      className="-m-4 flex min-h-0 flex-1 flex-col overflow-hidden md:-m-5"
      data-testid="plugin-panel-body"
    >
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
        pluginId={panel.pluginId}
        slotKind="navPanel"
        slotId={panel.id}
      >
        <panel.component subPath={subPath} />
      </PluginSlotMount>
    </div>
  );
}
