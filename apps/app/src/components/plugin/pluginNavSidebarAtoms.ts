import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY = "bb.sidebar.pluginPanelOrder";
const HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY = "bb.sidebar.hiddenPluginPanels";

/**
 * User-chosen order of the sidebar's plugin panel rows, as
 * `<pluginId>/<panelId>` keys. Includes hidden panels so unhiding restores a
 * panel to its old slot. Empty until the first drag, which means "registry
 * order". Client-local, like the other sidebar layout preferences.
 */
export const pluginNavPanelOrderAtom = atomWithStorage<string[]>(
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

/**
 * Plugin panel keys the user moved into the sidebar's "More" disclosure. The
 * panel and its route stay fully available — this only affects sidebar
 * placement.
 */
export const hiddenPluginNavPanelsAtom = atomWithStorage<string[]>(
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
