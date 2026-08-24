import type { CSSProperties, ComponentType } from "react";
import { createElement, useSyncExternalStore } from "react";
import { isPresentationTintColor, type ProviderInfo } from "@bb/domain";
import { Icon, ICON_NAMES, type IconName } from "@bb/shared-ui/icon";
import { getPluginSlotSnapshot, subscribePluginSlots } from "./plugin-slots";

interface ProviderIconInfo {
  icon: ComponentType<{ className?: string }>;
  ariaLabel: string;
}

/**
 * The mark for a provider whose family bb knows but whose brand it does not:
 * an ACP agent with no declared icon and no served logo.
 */
const GenericAcpIcon: ComponentType<{ className?: string }> = ({ className }) =>
  createElement(Icon, { name: "Code", className, "aria-hidden": "true" });

/** The family every ACP agent's registration declares. */
const ACP_FAMILY = "acp";

/**
 * What a caller knows about a provider's declared icon, straight off its
 * `ProviderInfo`: a file logo served by the host (`logoUrl`), a named host
 * glyph (`icon.glyph`), the `family` its registration declares, and its
 * display name (the accessible label of the mark). A declaration names at
 * most one of the first two; `family` decides the generic mark when neither
 * is there. Core vendors no brand marks: every provider's mark comes from
 * the plugin that registers it.
 */
interface ProviderIconSource {
  logoUrl: string | null;
  icon?: { glyph: string };
  family?: string;
  displayName?: string;
}

function isIconName(name: string): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name);
}

const declaredGlyphIcons = new Map<string, ComponentType<{ className?: string }>>();

/**
 * A provider's declared host glyph, rendered through the shared icon set so
 * it inherits the surrounding text color like an inline mark. An unknown
 * glyph name (a newer host's vocabulary, a typo) resolves to nothing, and
 * the caller's fallback chain continues.
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

/**
 * A served provider logo as a CSS mask filled with `currentColor`. An SVG
 * drawn through `<img>` is a separate document where `currentColor` resolves
 * to black — invisible on dark themes, unreachable by page CSS — so the logo
 * is used as the mask's alpha instead and takes the surrounding text color
 * (or the provider's declared `strings.iconTint`) like an inline mark. A
 * full-color raster logo therefore renders as a silhouette; the mobile app
 * tints the same assets the same way. One fetch per mark: a mask cannot
 * report a failed fetch, and a served logo is the registration's own
 * snapshot, so there is no fallback to probe for.
 */
function providerLogoMaskStyle(logoUrl: string): CSSProperties {
  const image = `url("${logoUrl.replace(/["\\]/gu, "\\$&")}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskPosition: "center",
    maskSize: "contain",
    WebkitMaskSize: "contain",
  };
}

const configuredProviderLogoIcons = new Map<
  string,
  ComponentType<{ className?: string }>
>();

function getConfiguredProviderLogoIcon(
  providerId: string,
  logoUrl: string,
  family: string | undefined,
): ComponentType<{ className?: string }> {
  const cacheKey = `${providerId}\0${logoUrl}\0${family ?? ""}`;
  const cached = configuredProviderLogoIcons.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const ProviderLogoIcon: ComponentType<{ className?: string }> = ({
    className,
  }) =>
    createElement("span", {
      "aria-hidden": "true",
      className: `${className ?? ""} inline-block shrink-0 bg-current`.trim(),
      "data-provider-logo": logoUrl,
      style: providerLogoMaskStyle(logoUrl),
    });
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
  // Every part of the source is in the key: each one decides the static mark
  // this component closes over, so two callers that disagree about any of
  // them must not share one component.
  const cacheKey = `${providerId}\0${source.logoUrl ?? ""}\0${source.icon?.glyph ?? ""}\0${source.family ?? ""}`;
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
 * 2. The logo the provider's plugin declared (`icon: "./icons/x.svg"`),
 *    served by the host as `logoUrl` and drawn as a `currentColor` mask
 *    (see `providerLogoMaskStyle`). This is how every provider bb ships
 *    gets its brand mark: core vendors none.
 * 3. The host glyph the provider declared (`ProviderInfo.icon.glyph`, from a
 *    declaration like `icon: "Zap"`): a plugin without an SVG asset still
 *    gets a mark instead of its initial. Drawn through the shared icon set,
 *    so it inherits the text color like a mask.
 * 4. The generic glyph for a provider whose declared `family` bb knows.
 *
 * Returns undefined when nothing above matches, so callers can fall back
 * gracefully (the picker shows the display name's initial).
 *
 * The second argument is the provider's declared icon source — pass the
 * `ProviderInfo` itself. A caller that has only an id gets the plugin slot
 * and nothing else, since the marks live with the registrations.
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
    ariaLabel: resolvedSource.displayName ?? staticInfo?.ariaLabel ?? providerId,
  };
}

function resolveStaticProviderIconInfo(
  providerId: string,
  source: ProviderIconSource,
): ProviderIconInfo | undefined {
  if (source.logoUrl !== null) {
    return {
      icon: getConfiguredProviderLogoIcon(
        providerId,
        source.logoUrl,
        source.family,
      ),
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

  // The declared family, never the id's shape: a provider is an ACP agent
  // because its registration says so, not because of how its id is spelled.
  if (source.family === ACP_FAMILY) {
    return { icon: GenericAcpIcon, ariaLabel: "ACP provider" };
  }

  return undefined;
}

/**
 * The provider's declared icon tint (`strings.iconTint`, docs/provider-
 * plugin-api.md §1) as an inline style, picking the light or dark value
 * through `light-dark()` so it follows the app's `color-scheme`. Undefined
 * when the provider declared none, in which case the mark inherits the
 * surrounding text color.
 */
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
