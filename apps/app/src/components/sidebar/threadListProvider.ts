import { useAtomValue } from "jotai";
import {
  createReplacementPreferenceAtom,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

const THREAD_LIST_PROVIDER_STORAGE_KEY = "bb.sidebar.threadListProvider";

/**
 * Automatic by default, with an explicit per-client override available in
 * Appearance. Existing stored built-in and plugin selections remain valid.
 */
export const threadListProviderAtom = createReplacementPreferenceAtom(
  THREAD_LIST_PROVIDER_STORAGE_KEY,
);

/** The active replacement, or the owner when none is registered. */
export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolvePreferredReplacement(threadLists, preference);
}
