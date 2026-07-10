import { useEffect } from "react";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { useAppThemeEpoch } from "./useAppTheme";
import { usePreferredTheme } from "./useTheme";

/**
 * Push the renderer-resolved theme to the Electron main process so the
 * NSWindow chrome (traffic lights + inactive title-bar) follows bb's theme
 * rather than the OS appearance, and so the native server rail can re-derive
 * surfaces from --canvas/--ink. Mounts once at the app root; safely no-ops
 * in the web build where `window.bbDesktop` is undefined.
 *
 * Prefer the resolved payload `{mode, canvasColor, inkColor}` when available.
 * Older desktop shells that only accept the legacy mode string still work
 * because zod on the shell side accepts both.
 */
export function useDesktopThemeSync(): void {
  const theme = usePreferredTheme();
  const themeEpoch = useAppThemeEpoch();

  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    if (desktopApi === null) {
      return;
    }

    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const canvasColor = styles.getPropertyValue("--canvas").trim();
    const inkColor = styles.getPropertyValue("--ink").trim();

    if (canvasColor.length > 0 && inkColor.length > 0) {
      desktopApi.setTheme({
        canvasColor,
        inkColor,
        mode: theme,
      });
      return;
    }

    desktopApi.setTheme(theme);
  }, [theme, themeEpoch]);
}
