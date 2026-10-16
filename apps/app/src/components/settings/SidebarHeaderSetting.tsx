import { sidebarHeaderProviderAtom } from "@/components/sidebar/sidebarHeaderProvider";
import { useSidebarNavigationPlacement } from "@/components/sidebar/sidebarNavigationProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarHeaderSetting() {
  const { experimentalSidebarHeaders } = usePluginSlots();
  const isRail = useSidebarNavigationPlacement() === "rail";
  return (
    <ReplacementProviderSetting
      label="Sidebar header"
      triggerAriaLabel="Sidebar header"
      description={
        isRail
          ? "Adds a plugin's controls next to the sidebar toggle. Unavailable with a rail, which puts New thread there."
          : "Adds a plugin's controls next to the sidebar toggle."
      }
      builtInDescription="Only the sidebar toggle and the back and forward buttons."
      allowAutomatic={false}
      disabled={isRail}
      preferenceAtom={sidebarHeaderProviderAtom}
      slots={experimentalSidebarHeaders}
    />
  );
}
