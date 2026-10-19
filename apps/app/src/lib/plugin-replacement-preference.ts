import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import {
  resolveReplacement,
  type ResolvedReplacement,
} from "@/lib/plugin-slot-resolvers";
import { useBuiltinPluginIds } from "@/lib/plugin-slots";

export const AUTOMATIC_REPLACEMENT_PROVIDER = "__automatic__";

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

export function findAutomaticReplacement<
  Slot extends ReplacementProviderIdentity,
>(
  slots: readonly Slot[],
  builtinPluginIds: ReadonlySet<string>,
): Slot | undefined {
  return slots.find((slot) => !builtinPluginIds.has(slot.pluginId)) ?? slots[0];
}

export function resolvePreferredReplacement<
  Slot extends ReplacementProviderIdentity,
>(
  slots: readonly Slot[],
  preference: string,
  builtinPluginIds: ReadonlySet<string>,
): ResolvedReplacement<Slot> {
  if (preference === BUILT_IN_REPLACEMENT_PROVIDER) return { kind: "owner" };
  if (preference === AUTOMATIC_REPLACEMENT_PROVIDER) {
    const registration = findAutomaticReplacement(slots, builtinPluginIds);
    return registration === undefined
      ? { kind: "owner" }
      : { kind: "plugin", registration };
  }
  return resolveReplacement(
    slots,
    (candidate) => replacementProviderKey(candidate) === preference,
  );
}

export function usePreferredReplacement<
  Slot extends ReplacementProviderIdentity,
>(slots: readonly Slot[], preference: string): ResolvedReplacement<Slot> {
  return resolvePreferredReplacement(slots, preference, useBuiltinPluginIds());
}
