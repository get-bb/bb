import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const sidebarLifecycleFilterAtom = createSyncedPreferenceAtom(
  "sidebar.lifecycleFilter",
);
