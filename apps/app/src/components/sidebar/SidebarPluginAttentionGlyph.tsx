import { useEffect } from "react";
import { useAtom } from "jotai";
import { Link } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useSystemVersion } from "@/hooks/queries/system-queries";
import {
  pluginAttentionLabel,
  usePluginAttention,
} from "@/hooks/usePluginAttention";
import {
  acknowledgedPluginAttentionKeyAtom,
  pluginAttentionSnapshotKey,
} from "./pluginAttentionAcknowledgementAtom";

export interface SidebarPluginAttentionGlyphProps {
  /** Shares the footer action buttons' size, muted weight, and hover. */
  className: string;
  onNavigate?: () => void;
}

/**
 * One muted warning triangle in the sidebar footer tray while an enabled
 * plugin is not running (incompatible after a bb upgrade, failed, or
 * missing). It links to Extensions → Installed plugins, where each plugin
 * shows its status and detail. The glyph is derived from the live attention
 * summary and never stored, so it disappears once every enabled plugin runs
 * again (#1915).
 *
 * A click acknowledges the current set: the glyph hides while the set of
 * {id, status, detail} entries stays the same and returns when a plugin is
 * added, changes status, or changes detail. A count of zero clears the
 * acknowledgement so the next problem shows.
 */
export function SidebarPluginAttentionGlyph({
  className,
  onNavigate,
}: SidebarPluginAttentionGlyphProps) {
  const attention = usePluginAttention();
  const systemVersion = useSystemVersion({ enabled: attention.count > 0 });
  const [acknowledgedKey, setAcknowledgedKey] = useAtom(
    acknowledgedPluginAttentionKeyAtom,
  );
  const snapshotKey =
    attention.count > 0 ? pluginAttentionSnapshotKey(attention.plugins) : null;

  useEffect(() => {
    if (attention.count === 0 && acknowledgedKey !== null) {
      setAcknowledgedKey(null);
    }
  }, [attention.count, acknowledgedKey, setAcknowledgedKey]);

  if (snapshotKey === null || snapshotKey === acknowledgedKey) {
    return null;
  }
  const label = pluginAttentionLabel(
    attention.plugins,
    systemVersion.data?.currentVersion,
  );
  return (
    <SidebarMenuItem className="min-w-0">
      <SidebarMenuButton
        asChild
        aria-label={label}
        tooltip={{ children: label, hidden: false, side: "top" }}
        className={cn(
          className,
          "text-warning-text hover:text-warning-text [&>svg]:opacity-100",
        )}
      >
        <Link
          to={getToolsOwnedCollectionRoutePath("plugins")}
          onClick={() => {
            setAcknowledgedKey(snapshotKey);
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
