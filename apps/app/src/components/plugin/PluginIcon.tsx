import { useSyncExternalStore } from "react";
import {
  getAppIcon,
  getPluginAssetIcon,
  subscribeAppIcons,
  subscribePluginAssetIcons,
} from "@bb/shared-ui/icon-registry";
import { PluginCompactIconMask } from "@bb/shared-ui/plugin-icon";
import { Icon, isBuiltinIconName, type IconName } from "@bb/shared-ui/icon";
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

export function PluginItemIcon({
  pluginId,
  icon,
  className,
}: {
  pluginId: string;
  icon: string | null;
  className?: string;
}) {
  const name = icon ?? "";
  const custom = useSyncExternalStore(
    subscribeAppIcons,
    () => getAppIcon(name),
    () => getAppIcon(name),
  );
  const asset = useSyncExternalStore(
    subscribePluginAssetIcons,
    () => getPluginAssetIcon(name),
    () => getPluginAssetIcon(name),
  );
  if (isBuiltinIconName(name) || custom !== undefined || asset !== undefined) {
    return (
      <Icon
        name={name}
        className={cn("size-4 shrink-0", className)}
        aria-hidden
      />
    );
  }
  return <PluginIcon pluginId={pluginId} icon={null} className={className} />;
}
