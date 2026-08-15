import type { ComponentType } from "react";
import { createElement, useState } from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { GrokIcon } from "@/components/icons/GrokIcon";
import { HermesAgentIcon } from "@/components/icons/HermesAgentIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { OpencodeIcon } from "@/components/icons/OpencodeIcon";
import { OmpIcon } from "@/components/icons/OmpIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import { Icon } from "@bb/shared-ui/icon";

const ACP_ID_PREFIX = "acp-";

interface ProviderIconInfo {
  icon: ComponentType<{ className?: string }>;
  ariaLabel: string;
}

function isAcpProviderId(providerId: string): boolean {
  return providerId.startsWith(ACP_ID_PREFIX);
}

const GenericAcpIcon: ComponentType<{ className?: string }> = ({ className }) =>
  createElement(Icon, { name: "Code", className, "aria-hidden": "true" });

// Vendored brand marks for the built-in providers, keyed by provider id. This
// is the interim fallback for callers whose data carries no `logoUrl`: until
// the first-party provider plugins populate `ProviderInfo.logoUrl`, built-ins
// must keep rendering their real brand marks, never the generic glyph. Once
// every call site receives a populated `logoUrl`, this map (and the vendored
// SVG components behind it) graduates to dead code and can be deleted.
const BUILT_IN_BRAND_ICONS: Record<string, ProviderIconInfo> = {
  codex: { icon: OpenAiIcon, ariaLabel: "Codex" },
  "claude-code": { icon: ClaudeIcon, ariaLabel: "Claude Code" },
  pi: { icon: PiIcon, ariaLabel: "Pi" },
  "acp-cursor": { icon: CursorIcon, ariaLabel: "Cursor" },
};

// Brand icons for well-known ACP agents, keyed by slug (the provider id with
// the `acp-` prefix stripped). Unknown ACP agents fall back to the generic
// glyph; the display name still comes from the server-provided ProviderInfo.
const KNOWN_ACP_BRAND_ICONS: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  grok: GrokIcon,
  "hermes-agent": HermesAgentIcon,
  opencode: OpencodeIcon,
  omp: OmpIcon,
};

const configuredProviderLogoIcons = new Map<
  string,
  ComponentType<{ className?: string }>
>();

function getConfiguredProviderLogoIcon(
  providerId: string,
  logoUrl: string,
): ComponentType<{ className?: string }> {
  const cacheKey = `${providerId}\0${logoUrl}`;
  const cached = configuredProviderLogoIcons.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const fallbackIcon = getProviderIconInfo(providerId)?.icon;
  const ProviderLogoIcon: ComponentType<{ className?: string }> = ({
    className,
  }) => {
    const [failed, setFailed] = useState(false);
    if (failed) {
      return fallbackIcon === undefined
        ? null
        : createElement(fallbackIcon, { className });
    }
    return createElement("img", {
      "aria-hidden": "true",
      alt: "",
      className: `${className ?? ""} object-contain`.trim(),
      onError: () => setFailed(true),
      src: logoUrl,
    });
  };
  configuredProviderLogoIcons.set(cacheKey, ProviderLogoIcon);
  return ProviderLogoIcon;
}

/**
 * Resolves a provider's icon. Resolution order:
 *
 * 1. The vendored brand maps (built-ins plus well-known ACP slugs). These are
 *    theme-aware React components (`currentColor` cascades), so they must win
 *    over a server `logoUrl`: an SVG rendered through `<img>` is a separate
 *    document where `currentColor` resolves to black — invisible on dark
 *    themes — and page CSS cannot reach it.
 * 2. A caller-supplied `logoUrl` (from a server-provided `ProviderInfo`) for
 *    providers without a vendored mark — plugin-registered third parties.
 * 3. The generic glyph for unrecognized ACP providers.
 *
 * Returns undefined for unknown non-ACP providers so callers can fall back
 * gracefully.
 */
export function getProviderIconInfo(
  providerId: string,
  logoUrl: string | null = null,
): ProviderIconInfo | undefined {
  const builtInBrand = BUILT_IN_BRAND_ICONS[providerId];
  if (builtInBrand !== undefined) {
    return builtInBrand;
  }

  if (isAcpProviderId(providerId)) {
    const slug = providerId.slice(ACP_ID_PREFIX.length);
    const brandIcon = KNOWN_ACP_BRAND_ICONS[slug];
    if (brandIcon !== undefined) {
      return { icon: brandIcon, ariaLabel: slug };
    }
  }

  if (logoUrl !== null) {
    return {
      icon: getConfiguredProviderLogoIcon(providerId, logoUrl),
      ariaLabel: "Provider logo",
    };
  }

  if (isAcpProviderId(providerId)) {
    return { icon: GenericAcpIcon, ariaLabel: "ACP provider" };
  }

  return undefined;
}

export function getProviderIconColorClass(providerId: string): string {
  if (providerId === "codex") {
    return "text-foreground";
  }
  if (providerId === "claude-code") {
    return "text-[#D97757]";
  }
  if (providerId === "pi") {
    return "text-[#6D5DFB]";
  }
  if (providerId === "acp-cursor") {
    return "text-[#111827] dark:text-[#F5F5F5]";
  }
  if (providerId === "acp-opencode") {
    return "text-[#2563EB]";
  }
  if (providerId === "acp-omp") {
    return "text-[#9333EA]";
  }
  return "text-foreground";
}
