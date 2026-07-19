import { Link } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { getSettingsRoutePath } from "@/lib/route-paths";

export interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

/**
 * The quiet update affordance (BB-48): a small primary pill in the sidebar
 * footer's lower-right corner, rendered only while an update needs attention.
 * It replaces the stacked update/provider-health toasts — clicking it opens
 * the consolidated Settings → Updates view.
 */
export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();
  if (!inventory.hasAttention) {
    return null;
  }
  return (
    <SidebarMenuItem className="ml-auto min-w-0">
      <Link
        to={getSettingsRoutePath("updates")}
        onClick={onNavigate}
        aria-label={`Updates available (${inventory.actionableCount})`}
        data-testid="sidebar-updates-badge"
        className="flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85"
      >
        <Icon name="PackageReceive" className="size-3.5" />
        Updates
      </Link>
    </SidebarMenuItem>
  );
}
