import { useParams } from "react-router-dom";
import { PageShell } from "@/components/ui/page-shell.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";

/**
 * The route surface for plugin `navPanel` slots (plugin design §5.2):
 * /plugins/:pluginId/:panelPath renders the matching registered panel
 * component inside its per-plugin error boundary. An unknown panel (plugin
 * not loaded, disabled, or removed) degrades to a quiet placeholder — plugin
 * frontends load after first paint, so a deep link can land here briefly
 * before registrations arrive.
 */
export function PluginPanelView() {
  const { pluginId, panelPath } = useParams<{
    pluginId: string;
    panelPath: string;
  }>();
  const { navPanels } = usePluginSlots();
  const panel =
    navPanels.find(
      (candidate) =>
        candidate.pluginId === pluginId && candidate.path === panelPath,
    ) ?? null;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {panel === null ? (
          <EmptyStatePanel className="rounded-lg p-6 text-sm">
            This plugin panel is not available. The plugin may still be
            loading, or it has been disabled or removed.
          </EmptyStatePanel>
        ) : (
          <>
            <h1 className="text-sm font-semibold text-foreground">
              {panel.title}
            </h1>
            <PluginSlotMount
              // Generation in the key: a P3.4 reload remounts the slot
              // (fresh error-boundary state).
              key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
              pluginId={panel.pluginId}
              slotKind="navPanel"
              slotId={panel.id}
            >
              <panel.component />
            </PluginSlotMount>
          </>
        )}
      </div>
    </PageShell>
  );
}
