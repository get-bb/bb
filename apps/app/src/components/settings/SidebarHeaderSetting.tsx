import { sidebarHeaderProviderAtom } from "@/components/sidebar/sidebarHeaderProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarHeaderSetting() {
  const { experimentalSidebarHeaders } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Sidebar header"
      triggerAriaLabel="Sidebar header"
      description="Adds a plugin's controls next to the sidebar toggle. Not shown when Navigation is Rail."
      builtInDescription="Only the sidebar toggle and the back and forward buttons."
      allowAutomatic={false}
      preferenceAtom={sidebarHeaderProviderAtom}
      slots={experimentalSidebarHeaders}
    />
  );
}
