import { useEffect } from "react";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import { useThemePreference } from "./useTheme";

/**
 * Push the renderer's theme preference to the Electron main process so the
 * NSWindow chrome (traffic lights + inactive title-bar) follows bb's explicit
 * theme or the OS when set to system. Mounts once at the app root; safely
 * no-ops in the web build where `window.bbDesktop` is undefined.
 */
export function useDesktopThemeSync(): void {
  const themePreference = useThemePreference();
  useEffect(() => {
    const desktopApi = getBbDesktopInfo();
    desktopApi?.setTheme(themePreference);
  }, [themePreference]);
}
