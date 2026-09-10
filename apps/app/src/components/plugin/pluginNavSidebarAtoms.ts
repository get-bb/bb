import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const pluginNavPanelOrderAtom = createSyncedPreferenceAtom(
  "sidebar.pluginPanelOrder",
);

export const pluginNavVisiblePanelKeysAtom = createSyncedPreferenceAtom(
  "sidebar.visiblePluginPanels",
);
