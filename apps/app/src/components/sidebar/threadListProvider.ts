import { atomWithStorage } from "jotai/utils";
import { useAtomValue } from "jotai";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

const THREAD_LIST_PROVIDER_STORAGE_KEY = "bb.sidebar.threadListProvider";

/** The built-in list; also the value stored when the user picks it back. */
export const BUILT_IN_THREAD_LIST_PROVIDER = "__builtin__";

/**
 * Which thread list fills the sidebar's scroll area, as
 * `<pluginId>/<slotId>` — or {@link BUILT_IN_THREAD_LIST_PROVIDER}.
 *
 * Client-local, like the sidebar's other layout preferences: a plugin the
 * user has not installed on this device must not blank their sidebar, and the
 * preference is about this screen, not this account.
 */
export const threadListProviderAtom = atomWithStorage<string>(
  THREAD_LIST_PROVIDER_STORAGE_KEY,
  BUILT_IN_THREAD_LIST_PROVIDER,
  createJsonLocalStorage<string>(),
  { getOnInit: true },
);

export function threadListProviderKey(
  slot: Pick<PluginThreadListSlot, "pluginId" | "id">,
): string {
  return `${slot.pluginId}/${slot.id}`;
}

/**
 * The slot the preference names, or null for the built-in list.
 *
 * A preference naming a provider that is not registered right now resolves to
 * null WITHOUT clearing the stored value: a disabled, reloading, or
 * not-yet-interpreted plugin must fall back to the built-in list and get its
 * sidebar back when it returns.
 */
export function resolveThreadListProvider(
  slots: readonly PluginThreadListSlot[],
  preference: string,
): PluginThreadListSlot | null {
  if (preference === BUILT_IN_THREAD_LIST_PROVIDER) return null;
  return (
    slots.find((slot) => threadListProviderKey(slot) === preference) ?? null
  );
}

/** The resolved thread-list slot for the sidebar, or null for the built-in. */
export function useThreadListProvider(): PluginThreadListSlot | null {
  const { threadLists } = usePluginSlots();
  const preference = useAtomValue(threadListProviderAtom);
  return resolveThreadListProvider(threadLists, preference);
}
