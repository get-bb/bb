import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";

const PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY = "bb.sidebar.pluginPanelOrder";
const HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY = "bb.sidebar.hiddenPluginPanels";

export const pluginNavPanelOrderAtom = atomWithStorage<string[]>(
  PLUGIN_NAV_PANEL_ORDER_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);

export const hiddenPluginNavPanelsAtom = atomWithStorage<string[]>(
  HIDDEN_PLUGIN_NAV_PANELS_STORAGE_KEY,
  [],
  createJsonLocalStorage<string[]>(),
  { getOnInit: true },
);
