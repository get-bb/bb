import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarThreadListSetting() {
  const { threadLists } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Sidebar"
      triggerAriaLabel="Sidebar thread list"
      description="Choose automatic activation or a specific plugin on this device."
      preferenceAtom={threadListProviderAtom}
      slots={threadLists}
    />
  );
}
