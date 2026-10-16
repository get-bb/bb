import { threadListProviderAtom } from "@/components/sidebar/threadListProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarThreadListSetting() {
  const { threadLists } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Sidebar thread list"
      triggerAriaLabel="Sidebar thread list"
      description="Which plugin draws your threads in the sidebar."
      preferenceAtom={threadListProviderAtom}
      slots={threadLists}
    />
  );
}
