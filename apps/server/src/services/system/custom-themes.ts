import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CUSTOM_THEME_CSS_MAX_LENGTH,
  customThemeNameSchema,
  defaultAppTheme,
  isBuiltInThemeId,
  type AppTheme,
} from "@bb/domain";

const THEME_DIR_NAME = "theme";
const THEME_CSS_FILE_NAME = "theme.css";

/**
 * Custom themes live on disk under the app data dir, mirroring how user skills
 * live under `<data-dir>/skills`. A theme is a directory holding a `theme.css`;
 * the directory name is the palette id.
 */
export function resolveThemeRootPath(dataDir: string): string {
  return join(dataDir, THEME_DIR_NAME);
}

/** Absolute path to a custom theme's stylesheet. */
export function resolveCustomThemeCssPath(
  themeRoot: string,
  name: string,
): string {
  return join(themeRoot, name, THEME_CSS_FILE_NAME);
}

/**
 * Discover custom themes: subdirectories of `<themeRoot>` whose name is a safe
 * single path segment and that contain a `theme.css`. Sorted for stable
 * UI/CLI ordering.
 */
export function listCustomThemeNames(themeRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(themeRoot, { withFileTypes: true });
  } catch {
    return []; // No theme dir yet (ENOENT) → no custom themes.
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => customThemeNameSchema.safeParse(name).success)
    .filter((name) => existsSync(resolveCustomThemeCssPath(themeRoot, name)))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Read a custom theme's stylesheet. Returns null when the name is unsafe, the
 * file is missing, or it exceeds the size cap (kept bounded because the CSS is
 * broadcast inline in the system config payload).
 */
export function readCustomThemeCss(
  themeRoot: string,
  name: string,
): string | null {
  if (!customThemeNameSchema.safeParse(name).success) return null;
  let css: string;
  try {
    css = readFileSync(resolveCustomThemeCssPath(themeRoot, name), "utf8");
  } catch {
    return null;
  }
  if (css.length > CUSTOM_THEME_CSS_MAX_LENGTH) return null;
  return css;
}

/**
 * Resolve a stored palette id into the active appearance: built-ins carry no
 * CSS (the frontend bundles it); a custom theme's CSS is read from disk. A
 * selection whose theme folder is gone (deleted out from under the app) falls
 * back to the default palette so the app never renders against missing CSS.
 */
export function resolveAppTheme(themeRoot: string, themeId: string): AppTheme {
  if (isBuiltInThemeId(themeId)) return { themeId, customCss: null };
  const customCss = readCustomThemeCss(themeRoot, themeId);
  if (customCss === null) return defaultAppTheme;
  return { themeId, customCss };
}
