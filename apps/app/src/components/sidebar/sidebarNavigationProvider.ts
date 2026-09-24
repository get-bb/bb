import { useAtomValue } from "jotai";
import { resolvePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlots,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";

export const BUNDLED_NAVIGATION_PLUGIN_ID = "navigation";

export const sidebarNavigationProviderAtom = createSyncedPreferenceAtom(
  "sidebar.navigationProvider",
);

export function useSidebarNavigationReplacement(): ResolvedReplacement<ExperimentalSidebarNavigationSlot> {
  const { experimentalSidebarNavigations } = usePluginSlots();
  const preference = useAtomValue(sidebarNavigationProviderAtom);
  const bootSettled = usePluginFrontendsSettled();
  const resolved = resolvePreferredReplacement(
    experimentalSidebarNavigations,
    preference,
  );
  if (resolved.kind === "plugin" || !bootSettled) return resolved;
  const bundled = experimentalSidebarNavigations.find(
    (slot) => slot.pluginId === BUNDLED_NAVIGATION_PLUGIN_ID,
  );
  return bundled === undefined
    ? resolved
    : { kind: "plugin", registration: bundled };
}
