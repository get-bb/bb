import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { usePluginCompactBranding } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

/** Plugin icon hints are freeform strings; unknown ones get a generic icon. */
export function pluginIconName(icon: string | null): IconName {
  return icon !== null && (ICON_NAMES as readonly string[]).includes(icon)
    ? (icon as IconName)
    : "Zap";
}

/**
 * A plugin-owned compact SVG painted as a mask, so its single-color artwork
 * takes the surrounding text color. Rendering the same asset through `img`
 * would resolve its `currentColor` against the image document instead, which
 * paints it black on a dark surface.
 */
export function PluginCompactIconMask({
  url,
  className,
}: {
  url: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-plugin-icon-asset={url}
      className={cn("inline-block size-4 shrink-0", className)}
      style={{
        backgroundColor: "currentColor",
        maskImage: `url("${url}")`,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: `url("${url}")`,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

/**
 * Compact identity for plugin-contributed chrome (sidebar rows, thread
 * actions, command/mention menu rows, panel title bars). Prefer a
 * plugin-owned, path-shaped `bb.branding.icon` SVG, then a named manifest
 * icon, then the contribution's local icon hint, then Zap. Rich
 * image logos remain reserved for roomy `PluginLogo` surfaces such as
 * installed-plugin rows and cards. Size defaults to the standard icon box;
 * pass className to match the surrounding surface (e.g. `size-3.5` in menus).
 */
export function PluginIcon({
  pluginId,
  icon,
  compactIconUrl: compactIconUrlProp,
  className,
}: {
  pluginId: string;
  /** Named-icon hint from the contribution; null means "no hint". */
  icon: string | null;
  /** Explicit inventory URL for callers that already own the plugin DTO. */
  compactIconUrl?: string | null;
  className?: string;
}) {
  const branding = usePluginCompactBranding(pluginId);
  const compactIconUrl =
    compactIconUrlProp === undefined
      ? (branding?.compactIconUrl ?? null)
      : compactIconUrlProp;
  if (compactIconUrl !== null) {
    return <PluginCompactIconMask url={compactIconUrl} className={className} />;
  }
  return (
    <Icon
      name={pluginIconName(branding?.icon ?? icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}
