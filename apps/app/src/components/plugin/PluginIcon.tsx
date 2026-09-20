import { PluginCompactIconMask } from "@bb/shared-ui/plugin-icon";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { usePluginCompactBranding } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

export { PluginCompactIconMask } from "@bb/shared-ui/plugin-icon";

export function pluginIconName(icon: string | null): IconName {
  return icon ?? "Zap";
}

export function PluginIcon({
  pluginId,
  icon,
  compactIconUrl: compactIconUrlProp,
  fallbackIcon = "Zap",
  className,
}: {
  pluginId: string;
  icon: string | null;
  compactIconUrl?: string | null;
  fallbackIcon?: IconName | null;
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
  const resolvedIcon = branding?.icon ?? icon ?? fallbackIcon;
  if (resolvedIcon === null) return null;
  return (
    <Icon
      name={resolvedIcon}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  );
}
