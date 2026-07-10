import { useEffect } from "react";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { usePreferredTheme } from "./useTheme";

/**
 * Push the renderer-resolved theme to the Electron main process so the
 * NSWindow chrome (traffic lights + inactive title-bar) follows bb's theme
 * rather than the OS appearance. Mounts once at the app root; safely no-ops
 * in the web build where `window.bbDesktop` is undefined.
 */
export function useDesktopThemeSync(): void {
  const theme = usePreferredTheme();
  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    desktopApi?.setTheme(theme);
  }, [theme]);
}
