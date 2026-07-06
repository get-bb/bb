import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@/lib/utils";

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2): one row
 * per registered panel, styled like primary sidebar actions, navigating to
 * the panel's own route under /plugins/<pluginId>/<path>. Renders nothing
 * while no plugin contributes a panel. Only host chrome renders here — the
 * plugin's component mounts on the route (PluginPanelView).
 */
export function PluginNavSidebarItems(props: { onNavigate?: () => void }) {
  const { navPanels } = usePluginSlots();
  // Router hooks live in the inner component so hosts without a Router
  // (isolated sidebar tests/stories) can render the empty state.
  if (navPanels.length === 0) return null;
  return <PluginNavSidebarItemList {...props} navPanels={navPanels} />;
}

function PluginNavSidebarItemList({
  onNavigate,
  navPanels,
}: {
  onNavigate?: () => void;
  navPanels: ReturnType<typeof usePluginSlots>["navPanels"];
}) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div
      // -mt-1 tightens the seam against the primary-actions block (its py-2
      // bottom) so the first panel row sits on the same 4px (space-y-1) rhythm
      // as New thread above it, instead of an 8px gap.
      className="-mt-1 shrink-0 px-2 pb-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
    >
      {navPanels.map((panel) => {
        const path = getPluginPanelRoutePath({
          pluginId: panel.pluginId,
          path: panel.path,
        });
        const isActive = location.pathname === path;
        return (
          <Button
            key={`${panel.pluginId}/${panel.id}`}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              PROJECT_LIST_ACTION_BUTTON_CLASS,
              "w-full",
              isActive && "bg-sidebar-accent text-sidebar-foreground",
            )}
            aria-current={isActive ? "page" : undefined}
            onClick={() => {
              onNavigate?.();
              void navigate(path);
            }}
          >
            <PluginIcon pluginId={panel.pluginId} icon={panel.icon} />
            <span className="min-w-0 flex-1 truncate text-left">
              {panel.title}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
