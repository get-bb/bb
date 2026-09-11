import type { PluginProviderIconRegistration } from "@get-bb/plugin-sdk/app";
import type { CSSProperties, ComponentType } from "react";
import { createElement } from "react";
import { isPresentationTintColor, type ProviderInfo } from "@bb/domain";
import { ProviderIcon } from "@/components/plugin/ProviderIcon";

interface ProviderIconInfo {
  icon: ComponentType<{ className?: string }>;
  ariaLabel: string;
}

interface ProviderIconSource {
  logoUrl: string | null;
  icon?: { glyph: string };
  family?: string;
  displayName?: string;
}

const providerIcons = new Map<string, ComponentType<{ className?: string }>>();

export function getProviderIconInfo(
  providerKind: PluginProviderIconRegistration["providerKind"],
  providerId: string,
  source: ProviderIconSource | null = null,
): ProviderIconInfo {
  const cacheKey = JSON.stringify([
    providerId,
    source?.logoUrl,
    source?.icon?.glyph,
  ]);
  let icon = providerIcons.get(cacheKey);
  if (icon === undefined) {
    const ResolvedProviderIcon: ComponentType<{ className?: string }> = ({
      className,
    }) =>
      createElement(ProviderIcon, {
        provider: {
          id: providerId,
          logoUrl: source?.logoUrl,
          icon: source?.icon,
        },
        className,
      });
    icon = ResolvedProviderIcon;
    providerIcons.set(cacheKey, icon);
  }
  return {
    icon,
    ariaLabel:
      source?.displayName ??
      (source?.family === "acp" ? "ACP provider" : providerId),
  };
}

export function getProviderIconTintStyle(
  provider: Pick<ProviderInfo, "strings"> | undefined,
): CSSProperties | undefined {
  const tint = provider?.strings?.iconTint;
  if (
    tint === undefined ||
    !isPresentationTintColor(tint.light) ||
    !isPresentationTintColor(tint.dark)
  ) {
    return undefined;
  }
  return { color: `light-dark(${tint.light.trim()}, ${tint.dark.trim()})` };
}
