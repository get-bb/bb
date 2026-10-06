import { sidebarHeaderProviderAtom } from "@/components/sidebar/sidebarHeaderProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarHeaderSetting({
  navigationRail,
}: {
  navigationRail: boolean;
}) {
  const { experimentalSidebarHeaders } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Header"
      triggerAriaLabel="Sidebar header"
      description={
        navigationRail
          ? "Not used while the Navigation rail experiment is on: New thread takes the header. Your choice applies again when you turn the experiment off."
          : "Choose what appears beside the sidebar toggle on this device."
      }
      builtInDescription="Only the sidebar toggle and the back and forward buttons."
      allowAutomatic={false}
      preferenceAtom={sidebarHeaderProviderAtom}
      slots={experimentalSidebarHeaders}
    />
  );
}
