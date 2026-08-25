import type { ComponentType } from "react";
import type { ProviderInfo } from "@bb/domain";
import { getProviderIconTintStyle } from "@/lib/provider-icon";

interface ProviderIconMarkProps {
  provider: Pick<ProviderInfo, "id" | "strings">;
  icon: ComponentType<{ className?: string }>;
  className?: string;
}

/**
 * A provider's mark coloured by its declared `strings.iconTint` when it
 * declared one, else by the surrounding text color. Marks paint with
 * `currentColor`, so the tint is set on a box-less wrapper the mark inherits
 * from; core holds no per-provider colour of its own.
 */
export function ProviderIconMark({
  provider,
  icon: Mark,
  className,
}: ProviderIconMarkProps) {
  const tintStyle = getProviderIconTintStyle(provider);
  if (tintStyle === undefined) {
    return <Mark className={className} />;
  }
  return (
    <span
      className="contents"
      style={tintStyle}
      data-provider-icon-tint={provider.id}
    >
      <Mark className={className} />
    </span>
  );
}
