import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { pluginThreadActionIconName } from "@/components/thread/PluginThreadActions";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@/lib/utils";

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2): one row
 * per registered panel, styled like the Automations action, navigating to
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
      className="shrink-0 px-2 pb-2 group-data-[collapsible=icon]:hidden"
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
            <Icon name={pluginThreadActionIconName(panel.icon)} />
            <span className="min-w-0 flex-1 truncate text-left">
              {panel.title}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
