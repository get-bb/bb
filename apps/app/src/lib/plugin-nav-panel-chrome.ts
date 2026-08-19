import { useEffect, useMemo } from "react";
import { z } from "zod";
import { createLastKnownCache } from "@/lib/last-known-cache";
import {
  usePluginFrontendBootComplete,
  usePluginFrontendsSettled,
} from "@/lib/plugin-frontend-boot-state";
import { usePluginSlots, type PluginNavPanelSlot } from "@/lib/plugin-slots";

const pluginNavPanelChromeSchema = z.object({
  pluginId: z.string().min(1),
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string(),
  icon: z.string(),
});

/**
 * The host-owned chrome of a plugin `navPanel` registration: everything the
 * app header, the sidebar row, and a split pane header need to draw the panel
 * without its component. Serializable, so it can be remembered across loads.
 */
export type PluginNavPanelChrome = z.infer<typeof pluginNavPanelChromeSchema>;

export interface PluginNavPanelChromeEntry {
  chrome: PluginNavPanelChrome;
  /** The live registration, or null while this entry is a remembered one. */
  panel: PluginNavPanelSlot | null;
}

/**
 * Registrations arrive only after plugin frontends boot, well after first
 * paint, so a reload used to draw the header title, the sidebar's plugin rows,
 * and split-pane titles empty and then pop them in. Remember the chrome of the
 * panels this profile last saw and paint it first; live registrations replace
 * it under the same keys once they arrive, so a matching plugin reconciles in
 * place. Panel bodies never replay — a remembered row navigates to a route
 * that stays quiet until the plugin loads.
 *
 * One entry per profile: a bb origin serves one server, and bb connect / the
 * desktop app give each server its own origin, so scoping is unnecessary.
 */
const chromeCache = createLastKnownCache({
  prefix: "bb.plugin-nav-panels",
  version: "1",
  schema: z.array(pluginNavPanelChromeSchema),
});
const CHROME_CACHE_KEY = chromeCache.key("all");

export function pluginNavPanelChromeOf(
  panel: PluginNavPanelSlot,
): PluginNavPanelChrome {
  return {
    pluginId: panel.pluginId,
    id: panel.id,
    path: panel.path,
    title: panel.title,
    icon: panel.icon,
  };
}

function chromeKey(chrome: Pick<PluginNavPanelChrome, "pluginId" | "id">) {
  return `${chrome.pluginId}/${chrome.id}`;
}

export function readLastKnownPluginNavPanelChrome(): PluginNavPanelChrome[] {
  return chromeCache.read(CHROME_CACHE_KEY) ?? [];
}

export function writeLastKnownPluginNavPanelChrome(
  chrome: readonly PluginNavPanelChrome[],
): void {
  chromeCache.write(CHROME_CACHE_KEY, [...chrome]);
}

/**
 * The nav panels to draw right now: live registrations, plus — until plugin
 * frontends have settled — remembered chrome for panels that have not
 * registered yet, in the order they were last seen. After settle the list is
 * live registrations only, so a removed plugin does not linger.
 */
export function usePluginNavPanelChrome(): PluginNavPanelChromeEntry[] {
  const settled = usePluginFrontendsSettled();
  const { navPanels } = usePluginSlots();
  // Read once per boot phase; the store is not subscribed to because only
  // this app writes it, and it writes after settle.
  const remembered = useMemo(
    () => (settled ? [] : readLastKnownPluginNavPanelChrome()),
    [settled],
  );
  return useMemo(() => {
    const live = navPanels.map((panel) => ({
      chrome: pluginNavPanelChromeOf(panel),
      panel,
    }));
    if (remembered.length === 0) return live;
    const liveByKey = new Map(
      live.map((entry) => [chromeKey(entry.chrome), entry]),
    );
    const entries: PluginNavPanelChromeEntry[] = remembered.map(
      (chrome) => liveByKey.get(chromeKey(chrome)) ?? { chrome, panel: null },
    );
    const rememberedKeys = new Set(remembered.map(chromeKey));
    for (const entry of live) {
      if (!rememberedKeys.has(chromeKey(entry.chrome))) entries.push(entry);
    }
    return entries;
  }, [navPanels, remembered]);
}

/**
 * Keeps the remembered chrome current: once the first plugin boot has actually
 * completed, every change to the live registrations is written back, so the
 * next load paints exactly the panels this profile ended with (including
 * none). The settle floor is not completion: a boot that never started, or is
 * still mounting content scripts, has no registrations worth remembering, and
 * writing its empty list would erase valid remembered chrome.
 */
export function useRememberPluginNavPanelChrome(): void {
  const bootComplete = usePluginFrontendBootComplete();
  const { navPanels } = usePluginSlots();
  useEffect(() => {
    if (!bootComplete) return;
    writeLastKnownPluginNavPanelChrome(navPanels.map(pluginNavPanelChromeOf));
  }, [navPanels, bootComplete]);
}
