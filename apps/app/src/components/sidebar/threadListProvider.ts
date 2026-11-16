import { useAtomValue } from "jotai";
import { usePreferredReplacement } from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlotKind,
  type PluginThreadListSlot,
} from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";

export const threadListProviderAtom = createSyncedPreferenceAtom(
  "sidebar.threadListProvider",
);

export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const threadLists = usePluginSlotKind("threadLists");
  const preference = useAtomValue(threadListProviderAtom);
  const resolved = usePreferredReplacement(threadLists, preference);
  useRememberSurfaceProvider(
    "thread-list",
    resolved.kind === "plugin" ? resolved.registration.pluginId : null,
  );
  return resolved;
}
