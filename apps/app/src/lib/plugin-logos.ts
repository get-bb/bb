import { useSyncExternalStore } from "react";
import { usePreferredTheme } from "@/hooks/useTheme";

/**
 * Client-side plugin logo map: pluginId → hash-busted logo asset URLs (light
 * + optional dark variant), taken from the GET /api/v1/plugins inventory each
 * time the plugin frontends reconcile (boot + the realtime `plugins-changed`
 * broadcast). A tiny external store — not a query — so leaf components
 * (sidebar rows, menu rows, thread-action buttons) can resolve a plugin's
 * logo without needing a QueryClient in scope.
 */

/** One plugin's logo asset URLs; either is null when that variant is absent. */
export interface PluginLogoUrls {
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

let logoUrls: ReadonlyMap<string, PluginLogoUrls> = new Map();
const listeners = new Set<() => void>();

/** Replace the whole map (reconcile owns it; absent plugins drop out). */
export function setPluginLogoUrls(
  next: ReadonlyMap<string, PluginLogoUrls>,
): void {
  logoUrls = next;
  for (const listener of listeners) listener();
}

export function subscribePluginLogos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginLogoUrls(): ReadonlyMap<string, PluginLogoUrls> {
  return logoUrls;
}

/**
 * The plugin's logo asset URL for the app's current effective theme, or null
 * when it ships no usable logo. Dark mode prefers the dark variant and falls
 * back to the light one; re-renders when the resolved theme flips.
 */
export function usePluginLogoUrl(pluginId: string): string | null {
  const urls = useSyncExternalStore(subscribePluginLogos, getPluginLogoUrls);
  const theme = usePreferredTheme();
  const entry = urls.get(pluginId);
  if (entry === undefined) return null;
  if (theme === "dark" && entry.logoDarkUrl !== null) return entry.logoDarkUrl;
  return entry.logoUrl;
}

/** Test-only. */
export function resetPluginLogoStoreForTest(): void {
  setPluginLogoUrls(new Map());
}
