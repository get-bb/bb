import type { ComponentType } from "react";
import type { ProviderInfo } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getProviderIconColorClass,
  getProviderIconTintStyle,
} from "@/lib/provider-icon";

interface ProviderIconMarkProps {
  provider: Pick<ProviderInfo, "id" | "strings">;
  icon: ComponentType<{ className?: string }>;
  className?: string;
}

/**
 * A provider's mark coloured by its declared `strings.iconTint` when it
 * declared one, else by the vendored per-id colour class. Marks paint with
 * `currentColor`, so the tint is set on a box-less wrapper the mark inherits
 * from; the per-id class is left off in that case so it cannot override the
 * inherited colour.
 */
export function ProviderIconMark({
  provider,
  icon: Mark,
  className,
}: ProviderIconMarkProps) {
  const tintStyle = getProviderIconTintStyle(provider);
  if (tintStyle === undefined) {
    return (
      <Mark
        className={cn(className, getProviderIconColorClass(provider.id))}
      />
    );
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
