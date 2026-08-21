import {
  builtInThemes,
  FAVICON_COLORS,
  type AppTheme,
  type BuiltInThemeId,
  type FaviconColor,
  type FaviconColorPreference,
  type PluginThemeMeta,
} from "@bb/domain";

/**
 * Palette + favicon picker options (mirror of the appearance part of
 * apps/app/src/views/SettingsView.tsx). Only the six built-in palettes map to
 * native tokens (plan: Limitations); custom and plugin themes can still be
 * selected — the choice is server-wide and the web/desktop honor it — but
 * the phone renders the default palette while one is active.
 */

export type PaletteOptionKind = "built-in" | "custom" | "plugin";

export interface PaletteOption {
  /** The `themeId` to persist. */
  id: string;
  label: string;
  description: string | null;
  kind: PaletteOptionKind;
  /** The native palette the phone renders while this option is active. */
  nativePalette: BuiltInThemeId;
}

export const CUSTOM_PALETTE_MOBILE_NOTE = "Default palette on mobile";

export function buildPaletteOptions(args: {
  customThemes: readonly string[];
  pluginThemes: readonly PluginThemeMeta[];
}): PaletteOption[] {
  const builtIn: PaletteOption[] = builtInThemes.map((theme) => ({
    id: theme.id,
    label: theme.name,
    description: theme.description,
    kind: "built-in",
    nativePalette: theme.id,
  }));
  const custom: PaletteOption[] = args.customThemes.map((name) => ({
    id: name,
    label: name,
    description: CUSTOM_PALETTE_MOBILE_NOTE,
    kind: "custom",
    nativePalette: "default",
  }));
  const plugin: PaletteOption[] = args.pluginThemes.map((theme) => ({
    id: theme.id,
    label: theme.name,
    description: `${theme.pluginId} · ${CUSTOM_PALETTE_MOBILE_NOTE}`,
    kind: "plugin",
    nativePalette: "default",
  }));
  return [...builtIn, ...custom, ...plugin];
}

/** Display name of the active palette (web `appPaletteLabel`). */
export function paletteLabel(
  appearance: Pick<AppTheme, "themeId">,
  pluginThemes: readonly PluginThemeMeta[],
): string {
  const builtIn = builtInThemes.find(
    (entry) => entry.id === appearance.themeId,
  );
  return (
    builtIn?.name ??
    pluginThemes.find((entry) => entry.id === appearance.themeId)?.name ??
    appearance.themeId
  );
}

export interface FaviconColorOption {
  value: FaviconColorPreference;
  label: string;
  /** Swatch color; null for the untinted default (use the foreground token). */
  hex: string | null;
}

/** The same tints the web favicon uses (apps/app/src/lib/favicon-color-preference.ts). */
const FAVICON_COLOR_VALUES: Record<FaviconColor, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffba18",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
};

const FAVICON_COLOR_LABELS: Record<FaviconColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export const FAVICON_COLOR_OPTIONS: readonly FaviconColorOption[] = [
  { value: "default", label: "Default", hex: null },
  ...FAVICON_COLORS.map((color) => ({
    value: color,
    label: FAVICON_COLOR_LABELS[color],
    hex: FAVICON_COLOR_VALUES[color],
  })),
];

export function faviconColorLabel(value: FaviconColorPreference): string {
  return value === "default" ? "Default" : FAVICON_COLOR_LABELS[value];
}
