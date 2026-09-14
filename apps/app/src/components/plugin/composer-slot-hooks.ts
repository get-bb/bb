import { useMemo, useSyncExternalStore } from "react";
import type { PluginComposerScope } from "@get-bb/plugin-sdk";
import {
  resolveComposerActions,
  resolveComposerBanners,
  resolveComposerDraftObservers,
  resolveComposerEditorEffects,
  resolveComposerPlusMenuItems,
} from "@/lib/plugin-slot-resolvers";
import {
  EMPTY_PLUGIN_SLOT_SNAPSHOT,
  getPluginSlotSnapshot,
  subscribePluginSlots,
  type PluginComposerCustomizationSlot,
} from "@/lib/plugin-slots";

type ComposerScopeKind = PluginComposerScope["kind"] | null;

type ComposerRegistrations = readonly PluginComposerCustomizationSlot[];

function useComposerCustomizationRegistrations(): ComposerRegistrations {
  return useSyncExternalStore(
    subscribePluginSlots,
    () => getPluginSlotSnapshot().composerCustomizations,
    () => EMPTY_PLUGIN_SLOT_SNAPSHOT.composerCustomizations,
  );
}

function useResolvedComposerSlot<T>(
  scopeKind: ComposerScopeKind,
  resolve: (
    registrations: ComposerRegistrations,
    kind: PluginComposerScope["kind"],
  ) => T,
  empty: () => T,
): T {
  const registrations = useComposerCustomizationRegistrations();
  return useMemo(
    () => (scopeKind === null ? empty() : resolve(registrations, scopeKind)),
    [empty, registrations, resolve, scopeKind],
  );
}

const emptyList = () => [];

function resolveComposerEditor(
  registrations: ComposerRegistrations,
  kind: PluginComposerScope["kind"],
) {
  return {
    effects: resolveComposerEditorEffects(registrations, kind),
    observers: resolveComposerDraftObservers(registrations, kind),
  };
}

const emptyComposerEditor = () => ({ effects: [], observers: [] });

export function useResolvedComposerActions(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(scopeKind, resolveComposerActions, emptyList);
}

export function useResolvedComposerBanners(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(scopeKind, resolveComposerBanners, emptyList);
}

export function useResolvedComposerPlusMenuItems(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(
    scopeKind,
    resolveComposerPlusMenuItems,
    emptyList,
  );
}

export function useResolvedComposerEditor(scopeKind: ComposerScopeKind) {
  return useResolvedComposerSlot(
    scopeKind,
    resolveComposerEditor,
    emptyComposerEditor,
  );
}
