import { sidebarHeaderProviderAtom } from "@/components/sidebar/sidebarHeaderProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarHeaderSetting() {
  const { experimentalSidebarHeaders } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Sidebar header"
      triggerAriaLabel="Sidebar header"
      description="Choose what appears beside the sidebar toggle. Shown with a list navigation such as Top list; the rail puts New thread there."
      builtInDescription="Only the sidebar toggle and the back and forward buttons."
      allowAutomatic={false}
      preferenceAtom={sidebarHeaderProviderAtom}
      slots={experimentalSidebarHeaders}
    />
  );
}
