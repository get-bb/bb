import { z } from "zod";

/**
 * App color palette ("theme"), distinct from light/dark *mode* (which stays a
 * per-client localStorage preference). The palette is a set of CSS
 * custom-property overrides applied app-wide, persisted server-side so the CLI
 * and Settings can both set it and every open window stays in sync.
 *
 * `themeId` is either a built-in palette or "custom"; built-in CSS lives in the
 * frontend registry, so only the active id and the custom CSS text are stored.
 */
export const appThemeIdSchema = z.enum([
  "default",
  "nord",
  "dracula",
  "solarized",
  "gruvbox",
  "catppuccin",
  "custom",
]);
export type AppThemeId = z.infer<typeof appThemeIdSchema>;

export interface BuiltInThemeMeta {
  id: Exclude<AppThemeId, "custom">;
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

/** Built-in palette ids (everything except "custom"). */
export const BUILTIN_THEME_IDS = builtInThemes.map((theme) => theme.id);

/** Max size of a user-supplied custom stylesheet; keeps the persisted and
 * broadcast config payload bounded. */
export const CUSTOM_THEME_CSS_MAX_LENGTH = 256_000;

export const appThemeSchema = z
  .object({
    themeId: appThemeIdSchema,
    /** Raw CSS for the "custom" palette; null for built-ins. */
    customCss: z.string().max(CUSTOM_THEME_CSS_MAX_LENGTH).nullable(),
  })
  .refine((value) => value.themeId !== "custom" || value.customCss !== null, {
    message: 'customCss is required when themeId is "custom"',
    path: ["customCss"],
  });
export type AppTheme = z.infer<typeof appThemeSchema>;

export const defaultAppTheme: AppTheme = { themeId: "default", customCss: null };
