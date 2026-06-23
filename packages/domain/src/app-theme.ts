import { z } from "zod";

/**
 * App color palette ("theme"), distinct from light/dark *mode* (which stays a
 * per-client localStorage preference). The palette is a set of CSS
 * custom-property overrides applied app-wide, persisted server-side so the CLI
 * and Settings can both set it and every open window stays in sync.
 *
 * A palette is either a built-in id (CSS bundled in the frontend registry) or a
 * custom theme discovered on disk under `<data-dir>/theme/<name>/theme.css`. For
 * a custom palette `themeId` is the theme's directory name and the resolved CSS
 * is read from that file by the server.
 */
export const builtInThemeIdSchema = z.enum([
  "default",
  "nord",
  "dracula",
  "solarized",
  "gruvbox",
  "catppuccin",
]);
export type BuiltInThemeId = z.infer<typeof builtInThemeIdSchema>;

export interface BuiltInThemeMeta {
  id: BuiltInThemeId;
  name: string;
  description: string;
}

/**
 * Built-in palette metadata, shared by the CLI (`bb theme list`) and the
 * Settings picker. The actual CSS strings live in the frontend registry; this
 * is just the id/name/description list the server validates against.
 */
export const builtInThemes: readonly BuiltInThemeMeta[] = [
  { id: "default", name: "Default", description: "The standard bb look" },
  { id: "nord", name: "Nord", description: "Cool, muted arctic blues" },
  {
    id: "dracula",
    name: "Dracula",
    description: "Dark, high-contrast purple and pink",
  },
  {
    id: "solarized",
    name: "Solarized",
    description: "Balanced light and dark (Schoonover palette)",
  },
  { id: "gruvbox", name: "Gruvbox", description: "Warm retro earth tones" },
  {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Soothing pastel — Latte light, Mocha dark",
  },
];

/** Built-in palette ids. */
export const BUILTIN_THEME_IDS = builtInThemeIdSchema.options;

/** Whether an id refers to a bundled built-in palette (vs. a custom theme). */
export function isBuiltInThemeId(id: string): id is BuiltInThemeId {
  return (BUILTIN_THEME_IDS as readonly string[]).includes(id);
}

/**
 * Custom theme name = the directory under `<data-dir>/theme/`. Constrained to a
 * single safe path segment (no separators or `..`) so it can be used directly as
 * a filesystem path and a stable id; built-in ids are not allowed (they're
 * reserved and would shadow the custom theme).
 */
export const customThemeNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    "Custom theme names may use letters, digits, '.', '_', and '-' and cannot start with '.'",
  )
  .refine((name) => name !== "." && name !== "..", "Invalid custom theme name")
  .refine(
    (name) => !isBuiltInThemeId(name),
    "Custom theme name collides with a built-in palette id",
  );

/** Max size of a user-supplied custom stylesheet; keeps the persisted and
 * broadcast config payload bounded. */
export const CUSTOM_THEME_CSS_MAX_LENGTH = 256_000;

/**
 * The active palette as resolved by the server: a palette id (built-in or
 * custom theme name) plus the resolved custom CSS (null for built-ins, the
 * `theme.css` contents for a custom theme).
 */
/**
 * Selectable favicon tints. The hex values and canvas tinting live in the
 * frontend; the contract only needs the set of allowed ids so the server can
 * validate writes. "default" leaves the monochrome glyph untinted.
 */
export const FAVICON_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;
export type FaviconColor = (typeof FAVICON_COLORS)[number];

export const faviconColorPreferenceSchema = z.enum([
  "default",
  ...FAVICON_COLORS,
]);
export type FaviconColorPreference = z.infer<typeof faviconColorPreferenceSchema>;

export const defaultFaviconColor: FaviconColorPreference = "default";

export const appThemeSchema = z.object({
  themeId: z.string().min(1),
  /** Resolved CSS for a custom palette; null for built-ins. */
  customCss: z.string().max(CUSTOM_THEME_CSS_MAX_LENGTH).nullable(),
  /** Browser tab icon tint; "default" leaves the glyph untinted. */
  faviconColor: faviconColorPreferenceSchema,
});
export type AppTheme = z.infer<typeof appThemeSchema>;

/**
 * The appearance selection a client sends when changing the palette and/or the
 * favicon tint. The server validates `themeId` (built-in id or an existing
 * custom theme) and resolves the CSS from disk for custom themes. `faviconColor`
 * is omitted to leave the current tint unchanged, so a theme-only change (and
 * the CLI/SDK `theme set`, which only knows the id) never resets the tint.
 */
export const appThemeSelectionSchema = z.object({
  themeId: z.string().min(1),
  faviconColor: faviconColorPreferenceSchema.optional(),
});
export type AppThemeSelection = z.infer<typeof appThemeSelectionSchema>;

export const defaultAppTheme: AppTheme = {
  themeId: "default",
  customCss: null,
  faviconColor: defaultFaviconColor,
};
