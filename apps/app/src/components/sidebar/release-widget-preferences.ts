import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const dismissedReleaseVersionAtom = createSyncedPreferenceAtom(
  "updates.dismissedReleaseVersion",
);
