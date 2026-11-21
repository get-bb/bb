import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import type { ExperimentalSidebarNavigationPlacement } from "@get-bb/plugin-sdk";
import { createLastKnownCache } from "@/lib/last-known-cache";
import {
  usePluginFrontendLoadFailed,
  usePluginFrontendsSettled,
  usePluginFrontendsSettledOnce,
} from "@/lib/plugin-frontend-boot-state";
import {
  AUTOMATIC_REPLACEMENT_PROVIDER,
  createPickPreferenceAtom,
  PLUGIN_ONLY_RULE,
  replacementProviderKey,
  resolveExclusive,
} from "@/lib/plugin-replacement-preference";
import {
  useBbPluginIds,
  usePluginSlotKind,
  type ExperimentalSidebarNavigationSlot,
} from "@/lib/plugin-slots";
import { useRememberSurfaceProvider } from "@/lib/plugin-surface-providers";

export type ResolvedSidebarNavigation =
  | {
      kind: "plugin";
      slot: ExperimentalSidebarNavigationSlot;
      fallback: ExperimentalSidebarNavigationSlot | null;
    }
  | { kind: "loading"; placement: ExperimentalSidebarNavigationPlacement }
  | { kind: "failed" }
  | { kind: "missing" };

const lastResolvedSchema = z.object({
  key: z.string().min(1),
  placement: z.enum(["rail", "list"]),
});
export type LastResolvedSidebarNavigation = z.infer<typeof lastResolvedSchema>;

function resolvedPlugin(
  slot: ExperimentalSidebarNavigationSlot,
  slots: readonly ExperimentalSidebarNavigationSlot[],
  bbPluginIds: ReadonlySet<string>,
): ResolvedSidebarNavigation {
  const fallback = bbPluginIds.has(slot.pluginId)
    ? undefined
    : slots.find(
        (candidate) =>
          bbPluginIds.has(candidate.pluginId) &&
          candidate.placement === slot.placement,
      );
  return { kind: "plugin", slot, fallback: fallback ?? null };
}

export function resolveSidebarNavigation({
  preference,
  slots,
  bbPluginIds,
  settled,
  settledOnce,
  loadFailed,
  lastResolved,
}: {
  preference: string;
  slots: readonly ExperimentalSidebarNavigationSlot[];
  bbPluginIds: ReadonlySet<string>;
  settled: boolean;
  settledOnce: boolean;
  loadFailed: boolean;
  lastResolved: LastResolvedSidebarNavigation | null;
}): ResolvedSidebarNavigation {
  const resolved = resolveExclusive({
    claimants: slots,
    pick: preference,
    bbPluginIds,
    settledOnce,
    settled,
    rememberedAutomatic: lastResolved?.key ?? null,
    rule: PLUGIN_ONLY_RULE,
  });
  switch (resolved.kind) {
    case "plugin":
      return resolvedPlugin(resolved.registration, slots, bbPluginIds);
    case "loading": {
      const awaitedKey =
        preference === AUTOMATIC_REPLACEMENT_PROVIDER
          ? lastResolved?.key
          : preference;
      return {
        kind: "loading",
        placement:
          lastResolved !== null && lastResolved.key === awaitedKey
            ? lastResolved.placement
            : "rail",
      };
    }
    case "builtin":
    case "contested":
      if (!settled) {
        return {
          kind: "loading",
          placement: lastResolved?.placement ?? "rail",
        };
      }
      return loadFailed ? { kind: "failed" } : { kind: "missing" };
  }
}

export function sidebarNavigationPlacement(
  resolved: ResolvedSidebarNavigation,
): ExperimentalSidebarNavigationPlacement {
  switch (resolved.kind) {
    case "plugin":
      return resolved.slot.placement;
    case "loading":
      return resolved.placement;
    case "failed":
    case "missing":
      return "list";
  }
}

export const sidebarNavigationProviderAtom = createPickPreferenceAtom(
  "sidebar.navigationProvider",
  { cachePrefix: "bb.sidebar-navigation-provider" },
);

const lastResolvedCache = createLastKnownCache({
  prefix: "bb.sidebar-navigation-resolved",
  version: "1",
  schema: lastResolvedSchema,
});
const LAST_RESOLVED_KEY = lastResolvedCache.key();

export function useResolvedSidebarNavigation(): ResolvedSidebarNavigation {
  const experimentalSidebarNavigations = usePluginSlotKind(
    "experimentalSidebarNavigations",
  );
  const preference = useAtomValue(sidebarNavigationProviderAtom);
  const settled = usePluginFrontendsSettled();
  const settledOnce = usePluginFrontendsSettledOnce();
  const loadFailed = usePluginFrontendLoadFailed();
  const [lastResolved] = useState(() =>
    lastResolvedCache.read(LAST_RESOLVED_KEY),
  );
  const bbPluginIds = useBbPluginIds();
  const resolved = resolveSidebarNavigation({
    preference,
    slots: experimentalSidebarNavigations,
    bbPluginIds,
    settled,
    settledOnce,
    loadFailed,
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
  useRememberSurfaceProvider(
    "sidebar-navigation",
    resolved.kind === "plugin" ? resolved.slot.pluginId : null,
  );
  return resolved;
}

export function useSidebarNavigationPlacement(): ExperimentalSidebarNavigationPlacement {
  return sidebarNavigationPlacement(useResolvedSidebarNavigation());
}
