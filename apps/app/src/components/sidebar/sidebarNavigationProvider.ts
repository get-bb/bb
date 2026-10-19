import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import type { ExperimentalSidebarNavigationPlacement } from "@get-bb/plugin-sdk";
import { createLastKnownCache } from "@/lib/last-known-cache";
import { usePluginFrontendsSettled } from "@/lib/plugin-frontend-boot-state";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  findAutomaticReplacement,
  replacementProviderKey,
} from "@/lib/plugin-replacement-preference";
import {
  useBuiltinPluginIds,
  usePluginSlots,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

export type ResolvedSidebarNavigation =
  | {
      kind: "plugin";
      slot: ExperimentalSidebarNavigationSlot;
      fallback: ExperimentalSidebarNavigationSlot | null;
    }
  | { kind: "loading"; placement: ExperimentalSidebarNavigationPlacement }
  | { kind: "missing" };

const lastResolvedSchema = z.object({
  key: z.string().min(1),
  placement: z.enum(["rail", "list"]),
});
export type LastResolvedSidebarNavigation = z.infer<typeof lastResolvedSchema>;

function resolvedPlugin(
  slot: ExperimentalSidebarNavigationSlot,
  slots: readonly ExperimentalSidebarNavigationSlot[],
  builtinPluginIds: ReadonlySet<string>,
): ResolvedSidebarNavigation {
  const fallback = builtinPluginIds.has(slot.pluginId)
    ? undefined
    : slots.find(
        (candidate) =>
          builtinPluginIds.has(candidate.pluginId) &&
          candidate.placement === slot.placement,
      );
  return { kind: "plugin", slot, fallback: fallback ?? null };
}

export function resolveSidebarNavigation({
  preference,
  slots,
  builtinPluginIds,
  settled,
  lastResolved,
}: {
  preference: string;
  slots: readonly ExperimentalSidebarNavigationSlot[];
  builtinPluginIds: ReadonlySet<string>;
  settled: boolean;
  lastResolved: LastResolvedSidebarNavigation | null;
}): ResolvedSidebarNavigation {
  const isAutomatic = preference === AUTOMATIC_REPLACEMENT_PROVIDER;
  const pinned = isAutomatic
    ? undefined
    : slots.find((slot) => replacementProviderKey(slot) === preference);
  if (pinned) return resolvedPlugin(pinned, slots, builtinPluginIds);
  const automatic = findAutomaticReplacement(slots, builtinPluginIds);
  if (!settled) {
    const awaitedKey = isAutomatic ? lastResolved?.key : preference;
    if (
      awaitedKey !== undefined &&
      (automatic === undefined ||
        replacementProviderKey(automatic) !== awaitedKey)
    ) {
      return {
        kind: "loading",
        placement:
          lastResolved?.key === awaitedKey ? lastResolved.placement : "rail",
      };
    }
  }
  if (automatic) return resolvedPlugin(automatic, slots, builtinPluginIds);
  if (!settled) {
    return { kind: "loading", placement: lastResolved?.placement ?? "rail" };
  }
  return { kind: "missing" };
}

export function sidebarNavigationPlacement(
  resolved: ResolvedSidebarNavigation,
): ExperimentalSidebarNavigationPlacement {
  switch (resolved.kind) {
    case "plugin":
      return resolved.slot.placement;
    case "loading":
      return resolved.placement;
    case "missing":
      return "list";
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
  const builtinPluginIds = useBuiltinPluginIds();
  const resolved = resolveSidebarNavigation({
    preference,
    slots: experimentalSidebarNavigations,
    builtinPluginIds,
    settled,
    lastResolved,
  });
  const resolvedKey =
    resolved.kind === "plugin" ? replacementProviderKey(resolved.slot) : null;
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
