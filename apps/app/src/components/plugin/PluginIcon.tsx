import type { CSSProperties } from "react";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { usePluginCompactBranding } from "@/lib/plugin-logos";
import { cn } from "@bb/shared-ui/lib/utils";

const ICON_NAME_SET: ReadonlySet<string> = new Set(ICON_NAMES);

function isIconName(value: string): value is IconName {
  return ICON_NAME_SET.has(value);
}

export function pluginIconName(icon: string | null): IconName {
  return icon !== null && isIconName(icon) ? icon : "Zap";
}

export function PluginCompactIconMask({
  url,
  className,
  style,
}: {
  url: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-plugin-icon-asset={url}
      className={cn("inline-block size-4 shrink-0", className)}
      style={{
        ...style,
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

export function PluginIcon({
  pluginId,
  icon,
  compactIconUrl: compactIconUrlProp,
  className,
}: {
  pluginId: string;
  icon: string | null;
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
