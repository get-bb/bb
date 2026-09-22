import { useAtomValue } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

export const threadListProviderAtom = createSyncedPreferenceAtom(
  "sidebar.threadListProvider",
);

export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolvePreferredReplacement(
    threadLists,
    preference === BUILT_IN_REPLACEMENT_PROVIDER
      ? AUTOMATIC_REPLACEMENT_PROVIDER
      : preference,
  );
}
