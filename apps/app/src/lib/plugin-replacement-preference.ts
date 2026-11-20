import { atomWithStorage } from "jotai/utils";
import { createJsonLocalStorage } from "@/lib/browser-storage";
import { usePluginFrontendsSettledOnce } from "@/lib/plugin-frontend-boot-state";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
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

export function findPinnedReplacement<Slot extends ReplacementProviderIdentity>(
  slots: readonly Slot[],
  preference: string,
): Slot | undefined {
  return slots.find((slot) => replacementProviderKey(slot) === preference);
}

export function effectiveReplacementPreference(
  slots: readonly ReplacementProviderIdentity[],
  preference: string,
): string {
  return preference === BUILT_IN_REPLACEMENT_PROVIDER ||
    findPinnedReplacement(slots, preference) !== undefined
    ? preference
    : AUTOMATIC_REPLACEMENT_PROVIDER;
}

export function resolvePreferredReplacement<
  Slot extends ReplacementProviderIdentity,
>(
  slots: readonly Slot[],
  preference: string,
  builtinPluginIds: ReadonlySet<string>,
  settledOnce: boolean,
): ResolvedReplacement<Slot> {
  if (preference === BUILT_IN_REPLACEMENT_PROVIDER) return { kind: "owner" };
  const pinned = findPinnedReplacement(slots, preference);
  if (pinned !== undefined) return { kind: "plugin", registration: pinned };
  if (preference !== AUTOMATIC_REPLACEMENT_PROVIDER && !settledOnce) {
    return { kind: "owner" };
  }
  const registration = findAutomaticReplacement(slots, builtinPluginIds);
  return registration === undefined
    ? { kind: "owner" }
    : { kind: "plugin", registration };
}

export function usePreferredReplacement<
  Slot extends ReplacementProviderIdentity,
>(slots: readonly Slot[], preference: string): ResolvedReplacement<Slot> {
  return resolvePreferredReplacement(
    slots,
    preference,
    useBuiltinPluginIds(),
    usePluginFrontendsSettledOnce(),
  );
}
