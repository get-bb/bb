import { atomWithStorage } from "jotai/utils";
import { useAtomValue } from "jotai";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { resolveThreadListReplacement } from "@/lib/plugin-slot-resolvers";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

const THREAD_LIST_PROVIDER_STORAGE_KEY = "bb.sidebar.threadListProvider";

/** Follow deterministic slot order and activate the first provider. */
export const AUTOMATIC_THREAD_LIST_PROVIDER = "__automatic__";

/** Always use BB's own thread list. */
export const BUILT_IN_THREAD_LIST_PROVIDER = "__builtin__";

/**
 * Automatic by default, with an explicit per-client override available in
 * Appearance. Existing stored built-in and plugin selections remain valid.
 */
export const threadListProviderAtom = atomWithStorage<string>(
  THREAD_LIST_PROVIDER_STORAGE_KEY,
  AUTOMATIC_THREAD_LIST_PROVIDER,
  createJsonLocalStorage<string>(),
  { getOnInit: true },
);

export function threadListProviderKey(
  slot: Pick<PluginThreadListSlot, "pluginId" | "id">,
): string {
  return `${slot.pluginId}/${slot.id}`;
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
  const resolved = resolveThreadListProviderReplacement(slots, preference);
  return resolved.kind === "plugin" ? resolved.registration : null;
}

function resolveThreadListProviderReplacement(
  slots: readonly PluginThreadListSlot[],
  preference: string,
): ResolvedReplacement<PluginThreadListSlot> {
  if (preference === BUILT_IN_THREAD_LIST_PROVIDER) return { kind: "owner" };
  return resolveThreadListReplacement(
    slots,
    preference === AUTOMATIC_THREAD_LIST_PROVIDER
      ? undefined
      : (candidate) => threadListProviderKey(candidate) === preference,
  );
}

/** The active replacement, or the owner when none is registered. */
export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolveThreadListProviderReplacement(threadLists, preference);
}
