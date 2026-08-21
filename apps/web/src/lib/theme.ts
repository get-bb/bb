/* The bb.theme preference model, shared by the pre-paint inline script in
   routes/__root.tsx and the marketing nav's theme control in
   landing/site-chrome.tsx. Same key and value set as the bb app's useTheme, so
   the two agree wherever they share an origin. */

import themeInitSource from "./theme-init.js?raw";

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "bb.theme";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

export const THEME_INIT = `(${themeInitSource})(${JSON.stringify(
  THEME_STORAGE_KEY,
)},${JSON.stringify(DARK_SCHEME_QUERY)},${JSON.stringify(
  THEME_COLOR_SELECTOR,
)})`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can be unavailable (private mode); fall through to system.
  }
  return "system";
}

/* Point browser chrome at the right one of the two theme-color metas. This
   rewrites `media` rather than `content` for the reason themeInit explains,
   which also keeps both colour literals in one place (__root.tsx). */
export function syncThemeColorMeta(preference: ThemePreference) {
  for (const meta of document.querySelectorAll<HTMLMetaElement>(
    THEME_COLOR_SELECTOR,
  )) {
    const scheme = meta.dataset.scheme;
    if (scheme !== "light" && scheme !== "dark") continue;
    meta.media =
      preference === "system"
        ? `(prefers-color-scheme: ${scheme})`
        : scheme === preference
          ? "all"
          : "not all";
  }
}

export function applyThemePreference(preference: ThemePreference) {
  const dark =
    preference === "dark" ||
    (preference === "system" && matchMedia(DARK_SCHEME_QUERY).matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.setAttribute("data-theme-preference", preference);
  syncThemeColorMeta(preference);
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // The in-page change still applies for this visit.
  }
  applyThemePreference(preference);
}
