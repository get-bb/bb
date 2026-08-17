import type { ComponentType } from "react";
import { createElement, useState, useSyncExternalStore } from "react";
import { GrokIcon } from "@/components/icons/GrokIcon";
import { HermesAgentIcon } from "@/components/icons/HermesAgentIcon";
import { OpencodeIcon } from "@/components/icons/OpencodeIcon";
import { OmpIcon } from "@/components/icons/OmpIcon";
import { Icon } from "@bb/shared-ui/icon";
import { getPluginSlotSnapshot, subscribePluginSlots } from "./plugin-slots";

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

// First-party marks belong exclusively to their provider plugins. While a
// frontend boots or is absent, render nothing rather than a generic glyph or
// its currentColor SVG as a black-on-black <img>.
const PLUGIN_OWNED_PROVIDER_ICON_LABELS = new Map<string, string>([
  ["codex", "Codex"],
  ["claude-code", "Claude Code"],
  ["pi", "Pi"],
  ["acp-cursor", "Cursor"],
]);

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

  const fallbackIcon = resolveStaticProviderIconInfo(providerId, null)?.icon;
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

function getRegisteredPluginProviderIcon(
  providerId: string,
): ComponentType<{ className?: string }> | undefined {
  return getPluginSlotSnapshot().providerIcons.find(
    (slot) => slot.providerId === providerId,
  )?.icon;
}

const pluginAwareProviderIcons = new Map<
  string,
  ComponentType<{ className?: string }>
>();

/**
 * Wraps a resolved static icon so a plugin's `experimental_providerIcon`
 * registration takes over live. The subscription lives in the icon component
 * rather than in every call site: plugin frontends boot (and reload, disable,
 * or crash) after the sidebar and settings rows have already rendered, and a
 * disposed registration must fall straight back to the static chain.
 */
function getPluginAwareProviderIcon(
  providerId: string,
  logoUrl: string | null,
  staticIcon: ComponentType<{ className?: string }> | undefined,
): ComponentType<{ className?: string }> {
  const cacheKey = `${providerId}\0${logoUrl ?? ""}`;
  const cached = pluginAwareProviderIcons.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const ProviderIcon: ComponentType<{ className?: string }> = ({
    className,
  }) => {
    // Factory-created component: it closes over `providerId` from the
    // enclosing scope, which the React Compiler mishandles (it hoists the
    // snapshot callback to module scope, losing the capture — a live
    // ReferenceError in compiled builds only, invisible to vitest).
    "use no memo";
    const pluginIcon = useSyncExternalStore(subscribePluginSlots, () =>
      getRegisteredPluginProviderIcon(providerId),
    );
    const ResolvedIcon = pluginIcon ?? staticIcon;
    return ResolvedIcon === undefined
      ? null
      : createElement(ResolvedIcon, { className });
  };
  pluginAwareProviderIcons.set(cacheKey, ProviderIcon);
  return ProviderIcon;
}

/**
 * Resolves a provider's icon. Resolution order:
 *
 * 1. A plugin-registered `app.slots.experimental_providerIcon` component. It
 *    is inline React, so it inherits the app theme, and the owning plugin
 *    ships it alongside the provider declaration itself.
 * 2. No fallback for first-party, plugin-owned marks. Their live wrapper stays
 *    empty until registration rather than showing a generic or black `<img>`.
 * 3. Vendored brand marks for well-known ACP slugs. These remain app-owned
 *    because one ACP plugin owns a dynamic tier of agent providers.
 * 4. A caller-supplied `logoUrl` (from a server-provided `ProviderInfo`) for
 *    providers without a vendored mark — plugin-registered third parties, and
 *    the right home for static color logos.
 * 5. The generic glyph for unrecognized ACP providers.
 *
 * Returns undefined for unknown non-ACP providers so callers can fall back
 * gracefully.
 */
export function getProviderIconInfo(
  providerId: string,
  logoUrl: string | null = null,
): ProviderIconInfo | undefined {
  const pluginOwnedLabel = PLUGIN_OWNED_PROVIDER_ICON_LABELS.get(providerId);
  const staticInfo =
    pluginOwnedLabel === undefined
      ? resolveStaticProviderIconInfo(providerId, logoUrl)
      : undefined;
  const pluginIcon = getRegisteredPluginProviderIcon(providerId);
  if (
    staticInfo === undefined &&
    pluginIcon === undefined &&
    pluginOwnedLabel === undefined
  ) {
    return undefined;
  }
  return {
    icon: getPluginAwareProviderIcon(providerId, logoUrl, staticInfo?.icon),
    ariaLabel: staticInfo?.ariaLabel ?? pluginOwnedLabel ?? providerId,
  };
}

function resolveStaticProviderIconInfo(
  providerId: string,
  logoUrl: string | null,
): ProviderIconInfo | undefined {
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
