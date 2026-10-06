import {
  BUNDLED_NAVIGATION_PROVIDER,
  sidebarNavigationProviderAtom,
} from "@/components/sidebar/sidebarNavigationProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarNavigationSetting({
  navigationRail,
}: {
  navigationRail: boolean;
}) {
  const { experimentalSidebarNavigations } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Navigation"
      triggerAriaLabel="Sidebar navigation"
      description={
        navigationRail
          ? "Not used while the Navigation rail experiment is on: bb draws the rail itself. Your choice applies again when you turn the experiment off."
          : "Choose who arranges the host-owned sidebar destinations on this device."
      }
      bundledProvider={BUNDLED_NAVIGATION_PROVIDER}
      preferenceAtom={sidebarNavigationProviderAtom}
      slots={experimentalSidebarNavigations}
    />
  );
}
