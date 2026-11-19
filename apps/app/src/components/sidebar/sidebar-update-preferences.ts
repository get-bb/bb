import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const showProviderCliUpdatesAtom = createSyncedPreferenceAtom(
  "sidebar.updates.providerCli",
);

export const skippedSidebarUpdatesAtom = createSyncedPreferenceAtom(
  "sidebar.updates.skipped",
);
