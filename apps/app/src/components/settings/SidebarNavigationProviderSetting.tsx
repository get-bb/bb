import { sidebarNavigationProviderAtom } from "@/components/sidebar/sidebarNavigationProvider";
import { usePluginSlotKind } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarNavigationProviderSetting() {
  const experimentalSidebarNavigations = usePluginSlotKind(
    "experimentalSidebarNavigations",
  );
  return (
    <ReplacementProviderSetting
      label="Navigation"
      triggerAriaLabel="Sidebar navigation"
      description="What draws New thread, Plugins, Skills, and plugin pages in the sidebar."
      preferenceAtom={sidebarNavigationProviderAtom}
      slots={experimentalSidebarNavigations}
    />
  );
}
