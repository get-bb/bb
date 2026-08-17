import { resolveThreadListReplacement } from "@/lib/plugin-slot-resolvers";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import { usePluginSlots, type PluginThreadListSlot } from "@/lib/plugin-slots";

/**
 * The first registered thread-list replacement, or null for BB's list.
 * Snapshot order is deterministic: plugin id, then registration order.
 */
export function resolveThreadListProvider(
  slots: readonly PluginThreadListSlot[],
): PluginThreadListSlot | null {
  const resolved = resolveThreadListReplacement(slots);
  return resolved.kind === "plugin" ? resolved.registration : null;
}

/** The active replacement, or the owner when none is registered. */
export function useThreadListReplacement(): ResolvedReplacement<PluginThreadListSlot> {
  const { threadLists } = usePluginSlots();
  return resolveThreadListReplacement(threadLists);
}
