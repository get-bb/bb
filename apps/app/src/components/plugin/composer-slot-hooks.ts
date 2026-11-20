import { useMemo } from "react";
import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import {
  resolveComposerActions,
  resolveComposerPopups,
  resolveComposerBanners,
  resolveComposerDraftObservers,
  resolveComposerEditorEffects,
  resolveComposerPlusMenuItems,
  resolveComposerSendMenuItems,
} from "@/lib/plugin-slot-resolvers";
import {
  usePluginSlotKind,
  type PluginComposerCustomizationSlot,
} from "@/lib/plugin-slots";

type ComposerScopeKind = PluginComposerScope["kind"] | null;

type ComposerRegistrations = readonly PluginComposerCustomizationSlot[];

function useResolvedComposerSlot<T>(
  scopeKind: ComposerScopeKind,
  resolve: (
    registrations: ComposerRegistrations,
    kind: PluginComposerScope["kind"],
  ) => T,
  empty: () => T,
): T {
  const registrations = usePluginSlotKind("composerCustomizations");
  return useMemo(
    () => (scopeKind === null ? empty() : resolve(registrations, scopeKind)),
    [empty, registrations, resolve, scopeKind],
  );
}

const emptyList = () => [];

export function useResolvedComposerActions(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(scopeKind, resolveComposerActions, emptyList);
}

export function useResolvedComposerBanners(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(scopeKind, resolveComposerBanners, emptyList);
}

export function useResolvedComposerContributions(
  scopeKind: PluginComposerScope["kind"],
  mountsScopedContributions: boolean,
) {
  const registrations = usePluginSlotKind("composerCustomizations");
  return useMemo(
    () => ({
      plusMenuItems: resolveComposerPlusMenuItems(registrations, scopeKind),
      popups: resolveComposerPopups(registrations, scopeKind),
      sendMenuItems: mountsScopedContributions
        ? resolveComposerSendMenuItems(registrations, scopeKind)
        : [],
      effects: mountsScopedContributions
        ? resolveComposerEditorEffects(registrations, scopeKind)
        : [],
      observers: mountsScopedContributions
        ? resolveComposerDraftObservers(registrations, scopeKind)
        : [],
    }),
    [mountsScopedContributions, registrations, scopeKind],
  );
}
