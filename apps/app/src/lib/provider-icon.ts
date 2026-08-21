import type { ComponentType } from "react";
import { createElement, useState, useSyncExternalStore } from "react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { CursorIcon } from "@/components/icons/CursorIcon";
import { GrokIcon } from "@/components/icons/GrokIcon";
import { HermesAgentIcon } from "@/components/icons/HermesAgentIcon";
import { OpenAiIcon } from "@/components/icons/OpenAiIcon";
import { OpencodeIcon } from "@/components/icons/OpencodeIcon";
import { OmpIcon } from "@/components/icons/OmpIcon";
import { PiIcon } from "@/components/icons/PiIcon";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
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

/**
 * What a caller knows about a provider's declared icon, straight off its
 * `ProviderInfo`: a file logo served by the host (`logoUrl`) or a named host
 * glyph (`icon.glyph`). A declaration names at most one.
 */
export interface ProviderIconSource {
  logoUrl: string | null;
  icon?: { glyph: string };
}

function isIconName(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}

const declaredGlyphIcons = new Map<string, ComponentType<{ className?: string }>>();

/**
 * A provider's declared host glyph, rendered through the shared icon set so
 * it inherits the surrounding text color like a vendored brand mark. An
 * unknown glyph name (a newer host's vocabulary, a typo) resolves to nothing,
 * and the caller's fallback chain continues.
 */
function getDeclaredGlyphIcon(
  glyph: string,
): ComponentType<{ className?: string }> | undefined {
  if (!isIconName(glyph)) {
    return undefined;
  }
  const cached = declaredGlyphIcons.get(glyph);
  if (cached !== undefined) {
    return cached;
  }
  const GlyphIcon: ComponentType<{ className?: string }> = ({ className }) =>
    createElement(Icon, { name: glyph, className, "aria-hidden": "true" });
  declaredGlyphIcons.set(glyph, GlyphIcon);
  return GlyphIcon;
}

// Vendored brand marks for the built-in providers, keyed by provider id. The
// first-party provider plugins ship no frontend bundle: registering these
// same marks through `app.slots.experimental_providerIcon` cost four JS+CSS
// fetches and four icon remounts at boot for byte-identical SVGs, so this map
// is their only source. A plugin registration for one of these ids (e.g. a
// community provider plugin) still wins, per `getProviderIconInfo`.
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

  const fallbackIcon = resolveStaticProviderIconInfo(providerId, {
    logoUrl: null,
  })?.icon;
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
  source: ProviderIconSource,
  staticIcon: ComponentType<{ className?: string }> | undefined,
): ComponentType<{ className?: string }> {
  const cacheKey = `${providerId}\0${source.logoUrl ?? ""}\0${source.icon?.glyph ?? ""}`;
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
 * 2. The vendored brand maps (built-ins plus well-known ACP slugs). These are
 *    theme-aware React components (`currentColor` cascades), so they must win
 *    over a server `logoUrl`: an SVG rendered through `<img>` is a separate
 *    document where `currentColor` resolves to black — invisible on dark
 *    themes — and page CSS cannot reach it.
 * 3. A caller-supplied `logoUrl` (from a server-provided `ProviderInfo`) for
 *    providers without a vendored mark — plugin-registered third parties, and
 *    the right home for static color logos.
 * 4. The host glyph the provider declared (`ProviderInfo.icon.glyph`, from a
 *    declaration like `icon: "Zap"`): a plugin without an SVG asset still
 *    gets a mark instead of its initial. Drawn through the shared icon set,
 *    so it inherits the text color like a vendored mark.
 * 5. The generic glyph for unrecognized ACP providers.
 *
 * Returns undefined for unknown non-ACP providers so callers can fall back
 * gracefully (the picker shows the display name's initial).
 *
 * The second argument is the provider's declared icon source — pass the
 * `ProviderInfo` itself, or nothing for surfaces that only know the id.
 */
export function getProviderIconInfo(
  providerId: string,
  source: ProviderIconSource | null = null,
): ProviderIconInfo | undefined {
  const resolvedSource = source ?? { logoUrl: null };
  const staticInfo = resolveStaticProviderIconInfo(providerId, resolvedSource);
  const pluginIcon = getRegisteredPluginProviderIcon(providerId);
  if (staticInfo === undefined && pluginIcon === undefined) {
    return undefined;
  }
  return {
    icon: getPluginAwareProviderIcon(
      providerId,
      resolvedSource,
      staticInfo?.icon,
    ),
    ariaLabel: staticInfo?.ariaLabel ?? providerId,
  };
}

function resolveStaticProviderIconInfo(
  providerId: string,
  source: ProviderIconSource,
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

  if (source.logoUrl !== null) {
    return {
      icon: getConfiguredProviderLogoIcon(providerId, source.logoUrl),
      ariaLabel: "Provider logo",
    };
  }

  const glyphIcon =
    source.icon === undefined
      ? undefined
      : getDeclaredGlyphIcon(source.icon.glyph);
  if (glyphIcon !== undefined) {
    return { icon: glyphIcon, ariaLabel: "Provider icon" };
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
