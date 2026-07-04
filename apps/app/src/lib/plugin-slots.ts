import { useSyncExternalStore } from "react";
import type {
  PluginComposerAccessoryRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginNavPanelRegistration,
  PluginThreadPanelActionRegistration,
} from "@bb/plugin-sdk";

/**
 * Client-side slot store (plugin design §5.2): the interpreted `app.slots.*`
 * registrations of every loaded plugin frontend, keyed by plugin id and
 * replaced wholesale per plugin — never appended, so re-interpreting a
 * plugin after reload (P3.4) can never duplicate its sections. Mount sites
 * subscribe through {@link usePluginSlots}.
 */

export interface PluginRegistrationSet {
  homepageSections: readonly PluginHomepageSectionRegistration[];
  navPanels: readonly PluginNavPanelRegistration[];
  threadPanelActions: readonly PluginThreadPanelActionRegistration[];
  composerAccessories: readonly PluginComposerAccessoryRegistration[];
  fileOpeners: readonly PluginFileOpenerRegistration[];
}

interface PluginSlotBase {
  pluginId: string;
  /**
   * Bumped every time the plugin's registrations are replaced. Mount sites
   * fold it into React keys so a reload (P3.4) remounts slot components —
   * fresh error-boundary state after resetCrashedPluginSlots — instead of
   * reusing a boundary that latched a crash from the previous bundle.
   */
  generation: number;
}

export interface PluginHomepageSectionSlot
  extends PluginHomepageSectionRegistration, PluginSlotBase {}
export interface PluginNavPanelSlot
  extends PluginNavPanelRegistration, PluginSlotBase {}
export interface PluginThreadPanelActionSlot
  extends PluginThreadPanelActionRegistration, PluginSlotBase {}
export interface PluginComposerAccessorySlot
  extends PluginComposerAccessoryRegistration, PluginSlotBase {}
export interface PluginFileOpenerSlot
  extends PluginFileOpenerRegistration, PluginSlotBase {}

/** Flattened view across plugins, ordered by plugin id (deterministic). */
export interface PluginSlotSnapshot {
  homepageSections: readonly PluginHomepageSectionSlot[];
  navPanels: readonly PluginNavPanelSlot[];
  threadPanelActions: readonly PluginThreadPanelActionSlot[];
  composerAccessories: readonly PluginComposerAccessorySlot[];
  fileOpeners: readonly PluginFileOpenerSlot[];
}

export const EMPTY_PLUGIN_SLOT_SNAPSHOT: PluginSlotSnapshot = {
  homepageSections: [],
  navPanels: [],
  threadPanelActions: [],
  composerAccessories: [],
  fileOpeners: [],
};

const registrationsByPluginId = new Map<string, PluginRegistrationSet>();
const generationByPluginId = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: PluginSlotSnapshot = EMPTY_PLUGIN_SLOT_SNAPSHOT;

function buildSnapshot(): PluginSlotSnapshot {
  const pluginIds = [...registrationsByPluginId.keys()].sort();
  const next: {
    homepageSections: PluginHomepageSectionSlot[];
    navPanels: PluginNavPanelSlot[];
    threadPanelActions: PluginThreadPanelActionSlot[];
    composerAccessories: PluginComposerAccessorySlot[];
    fileOpeners: PluginFileOpenerSlot[];
  } = {
    homepageSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    fileOpeners: [],
  };
  for (const pluginId of pluginIds) {
    const set = registrationsByPluginId.get(pluginId);
    if (set === undefined) continue;
    const generation = generationByPluginId.get(pluginId) ?? 0;
    for (const registration of set.homepageSections) {
      next.homepageSections.push({ ...registration, pluginId, generation });
    }
    for (const registration of set.navPanels) {
      next.navPanels.push({ ...registration, pluginId, generation });
    }
    for (const registration of set.threadPanelActions) {
      next.threadPanelActions.push({ ...registration, pluginId, generation });
    }
    for (const registration of set.composerAccessories) {
      next.composerAccessories.push({ ...registration, pluginId, generation });
    }
    for (const registration of set.fileOpeners) {
      next.fileOpeners.push({ ...registration, pluginId, generation });
    }
  }
  return next;
}

function emitChange(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

/** Replace one plugin's registrations wholesale (P3.4 reload reuses this). */
export function setPluginSlotRegistrations(
  pluginId: string,
  registrations: PluginRegistrationSet,
): void {
  registrationsByPluginId.set(pluginId, registrations);
  generationByPluginId.set(
    pluginId,
    (generationByPluginId.get(pluginId) ?? 0) + 1,
  );
  emitChange();
}

/** Drop one plugin's registrations (uninstall/disable/failed re-interpret). */
export function removePluginSlotRegistrations(pluginId: string): void {
  if (!registrationsByPluginId.delete(pluginId)) return;
  emitChange();
}

export function subscribePluginSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginSlotSnapshot(): PluginSlotSnapshot {
  return snapshot;
}

/** All plugin slot registrations, re-rendering on store changes. */
export function usePluginSlots(): PluginSlotSnapshot {
  return useSyncExternalStore(subscribePluginSlots, getPluginSlotSnapshot);
}

/** Test-only: reset the store to empty without notifying semantics quirks. */
export function resetPluginSlotStoreForTest(): void {
  registrationsByPluginId.clear();
  generationByPluginId.clear();
  emitChange();
}
