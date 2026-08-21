import { useSyncExternalStore } from "react";

/**
 * Client-side plugin branding map taken from the GET /api/v1/plugins inventory
 * each time plugin frontends reconcile (boot + the realtime `plugins-changed`
 * broadcast). A tiny external store — not a query — lets compact leaf
 * components resolve named and plugin-owned compact branding without a
 * QueryClient in scope. The stored entries retain the full branding inventory
 * shape; roomy Settings consumers read the same logo URLs through their query
 * model.
 */

/** One plugin's logo asset URLs; either is null when that variant is absent. */
export interface PluginLogoUrls {
  /** User-facing manifest name; null when the inventory does not provide one. */
  displayName: string | null;
  /** Compact identity and the fallback when a roomy image logo is unavailable. */
  icon: string | null;
  /** Plugin-owned compact SVG, rendered as a currentColor mask. */
  compactIconUrl: string | null;
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

function subscribePluginLogos(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getPluginLogoUrls(): ReadonlyMap<string, PluginLogoUrls> {
  return logoUrls;
}

/** Compact branding resolved from the latest plugin inventory. */
export function usePluginCompactBranding(
  pluginId: string,
): Pick<PluginLogoUrls, "icon" | "compactIconUrl"> | null {
  const entries = useSyncExternalStore(subscribePluginLogos, getPluginLogoUrls);
  const branding = entries.get(pluginId);
  return branding === undefined
    ? null
    : { icon: branding.icon, compactIconUrl: branding.compactIconUrl };
}

/** Manifest display name, with the stable plugin id as the unavailable fallback. */
export function usePluginDisplayName(pluginId: string): string {
  const entries = useSyncExternalStore(subscribePluginLogos, getPluginLogoUrls);
  return entries.get(pluginId)?.displayName ?? pluginId;
}

/** Test-only. */
export function resetPluginLogoStoreForTest(): void {
  setPluginLogoUrls(new Map());
}
