import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const showProviderCliUpdatesAtom = createSyncedPreferenceAtom(
  "sidebar.updates.providerCli",
);
