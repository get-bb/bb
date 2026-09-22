import { isPresentationTintColor } from "@bb/domain";
import type {
  ProviderIconColorMode,
  ProviderIconColors,
} from "../../shared/preferences.js";

interface ProviderIconTint {
  light: string;
  dark: string;
}

/** Theme variable that colors one provider's icon, e.g. `--provider-icon-codex`. */
export function providerIconThemeVariable(providerId: string): string {
  return `--provider-icon-${providerId.replace(/[^a-zA-Z0-9_-]/gu, "-")}`;
}

function lightDark(tint: ProviderIconTint): string {
  return `light-dark(${tint.light.trim()}, ${tint.dark.trim()})`;
}

function isValidTint(tint: ProviderIconTint | null | undefined): tint is ProviderIconTint {
  return (
    tint != null &&
    isPresentationTintColor(tint.light) &&
    isPresentationTintColor(tint.dark)
  );
}

/**
 * The CSS color for a row's provider icon. A custom color wins outright; then
 * the theme's per-provider variable, then its `--provider-icon` variable; then
 * the color mode: the provider's brand tint, or the row's own text color.
 */
export function resolveProviderIconColor({
  providerId,
  brandTint,
  mode,
  customColors,
}: {
  providerId: string;
  brandTint: ProviderIconTint | null | undefined;
  mode: ProviderIconColorMode;
  customColors: ProviderIconColors;
}): string {
  const custom = customColors[providerId];
  if (isValidTint(custom)) return lightDark(custom);
  const fallback =
    mode === "brand" && isValidTint(brandTint)
      ? lightDark(brandTint)
      : "currentColor";
  return `var(${providerIconThemeVariable(providerId)}, var(--provider-icon, ${fallback}))`;
}
