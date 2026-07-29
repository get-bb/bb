import { useAtom } from "jotai";
import { TopLevelSidebarSection } from "@/components/sidebar/TopLevelSidebarSection";
import { pluginNavSidebarCollapsedAtom } from "@/components/sidebar/sidebarCollapsedAtoms";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";

/**
 * Plugin-contributed pages grouped beneath the sidebar's collapsible Plugins
 * label. The rows retain their shared reorder/hide behavior while the wrapper
 * gives them a stable product-level home separate from Extensions.
 */
export function PluginNavSidebarSection({
  onNavigate,
  splitEnabled = false,
}: {
  onNavigate?: () => void;
  splitEnabled?: boolean;
}) {
  const { navPanels } = usePluginSlots();
  const [isCollapsed, setIsCollapsed] = useAtom(pluginNavSidebarCollapsedAtom);

  if (navPanels.length === 0) return null;

  return (
    <div
      className="px-2 pt-1 group-data-[collapsible=icon]:hidden"
      data-testid="plugin-nav-sidebar-section"
    >
      <TopLevelSidebarSection
        label="Plugins"
        collapseControl={{
          isCollapsed,
          onToggleCollapsed: () => setIsCollapsed((current) => !current),
        }}
      >
        <PluginNavSidebarItems
          onNavigate={onNavigate}
          splitEnabled={splitEnabled}
        />
      </TopLevelSidebarSection>
    </div>
  );
}
