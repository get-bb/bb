import { Icon, ICON_NAMES, type IconName } from "@/components/ui/icon.js";
import { usePluginLogoUrl } from "@/lib/plugin-logos";
import { cn } from "@/lib/utils";

/** Plugin icon hints are freeform strings; unknown ones get a generic icon. */
export function pluginIconName(icon: string | null): IconName {
  return icon !== null && (ICON_NAMES as readonly string[]).includes(icon)
    ? (icon as IconName)
    : "Zap";
}

/**
 * The leading icon for any plugin-contributed item (sidebar rows, thread
 * actions, command/mention menu rows, panel title bars): the plugin's logo
 * image when it ships one (logo.(svg|png|webp) / manifest `bb.logo`; in dark
 * mode the `logo-dark.*` / `bb.logoDark` variant is preferred when present),
 * otherwise the contribution's named-icon hint with the generic-bolt
 * fallback. Size defaults to the standard icon box; pass className to match
 * the surrounding surface (e.g. `size-3.5` in menus).
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
  const logoUrl = usePluginLogoUrl(pluginId);
  if (logoUrl !== null) {
    return (
      <img
        src={logoUrl}
        alt=""
        aria-hidden="true"
        data-testid={`plugin-logo-${pluginId}`}
        className={cn("size-4 shrink-0 rounded-sm object-contain", className)}
      />
    );
  }
  return (
    <Icon
      name={pluginIconName(icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}
