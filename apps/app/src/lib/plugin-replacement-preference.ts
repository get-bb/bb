import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import {
  resolveReplacement,
  type ResolvedReplacement,
} from "@/lib/plugin-slot-resolvers";

/**
 * The per-client pin shared by every exclusive replacement surface that offers
 * one (the sidebar thread list, the source and diff renderers).
 *
 * All three answer the same question — automatic, BB's own, or one named
 * provider — so they answer it the same way, and a stored selection for an
 * unavailable provider degrades to BB without being erased: a temporarily
 * disabled plugin gets its surface back when it returns.
 */

/** Follow deterministic slot order and activate the first provider. */
export const AUTOMATIC_REPLACEMENT_PROVIDER = "__automatic__";

/** Always use BB's own implementation. */
export const BUILT_IN_REPLACEMENT_PROVIDER = "__builtin__";

interface ReplacementProviderIdentity {
  pluginId: string;
  id: string;
}

export function replacementProviderKey(
  slot: ReplacementProviderIdentity,
): string {
  return `${slot.pluginId}/${slot.id}`;
}

export function createReplacementPreferenceAtom(storageKey: string) {
  return atomWithStorage<string>(
    storageKey,
    AUTOMATIC_REPLACEMENT_PROVIDER,
    createJsonLocalStorage<string>(),
    { getOnInit: true },
  );
}

export function resolvePreferredReplacement<
  Slot extends ReplacementProviderIdentity,
>(
  slots: readonly Slot[],
  preference: string = AUTOMATIC_REPLACEMENT_PROVIDER,
): ResolvedReplacement<Slot> {
  if (preference === BUILT_IN_REPLACEMENT_PROVIDER) return { kind: "owner" };
  return resolveReplacement(
    slots,
    preference === AUTOMATIC_REPLACEMENT_PROVIDER
      ? undefined
      : (candidate) => replacementProviderKey(candidate) === preference,
  );
}
