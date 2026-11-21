import { useEffect, useState } from "react";
import { z } from "zod";
import {
  parseUiPreferenceValue,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import { createLastKnownCache } from "@/lib/last-known-cache";
import {
  usePluginFrontendsSettled,
  usePluginFrontendsSettledOnce,
} from "@/lib/plugin-frontend-boot-state";
import { useBbPluginIds } from "@/lib/plugin-slots";
import {
  createSyncedPreferenceAtom,
  type LegacyPreferenceStore,
  type SyncedPreferenceAtom,
} from "@/lib/ui-preferences/synced-preference-atom";

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

export type ExclusiveResolution<Slot> =
  | { kind: "plugin"; registration: Slot; fallback: Slot | null }
  | { kind: "builtin" }
  | { kind: "loading" }
  | { kind: "contested"; claimants: readonly Slot[] };

export interface ExclusiveRule {
  builtin: boolean;
  automatic: "ranked" | "none";
}

export const REPLACEMENT_RULE: ExclusiveRule = {
  builtin: true,
  automatic: "ranked",
};

export const PLUGIN_ONLY_RULE: ExclusiveRule = {
  builtin: false,
  automatic: "ranked",
};

export const NO_AUTOMATIC_RULE: ExclusiveRule = {
  builtin: true,
  automatic: "none",
};

export function findAutomaticReplacement<
  Slot extends ReplacementProviderIdentity,
>(slots: readonly Slot[], bbPluginIds: ReadonlySet<string>): Slot | undefined {
  return slots.find((slot) => !bbPluginIds.has(slot.pluginId)) ?? slots[0];
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
  rule: ExclusiveRule = REPLACEMENT_RULE,
): string {
  return (rule.builtin && preference === BUILT_IN_REPLACEMENT_PROVIDER) ||
    findPinnedReplacement(slots, preference) !== undefined
    ? preference
    : AUTOMATIC_REPLACEMENT_PROVIDER;
}

export interface ExclusiveResolveInput<Slot> {
  claimants: readonly Slot[];
  pick: string;
  bbPluginIds: ReadonlySet<string>;
  settledOnce: boolean;
  settled: boolean;
  rememberedAutomatic: string | null;
  rule: ExclusiveRule;
}

export function resolveExclusive<Slot extends ReplacementProviderIdentity>({
  claimants,
  pick,
  bbPluginIds,
  settledOnce,
  settled,
  rememberedAutomatic,
  rule,
}: ExclusiveResolveInput<Slot>): ExclusiveResolution<Slot> {
  const withFallback = (registration: Slot): ExclusiveResolution<Slot> => ({
    kind: "plugin",
    registration,
    fallback: bbPluginIds.has(registration.pluginId)
      ? null
      : (claimants.find((claimant) => bbPluginIds.has(claimant.pluginId)) ??
        null),
  });
  const pinned = findPinnedReplacement(claimants, pick);
  if (pinned !== undefined) return withFallback(pinned);
  const builtinPick = pick === BUILT_IN_REPLACEMENT_PROVIDER;
  if (rule.builtin && builtinPick) return { kind: "builtin" };
  if (!settledOnce && pick !== AUTOMATIC_REPLACEMENT_PROVIDER && !builtinPick) {
    return { kind: "loading" };
  }
  if (rule.automatic === "none") {
    const [only] = claimants;
    if (only === undefined) return { kind: "builtin" };
    return claimants.length === 1
      ? withFallback(only)
      : { kind: "contested", claimants };
  }
  const automatic = findAutomaticReplacement(claimants, bbPluginIds);
  if (
    !settled &&
    pick === AUTOMATIC_REPLACEMENT_PROVIDER &&
    rememberedAutomatic !== null &&
    (automatic === undefined ||
      replacementProviderKey(automatic) !== rememberedAutomatic)
  ) {
    return { kind: "loading" };
  }
  return automatic === undefined
    ? { kind: "builtin" }
    : withFallback(automatic);
}

export interface ExclusiveBootState {
  bbPluginIds: ReadonlySet<string>;
  settledOnce: boolean;
  settled: boolean;
}

export function useExclusiveBootState(): ExclusiveBootState {
  return {
    bbPluginIds: useBbPluginIds(),
    settledOnce: usePluginFrontendsSettledOnce(),
    settled: usePluginFrontendsSettled(),
  };
}

export interface RememberedAutomatic {
  read(): string | null;
  write(key: string): void;
}

export function createRememberedAutomatic(prefix: string): RememberedAutomatic {
  const cache = createLastKnownCache({
    prefix,
    version: "1",
    schema: z.string().min(1),
  });
  const key = cache.key();
  return {
    read: () => cache.read(key),
    write: (value) => cache.write(key, value),
  };
}

export function useExclusiveResolution<
  Slot extends ReplacementProviderIdentity,
>(
  claimants: readonly Slot[],
  pick: string,
  rule: ExclusiveRule,
  remembered?: RememberedAutomatic,
): ExclusiveResolution<Slot> {
  const boot = useExclusiveBootState();
  const [rememberedAutomatic] = useState(() => remembered?.read() ?? null);
  const resolved = resolveExclusive({
    claimants,
    pick,
    rule,
    rememberedAutomatic,
    ...boot,
  });
  const resolvedKey =
    resolved.kind === "plugin"
      ? replacementProviderKey(resolved.registration)
      : null;
  useEffect(() => {
    if (remembered !== undefined && resolvedKey !== null) {
      remembered.write(resolvedKey);
    }
  }, [remembered, resolvedKey]);
  return resolved;
}

export type ExclusivePickKey =
  | "composer.provider"
  | "sidebar.threadListProvider"
  | "sidebar.navigationProvider"
  | "diff.provider"
  | "sourceCode.provider"
  | "threadHeader.titleProvider";

export type ExclusivePickMapKey =
  | "fileOpener.byExtension"
  | "codeFence.byLanguage"
  | "messageDirective.byName";

function pickCacheStore<Key extends UiPreferenceKey>(
  preferenceKey: Key,
  prefix: string,
) {
  const cache = createLastKnownCache({
    prefix,
    version: "1",
    schema: z.custom<UiPreferenceValue<Key>>(
      (value) => parseUiPreferenceValue(preferenceKey, value).success,
    ),
  });
  const key = cache.key();
  return {
    read: () => cache.read(key),
    write: (value: UiPreferenceValue<Key>) => cache.write(key, value),
  };
}

export function createPickPreferenceAtom<Key extends ExclusivePickKey>(
  key: Key,
  options: {
    cachePrefix?: string;
    legacy?: LegacyPreferenceStore<UiPreferenceValue<Key>>;
  } = {},
): SyncedPreferenceAtom<Key> {
  return createSyncedPreferenceAtom(
    key,
    pickCacheStore(key, options.cachePrefix ?? `bb.ui-pick.${key}`),
    options.legacy,
  );
}

export function createPickMapPreferenceAtom<Key extends ExclusivePickMapKey>(
  key: Key,
  options: { legacy?: LegacyPreferenceStore<UiPreferenceValue<Key>> } = {},
): SyncedPreferenceAtom<Key> {
  return createSyncedPreferenceAtom(
    key,
    pickCacheStore(key, `bb.ui-pick.${key}`),
    options.legacy,
  );
}

export function createLegacyLocalPick<Value>(
  storageKey: string,
  convert: (stored: unknown) => Value | null,
): LegacyPreferenceStore<Value> {
  return {
    read: () => {
      try {
        const raw = window.localStorage.getItem(storageKey);
        return raw === null ? null : convert(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    clear: () => {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {}
    },
  };
}
