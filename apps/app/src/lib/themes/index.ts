import { isBuiltInThemeId, type AppTheme, type BuiltInThemeId } from "@bb/domain";
import { catppuccinThemeCss } from "./catppuccin";
import { draculaThemeCss } from "./dracula";
import { gruvboxThemeCss } from "./gruvbox";
import { nordThemeCss } from "./nord";
import { solarizedThemeCss } from "./solarized";

const APP_THEME_STYLE_ELEMENT_ID = "bb-app-theme";
export const APP_THEME_CSS_STORAGE_KEY = "bb.appThemeCss";

/**
 * CSS overrides per built-in palette. "default" is empty so the base theme.css
 * tokens show through. Custom palettes are supplied at runtime (the server reads
 * their CSS from disk), not from this registry.
 */
const builtInThemeCss: Record<BuiltInThemeId, string> = {
  default: "",
  nord: nordThemeCss,
  dracula: draculaThemeCss,
  solarized: solarizedThemeCss,
  gruvbox: gruvboxThemeCss,
  catppuccin: catppuccinThemeCss,
};

export function resolveAppThemeCss(appearance: AppTheme): string {
  if (isBuiltInThemeId(appearance.themeId)) {
    return builtInThemeCss[appearance.themeId];
  }
  return appearance.customCss ?? "";
}

function getOrCreateStyleElement(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(APP_THEME_STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;
  const style = document.createElement("style");
  style.id = APP_THEME_STYLE_ELEMENT_ID;
  // Appended last in <head> so its :root/.dark token overrides win over
  // theme.css by source order, regardless of the active light/dark mode.
  document.head.appendChild(style);
  return style;
}

// Surfaces that bake the palette into output once (mermaid SVGs, the xterm
// canvas) can't consume live `var(--token)`; they re-resolve computed colors
// when the palette changes. The epoch bumps AFTER the new CSS is applied to the
// DOM, so a subscriber re-resolving against it always sees the new values.
let appThemeEpoch = 0;
const appThemeSubscribers = new Set<() => void>();

export function subscribeAppThemeChange(callback: () => void): () => void {
  appThemeSubscribers.add(callback);
  return () => {
    appThemeSubscribers.delete(callback);
  };
}

export function getAppThemeEpoch(): number {
  return appThemeEpoch;
}

/**
 * Inject the resolved palette CSS as the trailing <style> in <head> and cache
 * it so the next load can apply it before the server config arrives (no flash).
 * Empty CSS (the default palette) clears both the element and the cache.
 */
export function applyAppThemeCss(css: string): void {
  const style = getOrCreateStyleElement();
  if (!style) return;
  if (style.textContent !== css) {
    style.textContent = css;
    appThemeEpoch += 1;
    appThemeSubscribers.forEach((callback) => callback());
  }
  try {
    if (css) localStorage.setItem(APP_THEME_CSS_STORAGE_KEY, css);
    else localStorage.removeItem(APP_THEME_CSS_STORAGE_KEY);
  } catch {
    // Best-effort cache; ignore private-mode / quota failures.
  }
}

/**
 * Apply the palette cached from the previous load. Called once at startup
 * before the server's /system/config (and thus the authoritative appearance)
 * has loaded, so a non-default palette doesn't flash the default first.
 */
export function applyCachedAppThemeCss(): void {
  if (typeof document === "undefined") return;
  let cached: string | null = null;
  try {
    cached = localStorage.getItem(APP_THEME_CSS_STORAGE_KEY);
  } catch {
    cached = null;
  }
  if (cached) applyAppThemeCss(cached);
}
