import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import type { ExperimentalSidebarNavigationPlacement } from "@get-bb/plugin-sdk";
import { createLastKnownCache } from "@/lib/last-known-cache";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import {
  usePluginSlots,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export const RAIL_NAVIGATION_PROVIDER = "__bb__/rail";
export const TOP_LIST_NAVIGATION_PROVIDER = "__bb__/top-list";

export interface BuiltInNavigationProvider {
  key: typeof RAIL_NAVIGATION_PROVIDER | typeof TOP_LIST_NAVIGATION_PROVIDER;
  title: string;
  description: string;
  placement: ExperimentalSidebarNavigationPlacement;
}

export const RAIL_NAVIGATION: BuiltInNavigationProvider = {
  key: RAIL_NAVIGATION_PROVIDER,
  title: "Rail",
  description: "Icons on the left edge",
  placement: "rail",
};

export const TOP_LIST_NAVIGATION: BuiltInNavigationProvider = {
  key: TOP_LIST_NAVIGATION_PROVIDER,
  title: "Top list",
  description: "Labeled rows above the thread list",
  placement: "list",
};

export const BUILT_IN_NAVIGATION_PROVIDERS = [
  RAIL_NAVIGATION,
  TOP_LIST_NAVIGATION,
] as const;

export function builtInNavigationForPlacement(
  placement: ExperimentalSidebarNavigationPlacement,
): BuiltInNavigationProvider {
  return placement === "rail" ? RAIL_NAVIGATION : TOP_LIST_NAVIGATION;
}

export type ResolvedSidebarNavigation =
  | { kind: "built-in"; provider: BuiltInNavigationProvider }
  | { kind: "plugin"; slot: ExperimentalSidebarNavigationSlot }
  | { kind: "loading"; placement: ExperimentalSidebarNavigationPlacement };

const lastResolvedSchema = z.object({
  key: z.string().min(1),
  placement: z.enum(["rail", "list"]),
});
export type LastResolvedSidebarNavigation = z.infer<typeof lastResolvedSchema>;

export function resolveSidebarNavigation({
  preference,
  slots,
  settled,
  lastResolved,
}: {
  preference: string;
  slots: readonly ExperimentalSidebarNavigationSlot[];
  settled: boolean;
  lastResolved: LastResolvedSidebarNavigation | null;
}): ResolvedSidebarNavigation {
  const builtIn = BUILT_IN_NAVIGATION_PROVIDERS.find(
    (provider) => provider.key === preference,
  );
  if (builtIn) return { kind: "built-in", provider: builtIn };
  const isAutomatic = preference === AUTOMATIC_REPLACEMENT_PROVIDER;
  const pinned = isAutomatic
    ? undefined
    : slots.find((slot) => replacementProviderKey(slot) === preference);
  if (pinned) return { kind: "plugin", slot: pinned };
  const automatic = slots[0];
  if (isAutomatic && automatic) return { kind: "plugin", slot: automatic };
  if (!settled) {
    const awaitedKey = isAutomatic ? lastResolved?.key : preference;
    const awaitsPlugin =
      awaitedKey !== undefined &&
      !BUILT_IN_NAVIGATION_PROVIDERS.some(
        (provider) => provider.key === awaitedKey,
      );
    if (awaitsPlugin) {
      return {
        kind: "loading",
        placement:
          lastResolved?.key === awaitedKey ? lastResolved.placement : "rail",
      };
    }
  }
  if (automatic) return { kind: "plugin", slot: automatic };
  return { kind: "built-in", provider: RAIL_NAVIGATION };
}

export function sidebarNavigationPlacement(
  resolved: ResolvedSidebarNavigation,
): ExperimentalSidebarNavigationPlacement {
  switch (resolved.kind) {
    case "built-in":
      return resolved.provider.placement;
    case "plugin":
      return resolved.slot.placement;
    case "loading":
      return resolved.placement;
  }
}

const lastKnownPreferenceCache = createLastKnownCache({
  prefix: "bb.sidebar-navigation-provider",
  version: "1",
  schema: z.string().min(1),
});
const LAST_KNOWN_PREFERENCE_KEY = lastKnownPreferenceCache.key();

export const sidebarNavigationProviderAtom = createSyncedPreferenceAtom(
  "sidebar.navigationProvider",
  {
    read: () => lastKnownPreferenceCache.read(LAST_KNOWN_PREFERENCE_KEY),
    write: (value) =>
      lastKnownPreferenceCache.write(LAST_KNOWN_PREFERENCE_KEY, value),
  },
);

const lastResolvedCache = createLastKnownCache({
  prefix: "bb.sidebar-navigation-resolved",
  version: "1",
  schema: lastResolvedSchema,
});
const LAST_RESOLVED_KEY = lastResolvedCache.key();

export function useResolvedSidebarNavigation(): ResolvedSidebarNavigation {
  const { experimentalSidebarNavigations } = usePluginSlots();
  const preference = useAtomValue(sidebarNavigationProviderAtom);
  const settled = usePluginFrontendsSettled();
  const [lastResolved] = useState(() =>
    lastResolvedCache.read(LAST_RESOLVED_KEY),
  );
  const resolved = resolveSidebarNavigation({
    preference,
    slots: experimentalSidebarNavigations,
    settled,
    lastResolved,
  });
  const resolvedKey =
    resolved.kind === "built-in"
      ? resolved.provider.key
      : resolved.kind === "plugin"
        ? replacementProviderKey(resolved.slot)
        : null;
  const placement = sidebarNavigationPlacement(resolved);
  useEffect(() => {
    if (resolvedKey === null) return;
    lastResolvedCache.write(LAST_RESOLVED_KEY, {
      key: resolvedKey,
      placement,
    });
  }, [placement, resolvedKey]);
  return resolved;
}

export function useSidebarNavigationPlacement(): ExperimentalSidebarNavigationPlacement {
  return sidebarNavigationPlacement(useResolvedSidebarNavigation());
}
