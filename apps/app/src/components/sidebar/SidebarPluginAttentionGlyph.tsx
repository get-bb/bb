import { useEffect } from "react";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Link } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { usePluginList } from "@/hooks/queries/plugin-settings-queries";
import {
  pluginAttentionLabel,
  pluginsNeedingAttention,
} from "@/hooks/usePluginAttention";
import { createJsonLocalStorage } from "@/lib/browser-storage";

/**
 * Snapshot key of the attention set the user acknowledged by clicking the
 * glyph: sorted `[id, status, statusDetail]` tuples, so the glyph stays hidden
 * only while that exact set persists and returns on any change (#1915).
 */
const acknowledgedAttentionKeyAtom = atomWithStorage<string | null>(
  "bb.sidebar.pluginAttentionAcknowledged",
  null,
  createJsonLocalStorage<string | null>(),
  { getOnInit: true },
);

/**
 * One muted warning triangle in the sidebar footer tray while an enabled
 * plugin is not running. Derived from the plugin list, never stored, so it
 * disappears once every enabled plugin runs again.
 */
export function SidebarPluginAttentionGlyph({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  const plugins = pluginsNeedingAttention(
    usePluginList({ enabled: true }).data?.plugins ?? [],
  );
  const [acknowledgedKey, setAcknowledgedKey] = useAtom(
    acknowledgedAttentionKeyAtom,
  );
  const key =
    plugins.length === 0
      ? null
      : JSON.stringify(
          [...plugins]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map((p) => [p.id, p.status, p.statusDetail]),
        );

  useEffect(() => {
    if (key === null && acknowledgedKey !== null) setAcknowledgedKey(null);
  }, [key, acknowledgedKey, setAcknowledgedKey]);

  if (key === null || key === acknowledgedKey) return null;
  const label = pluginAttentionLabel(plugins);
  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        asChild
        aria-label={label}
        tooltip={{ children: label, hidden: false, side: "top" }}
        className={cn(className, "text-warning-text hover:text-warning-text")}
      >
        <Link
          to={getToolsOwnedCollectionRoutePath("plugins")}
          onClick={() => {
            setAcknowledgedKey(key);
            onNavigate?.();
          }}
          data-testid="sidebar-plugin-attention-glyph"
        >
          <Icon name="AlertTriangle" />
          <span className="sr-only">{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
