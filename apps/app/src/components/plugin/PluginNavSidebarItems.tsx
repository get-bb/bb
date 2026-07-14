import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { PROJECT_LIST_ACTION_BUTTON_CLASS } from "@/components/sidebar/ProjectList";
import { getPluginPanelRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";

/**
 * Sidebar entries for plugin `navPanel` slots (plugin design §5.2): one row
 * per registered panel, styled like primary sidebar actions, navigating to
 * the panel's own route under /plugins/<pluginId>/<path>. Renders nothing
 * while no plugin contributes a panel. Only host chrome renders here — the
 * plugin's component mounts on the route (PluginPanelView).
 */
export function PluginNavSidebarItems(props: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const { navPanels } = usePluginSlots();
  // Router hooks live in the inner component so hosts without a Router
  // (isolated sidebar tests/stories) can render the empty state.
  if (navPanels.length === 0) return null;
  return <PluginNavSidebarItemList {...props} navPanels={navPanels} />;
}

function PluginNavSidebarItemList({
  onNavigate,
  navPanels,
  splitEnabled = false,
}: {
  onNavigate?: () => void;
  navPanels: ReturnType<typeof usePluginSlots>["navPanels"];
  splitEnabled?: boolean;
}) {
  const location = useLocation();
  return (
    <div
      // Pull back most of the primary-actions bottom padding so plugin panel
      // rows keep the same compact 2px rhythm as sidebar thread rows.
      className="-mt-1.5 shrink-0 space-y-0.5 px-2 pb-2 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-items"
    >
      {navPanels.map((panel) => {
        return (
          <PluginNavSidebarItem
            key={`${panel.pluginId}/${panel.id}`}
            panel={panel}
            pathname={location.pathname}
            onNavigate={onNavigate}
            splitEnabled={splitEnabled}
          />
        );
      })}
    </div>
  );
}

function PluginNavSidebarItem({
  panel,
  pathname,
  onNavigate,
  splitEnabled,
}: {
  panel: PluginNavPanelSlot;
  pathname: string;
  onNavigate?: () => void;
  splitEnabled: boolean;
}) {
  const navigate = useNavigate();
  const path = getPluginPanelRoutePath({
    pluginId: panel.pluginId,
    path: panel.path,
  });
  const isActive = pathname === path || pathname.startsWith(`${path}/`);
  const content = {
    kind: "plugin-panel",
    pluginId: panel.pluginId,
    panelPath: panel.path,
    subPath: "",
  } as const;
  const { onPointerDown, openInSplit } = usePaneContentSplitDrag({
    content,
    enabled: splitEnabled,
    label: panel.title,
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        PROJECT_LIST_ACTION_BUTTON_CLASS,
        "w-full",
        isActive && "bg-sidebar-accent text-sidebar-foreground",
      )}
      aria-current={isActive ? "page" : undefined}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        onNavigate?.();
        if (event.metaKey || event.ctrlKey) {
          openInSplit();
          return;
        }
        void navigate(path);
      }}
    >
      <PluginIcon pluginId={panel.pluginId} icon={panel.icon} />
      <span className="min-w-0 flex-1 truncate text-left">{panel.title}</span>
    </Button>
  );
}
