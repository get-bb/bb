import { useAtomValue } from "jotai";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  BUILT_IN_REPLACEMENT_PROVIDER,
  createReplacementPreferenceAtom,
  replacementProviderKey,
  resolvePreferredReplacement,
} from "@/lib/plugin-replacement-preference";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

const THREAD_LIST_PROVIDER_STORAGE_KEY = "bb.sidebar.threadListProvider";

/** Follow deterministic slot order and activate the first provider. */
export const AUTOMATIC_THREAD_LIST_PROVIDER = AUTOMATIC_REPLACEMENT_PROVIDER;

/** Always use BB's own thread list. */
export const BUILT_IN_THREAD_LIST_PROVIDER = BUILT_IN_REPLACEMENT_PROVIDER;

/**
 * Automatic by default, with an explicit per-client override available in
 * Appearance. Existing stored built-in and plugin selections remain valid.
 */
export const threadListProviderAtom = createReplacementPreferenceAtom(
  THREAD_LIST_PROVIDER_STORAGE_KEY,
);

export function threadListProviderKey(
  slot: Pick<PluginThreadListSlot, "pluginId" | "id">,
): string {
  return replacementProviderKey(slot);
}

/**
 * Resolve automatic, BB-owned, and explicit-provider modes. An unavailable
 * explicit provider falls back to BB without erasing the stored selection, so
 * a temporarily disabled plugin gets its list back when it returns.
 */
export function resolveThreadListProvider(
  slots: readonly PluginThreadListSlot[],
  preference: string = AUTOMATIC_THREAD_LIST_PROVIDER,
): PluginThreadListSlot | null {
  const resolved = resolvePreferredReplacement(slots, preference);
  return resolved.kind === "plugin" ? resolved.registration : null;
}

/** The active replacement, or the owner when none is registered. */
export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolvePreferredReplacement(threadLists, preference);
}
