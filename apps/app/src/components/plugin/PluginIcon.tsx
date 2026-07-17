import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { usePluginIconHint } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

/** Plugin icon hints are freeform strings; unknown ones get a generic icon. */
export function pluginIconName(icon: string | null): IconName {
  return icon !== null && (ICON_NAMES as readonly string[]).includes(icon)
    ? (icon as IconName)
    : "Zap";
}

/**
 * Compact identity for plugin-contributed chrome (sidebar rows, thread
 * actions, command/mention menu rows, panel title bars). Prefer the plugin's
 * `bb.branding.icon`, then the contribution's local icon hint, then Zap.
 * Rich image logos are reserved for roomy `PluginLogo` surfaces such as
 * installed-plugin rows and cards. Size defaults to the standard icon box;
 * pass className to match the surrounding surface (e.g. `size-3.5` in menus).
 */
export function PluginIcon({
  pluginId,
  icon,
  className,
}: {
  pluginId: string;
  /** Named-icon hint from the contribution; null means "no hint". */
  icon: string | null;
  className?: string;
}) {
  const pluginIcon = usePluginIconHint(pluginId);
  return (
    <Icon
      name={pluginIconName(pluginIcon ?? icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}
