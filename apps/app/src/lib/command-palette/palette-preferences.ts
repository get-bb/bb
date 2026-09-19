import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const paletteThreadLifecyclesAtom = createSyncedPreferenceAtom(
  "palette.threadLifecycles",
);
