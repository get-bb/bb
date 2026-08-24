import { useCallback, useSyncExternalStore } from "react";
import { parseNamespacedGlyph } from "@bb/domain";

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
  /**
   * The plugin's declared icons (`bb.branding.experimental_icons`), declared
   * name → hashed SVG URL. A timeline row whose glyph is
   * `"<pluginId>/<name>"` resolves here; a name that is absent renders the
   * per-kind fallback glyph.
   */
  icons: ReadonlyMap<string, string>;
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
  const entries = useSyncExternalStore(
    subscribePluginLogos,
    getPluginLogoUrls,
    // The store is module-global, so static markup (tests render the
    // timeline through renderToStaticMarkup) reads the same snapshot.
    getPluginLogoUrls,
  );
  const branding = entries.get(pluginId);
  return branding === undefined
    ? null
    : { icon: branding.icon, compactIconUrl: branding.compactIconUrl };
}

/** Manifest display name, with the stable plugin id as the unavailable fallback. */
export function usePluginDisplayName(pluginId: string): string {
  const entries = useSyncExternalStore(
    subscribePluginLogos,
    getPluginLogoUrls,
    // The store is module-global, so static markup (tests render the
    // timeline through renderToStaticMarkup) reads the same snapshot.
    getPluginLogoUrls,
  );
  return entries.get(pluginId)?.displayName ?? pluginId;
}

/**
 * The SVG URL a namespaced glyph (`"<pluginId>/<name>"`) resolves to in the
 * latest inventory, or undefined when the glyph is not namespaced, the
 * plugin is not installed, or the name is not in its declared map — the
 * "not found" the per-kind fallback glyph covers. Resolved against the
 * client-held inventory on purpose: a CSS mask whose URL 404s renders
 * nothing, not the fallback, so the decision must happen before a mask is
 * emitted.
 *
 * The snapshot is the resolved URL, not the inventory map: every timeline
 * row subscribes here, and a reconcile (boot, `plugins-changed`, pageshow)
 * replaces the whole map, so selecting the URL keeps the rows whose icon did
 * not change from re-rendering.
 */
export function usePluginIconUrl(glyph: string | undefined): string | undefined {
  const getSnapshot = useCallback(
    () => resolvePluginIconUrl(getPluginLogoUrls(), glyph),
    [glyph],
  );
  return useSyncExternalStore(
    subscribePluginLogos,
    getSnapshot,
    // The store is module-global, so static markup (tests render the
    // timeline through renderToStaticMarkup) reads the same snapshot.
    getSnapshot,
  );
}

/** {@link usePluginIconUrl} over an explicit inventory, for non-hook callers. */
export function resolvePluginIconUrl(
  entries: ReadonlyMap<string, Pick<PluginLogoUrls, "icons">>,
  glyph: string | undefined,
): string | undefined {
  const parsed = glyph === undefined ? null : parseNamespacedGlyph(glyph);
  if (parsed === null) {
    return undefined;
  }
  return entries.get(parsed.pluginId)?.icons.get(parsed.name);
}

/** Test-only. */
export function resetPluginLogoStoreForTest(): void {
  setPluginLogoUrls(new Map());
}
