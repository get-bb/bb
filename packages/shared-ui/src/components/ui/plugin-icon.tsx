import { useState, type CSSProperties } from "react";
import { Icon } from "./icon";
import { cn } from "../../lib/utils";

export function PluginCompactIconMask({
  url,
  className,
  style,
}: {
  url: string;
  className?: string;
  style?: CSSProperties;
}) {
  const maskImage = `url(${JSON.stringify(url)})`;
  return (
    <span
      aria-hidden="true"
      data-plugin-icon-asset={url}
      data-icon-root=""
      className={cn("inline-block size-4 shrink-0", className)}
      style={{
        ...style,
        backgroundColor: "currentColor",
        maskImage,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: maskImage,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export function PluginBrandIcon({
  icon,
  iconUrl,
  iconTinted,
  className,
}: {
  icon: string | null;
  iconUrl: string | null;
  iconTinted: boolean;
  className?: string;
}) {
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  if (iconUrl !== null && iconTinted) {
    return <PluginCompactIconMask url={iconUrl} className={className} />;
  }
  if (iconUrl === null || iconUrl === failedIconUrl) {
    return <Icon name={icon ?? "Zap"} className={className} aria-hidden />;
  }
  return (
    <img
      src={iconUrl}
      alt=""
      className={cn("rounded-sm object-contain", className)}
      onError={() => setFailedIconUrl(iconUrl)}
    />
  );
}
