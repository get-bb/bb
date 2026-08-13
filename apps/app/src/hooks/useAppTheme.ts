import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { refreshThemeColorMeta } from "@/hooks/useTheme";
import { applyResolvedCodeTheme } from "@/lib/code-theme";
import {
  applyAppThemeCss,
  getAppThemeEpoch,
  resolveAppThemeCss,
  subscribeAppThemeChange,
} from "@/lib/themes";

/**
 * Applies the server-stored app palette (built-in id or custom CSS) by injecting
 * a trailing <style> in <head>. Re-runs whenever /system/config changes (the CLI
 * or another window switched palettes), which the systemConfig query already
 * refetches on the `config-changed` broadcast.
 */
export function useAppTheme(): void {
  const { data } = useSystemConfig();
  const appearance = data?.appearance;
  const css = appearance ? resolveAppThemeCss(appearance) : null;

  useLayoutEffect(() => {
    if (appearance?.resolvedCodeTheme === undefined) return;
    applyResolvedCodeTheme(appearance.resolvedCodeTheme);
  }, [appearance?.resolvedCodeTheme]);

  useEffect(() => {
    if (css === null) return;
    applyAppThemeCss(css);
    // A palette change can move the page background without a light/dark mode
    // change, so re-sync the PWA chrome color to match.
    refreshThemeColorMeta();
  }, [css]);
}

/**
 * A counter that increments whenever the active palette CSS changes. Surfaces
 * that bake colors instead of consuming `var(--token)` (mermaid SVGs, the xterm
 * canvas) depend on this to re-resolve their colors after a palette swap that
 * doesn't toggle light/dark mode.
 */
export function useAppThemeEpoch(): number {
  return useSyncExternalStore(
    subscribeAppThemeChange,
    getAppThemeEpoch,
    getAppThemeEpoch,
  );
}
