import { sidebarNavigationProviderAtom } from "@/components/sidebar/sidebarNavigationProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarNavigationSetting() {
  const { experimentalSidebarNavigations } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Navigation"
      triggerAriaLabel="Sidebar navigation"
      description="Choose who arranges the host-owned sidebar destinations on this device."
      builtInDescription="Native New thread, Search, Plugins, Skills, and plugin panels."
      preferenceAtom={sidebarNavigationProviderAtom}
      slots={experimentalSidebarNavigations}
    />
  );
}
