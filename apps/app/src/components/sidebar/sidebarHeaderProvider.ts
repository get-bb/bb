import { useAtomValue } from "jotai";
import { resolvePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type ExperimentalSidebarHeaderSlot,
} from "@/lib/plugin-slots";

export const sidebarHeaderProviderAtom = createSyncedPreferenceAtom(
  "sidebar.headerProvider",
);

export function useSidebarHeaderReplacement(): ResolvedReplacement<ExperimentalSidebarHeaderSlot> {
  const { experimentalSidebarHeaders } = usePluginSlots();
  const preference = useAtomValue(sidebarHeaderProviderAtom);
  return resolvePreferredReplacement(experimentalSidebarHeaders, preference);
}
