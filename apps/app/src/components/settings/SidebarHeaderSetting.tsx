import { sidebarHeaderProviderAtom } from "@/components/sidebar/sidebarHeaderProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarHeaderSetting() {
  const { experimentalSidebarHeaders } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Header"
      triggerAriaLabel="Sidebar header"
      description="Choose what appears beside the sidebar toggle on this device."
      builtInDescription="Only the sidebar toggle and the back and forward buttons."
      allowAutomatic={false}
      preferenceAtom={sidebarHeaderProviderAtom}
      slots={experimentalSidebarHeaders}
    />
  );
}
