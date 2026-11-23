import { useAtomValue } from "jotai";
import {
  createPickPreferenceAtom,
  createRememberedAutomatic,
  PLUGIN_ONLY_RULE,
  useExclusiveResolution,
  type ExclusiveResolution,
} from "@/lib/plugin-replacement-preference";
import {
  usePluginSlotKind,
  type PluginThreadListSlot,
} from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";

export const threadListProviderAtom = createPickPreferenceAtom(
  "sidebar.threadListProvider",
);

const rememberedThreadList = createRememberedAutomatic(
  "bb.thread-list-resolved",
);

export function useThreadListReplacement(): ExclusiveResolution<PluginThreadListSlot> {
  const threadLists = usePluginSlotKind("threadLists");
  const preference = useAtomValue(threadListProviderAtom);
  const resolved = useExclusiveResolution(
    threadLists,
    preference,
    PLUGIN_ONLY_RULE,
    rememberedThreadList,
  );
  useRememberSurfaceProvider(
    "thread-list",
    resolved.kind === "plugin" ? resolved.registration.pluginId : null,
  );
  return resolved;
}
