import {
  BUNDLED_THREAD_LIST_PROVIDER,
  threadListProviderAtom,
} from "@/components/sidebar/threadListProvider";
import { usePluginSlots } from "@/lib/plugin-slots";
import { ReplacementProviderSetting } from "./ReplacementProviderSetting";

export function SidebarThreadListSetting() {
  const { threadLists } = usePluginSlots();
  return (
    <ReplacementProviderSetting
      label="Sidebar thread list"
      triggerAriaLabel="Sidebar thread list"
      description="Which plugin draws your threads in the sidebar."
      bundledProvider={BUNDLED_THREAD_LIST_PROVIDER}
      preferenceAtom={threadListProviderAtom}
      slots={threadLists}
    />
  );
}
