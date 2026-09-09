import { useAtomValue } from "jotai";
import { resolvePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";

export const sidebarNavigationProviderAtom = createSyncedPreferenceAtom(
  "sidebar.navigationProvider",
);

export function useSidebarNavigationReplacement(): ResolvedReplacement<ExperimentalSidebarNavigationSlot> {
  const { experimentalSidebarNavigations } = usePluginSlots();
  const preference = useAtomValue(sidebarNavigationProviderAtom);
  return resolvePreferredReplacement(
    experimentalSidebarNavigations,
    preference,
  );
}
