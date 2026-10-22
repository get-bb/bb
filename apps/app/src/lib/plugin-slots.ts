import { setAppIcons } from "@bb/shared-ui/icon-registry";
import { useSyncExternalStore } from "react";
import type {
  ComposerCustomization,
  ExperimentalAppOverlayRegistration,
  ExperimentalCodeFenceRendererRegistration,
  PluginDiffRendererRegistration,
  ExperimentalComposerRegistration,
  PluginEnvironmentProviderInputsRegistration,
  PluginMachineProviderInputsRegistration,
  PluginPendingInteractionRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionRegistration,
  PluginMessageDirectiveRegistration,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  ExperimentalIconRegistration,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginSourceCodeRendererRegistration,
  PluginThreadHeaderActionRegistration,
  ExperimentalThreadInfoRowRegistration,
  ExperimentalThreadInfoSectionRegistration,
  PluginThreadActionRegistration,
  ExperimentalPluginBrowserToolbarActionRegistration,
  PluginThreadListRegistration,
  PluginThreadPanelActionRegistration,
  PluginTimelineRendererRegistration,
} from "@get-bb/plugin-sdk";
import {
  type CollectedPluginCommandRegistration,
  adaptSidebarFooterAction,
  getCollectedSidebarFooterItems,
  type CollectedPluginProviderIconRegistration,
  type CollectedExperimentalSidebarFooterItem,
  type CollectedManagedSidebarFooterItem,
  type CollectedSidebarFooterItem,
  type CollectedSidebarNavigationRegistration,
} from "@get-bb/plugin-sdk/internal/plugin-app-collector";

export interface PluginRegistrationSet {
  homepageSections: readonly PluginHomepageSectionRegistration[];
  settingsSections: readonly PluginSettingsSectionRegistration[];
  appOverlays?: readonly ExperimentalAppOverlayRegistration[];
  navPanels: readonly PluginNavPanelRegistration[];
  threadPanelActions: readonly PluginThreadPanelActionRegistration[];
  newThreadPanelActions?: readonly PluginNewThreadPanelActionRegistration[];
  composerCustomizations?: readonly ComposerCustomization[];
  pendingInteractions?: readonly PluginPendingInteractionRegistration[];
  sidebarFooterActions: readonly PluginSidebarFooterActionRegistration[];
  experimentalSidebarFooterItems?: readonly CollectedExperimentalSidebarFooterItem[];
  threadLists?: readonly PluginThreadListRegistration[];
  experimentalSidebarNavigations?: readonly CollectedSidebarNavigationRegistration[];
  threadHeaderActions?: readonly PluginThreadHeaderActionRegistration[];
  threadInfoRows?: readonly ExperimentalThreadInfoRowRegistration[];
  threadInfoSections?: readonly ExperimentalThreadInfoSectionRegistration[];
  threadActions?: readonly PluginThreadActionRegistration<unknown>[];
  browserToolbarActions?: readonly ExperimentalPluginBrowserToolbarActionRegistration[];
  fileOpeners: readonly PluginFileOpenerRegistration[];
  sourceCodeRenderers?: readonly PluginSourceCodeRendererRegistration[];
  diffRenderers?: readonly PluginDiffRendererRegistration[];
  composers?: readonly ExperimentalComposerRegistration[];
  messageDirectives: readonly PluginMessageDirectiveRegistration[];
  codeFenceRenderers?: readonly ExperimentalCodeFenceRendererRegistration[];
  messageActions?: readonly PluginMessageActionRegistration[];
  commandPaletteActions?: readonly CollectedPluginCommandRegistration[];
  providerIcons?: readonly CollectedPluginProviderIconRegistration[];
  icons?: readonly ExperimentalIconRegistration[];
  timelineRenderers?: readonly PluginTimelineRendererRegistration[];
  environmentProviderInputs?: readonly PluginEnvironmentProviderInputsRegistration[];
  machineProviderInputs?: readonly PluginMachineProviderInputsRegistration[];
}

interface PluginSlotBase {
  pluginId: string;
  generation: number;
}

export interface PluginHomepageSectionSlot
  extends PluginHomepageSectionRegistration, PluginSlotBase {}
export interface PluginSettingsSectionSlot
  extends PluginSettingsSectionRegistration, PluginSlotBase {}
export interface ExperimentalAppOverlaySlot
  extends ExperimentalAppOverlayRegistration, PluginSlotBase {}
export interface PluginNavPanelSlot
  extends PluginNavPanelRegistration, PluginSlotBase {}
export interface PluginThreadPanelActionSlot
  extends PluginThreadPanelActionRegistration, PluginSlotBase {}
export interface PluginNewThreadPanelActionSlot
  extends PluginNewThreadPanelActionRegistration, PluginSlotBase {}
export interface PluginComposerCustomizationSlot
  extends ComposerCustomization, PluginSlotBase {}
export interface PluginPendingInteractionSlot
  extends PluginPendingInteractionRegistration, PluginSlotBase {}
export type PluginSidebarFooterItemSlot = CollectedSidebarFooterItem &
  PluginSlotBase;
export interface PluginThreadListSlot
  extends PluginThreadListRegistration, PluginSlotBase {}
export interface ExperimentalSidebarNavigationSlot
  extends CollectedSidebarNavigationRegistration, PluginSlotBase {}
interface PluginThreadHeaderActionSlot
  extends PluginThreadHeaderActionRegistration, PluginSlotBase {}
export interface PluginThreadInfoRowSlot
  extends ExperimentalThreadInfoRowRegistration, PluginSlotBase {}
export interface PluginThreadInfoSectionSlot
  extends ExperimentalThreadInfoSectionRegistration, PluginSlotBase {}
export interface PluginThreadActionSlot
  extends PluginThreadActionRegistration<unknown>, PluginSlotBase {}
export interface PluginBrowserToolbarActionSlot
  extends ExperimentalPluginBrowserToolbarActionRegistration, PluginSlotBase {}
export interface PluginFileOpenerSlot
  extends PluginFileOpenerRegistration, PluginSlotBase {}
export interface PluginSourceCodeRendererSlot
  extends PluginSourceCodeRendererRegistration, PluginSlotBase {}
export interface PluginDiffRendererSlot
  extends PluginDiffRendererRegistration, PluginSlotBase {}
export interface PluginComposerSlot
  extends ExperimentalComposerRegistration, PluginSlotBase {}
export interface PluginMessageDirectiveSlot
  extends PluginMessageDirectiveRegistration, PluginSlotBase {}
export interface PluginCodeFenceRendererSlot
  extends ExperimentalCodeFenceRendererRegistration, PluginSlotBase {}
export interface PluginMessageActionSlot
  extends PluginMessageActionRegistration, PluginSlotBase {}
export type PluginCommandPaletteActionSlot =
  CollectedPluginCommandRegistration & PluginSlotBase;
interface PluginIconSlot extends ExperimentalIconRegistration, PluginSlotBase {}
interface PluginProviderIconSlot
  extends CollectedPluginProviderIconRegistration, PluginSlotBase {}
export interface PluginTimelineRendererSlot
  extends PluginTimelineRendererRegistration, PluginSlotBase {}
export interface PluginEnvironmentProviderInputsSlot
  extends PluginEnvironmentProviderInputsRegistration, PluginSlotBase {}
export interface PluginMachineProviderInputsSlot
  extends PluginMachineProviderInputsRegistration, PluginSlotBase {}

export interface PluginSlotSnapshot {
  homepageSections: readonly PluginHomepageSectionSlot[];
  settingsSections: readonly PluginSettingsSectionSlot[];
  appOverlays: readonly ExperimentalAppOverlaySlot[];
  navPanels: readonly PluginNavPanelSlot[];
  threadPanelActions: readonly PluginThreadPanelActionSlot[];
  newThreadPanelActions: readonly PluginNewThreadPanelActionSlot[];
  composerCustomizations: readonly PluginComposerCustomizationSlot[];
  pendingInteractions: readonly PluginPendingInteractionSlot[];
  sidebarFooterItems: readonly PluginSidebarFooterItemSlot[];
  threadLists: readonly PluginThreadListSlot[];
  experimentalSidebarNavigations: readonly ExperimentalSidebarNavigationSlot[];
  threadHeaderActions: readonly PluginThreadHeaderActionSlot[];
  threadInfoRows: readonly PluginThreadInfoRowSlot[];
  threadInfoSections: readonly PluginThreadInfoSectionSlot[];
  threadActions: readonly PluginThreadActionSlot[];
  browserToolbarActions: readonly PluginBrowserToolbarActionSlot[];
  fileOpeners: readonly PluginFileOpenerSlot[];
  sourceCodeRenderers: readonly PluginSourceCodeRendererSlot[];
  diffRenderers: readonly PluginDiffRendererSlot[];
  composers: readonly PluginComposerSlot[];
  messageDirectives: readonly PluginMessageDirectiveSlot[];
  codeFenceRenderers: readonly PluginCodeFenceRendererSlot[];
  messageActions: readonly PluginMessageActionSlot[];
  commandPaletteActions: readonly PluginCommandPaletteActionSlot[];
  providerIcons: readonly PluginProviderIconSlot[];
  icons: readonly PluginIconSlot[];
  timelineRenderers: readonly PluginTimelineRendererSlot[];
  environmentProviderInputs: readonly PluginEnvironmentProviderInputsSlot[];
  machineProviderInputs: readonly PluginMachineProviderInputsSlot[];
}

export const EMPTY_PLUGIN_SLOT_SNAPSHOT: PluginSlotSnapshot = {
  homepageSections: [],
  settingsSections: [],
  appOverlays: [],
  navPanels: [],
  threadPanelActions: [],
  newThreadPanelActions: [],
  composerCustomizations: [],
  pendingInteractions: [],
  sidebarFooterItems: [],
  threadLists: [],
  experimentalSidebarNavigations: [],
  threadHeaderActions: [],
  threadInfoRows: [],
  threadInfoSections: [],
  threadActions: [],
  browserToolbarActions: [],
  fileOpeners: [],
  sourceCodeRenderers: [],
  diffRenderers: [],
  composers: [],
  messageDirectives: [],
  codeFenceRenderers: [],
  messageActions: [],
  commandPaletteActions: [],
  providerIcons: [],
  icons: [],
  timelineRenderers: [],
  environmentProviderInputs: [],
  machineProviderInputs: [],
};

const registrationsByPluginId = new Map<string, PluginRegistrationSet>();
const generationByPluginId = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: PluginSlotSnapshot = EMPTY_PLUGIN_SLOT_SNAPSHOT;

type SlotKind = keyof PluginSlotSnapshot;

const SLOT_KINDS: readonly SlotKind[] = [
  "homepageSections",
  "settingsSections",
  "appOverlays",
  "navPanels",
  "threadPanelActions",
  "newThreadPanelActions",
  "composerCustomizations",
  "pendingInteractions",
  "sidebarFooterItems",
  "threadLists",
  "experimentalSidebarNavigations",
  "threadHeaderActions",
  "threadInfoRows",
  "threadInfoSections",
  "threadActions",
  "browserToolbarActions",
  "fileOpeners",
  "sourceCodeRenderers",
  "diffRenderers",
  "composers",
  "messageDirectives",
  "codeFenceRenderers",
  "messageActions",
  "commandPaletteActions",
  "providerIcons",
  "icons",
  "timelineRenderers",
  "environmentProviderInputs",
  "machineProviderInputs",
];

type FlattenedPluginSlots = {
  readonly [K in SlotKind]: PluginSlotSnapshot[K];
};

const flattenedByPluginId = new Map<string, FlattenedPluginSlots>();

function adaptExperimentalSidebarFooterItem(
  item: CollectedExperimentalSidebarFooterItem,
): CollectedManagedSidebarFooterItem {
  return { ...item, source: "experimental_sidebarFooter" };
}

function flattenRegistrations(
  pluginId: string,
  generation: number,
  set: PluginRegistrationSet,
): FlattenedPluginSlots {
  const stamp = <T extends object>(
    registrations: readonly T[] | undefined,
  ): readonly (T & PluginSlotBase)[] =>
    (registrations ?? []).map((registration) => ({
      ...registration,
      pluginId,
      generation,
    }));
  const sidebarFooterItems = getCollectedSidebarFooterItems(set) ?? [
    ...set.sidebarFooterActions.map(adaptSidebarFooterAction),
    ...(set.experimentalSidebarFooterItems ?? []).map(
      adaptExperimentalSidebarFooterItem,
    ),
  ];
  return {
    homepageSections: stamp(set.homepageSections),
    settingsSections: stamp(set.settingsSections),
    appOverlays: stamp(set.appOverlays),
    navPanels: stamp(set.navPanels),
    threadPanelActions: stamp(set.threadPanelActions),
    newThreadPanelActions: stamp(set.newThreadPanelActions),
    composerCustomizations: stamp(set.composerCustomizations),
    pendingInteractions: stamp(set.pendingInteractions),
    sidebarFooterItems: stamp<CollectedSidebarFooterItem>(sidebarFooterItems),
    threadLists: stamp(set.threadLists),
    experimentalSidebarNavigations: stamp(set.experimentalSidebarNavigations),
    threadHeaderActions: stamp(set.threadHeaderActions),
    threadInfoRows: stamp(set.threadInfoRows),
    threadInfoSections: stamp(set.threadInfoSections),
    threadActions: stamp(set.threadActions),
    browserToolbarActions: stamp(set.browserToolbarActions),
    fileOpeners: stamp(set.fileOpeners),
    sourceCodeRenderers: stamp(set.sourceCodeRenderers),
    diffRenderers: stamp(set.diffRenderers),
    composers: stamp(set.composers),
    messageDirectives: stamp(set.messageDirectives),
    codeFenceRenderers: stamp(set.codeFenceRenderers),
    messageActions: stamp(set.messageActions),
    commandPaletteActions: stamp(set.commandPaletteActions),
    providerIcons: stamp(set.providerIcons),
    icons: stamp(set.icons),
    timelineRenderers: stamp(set.timelineRenderers),
    environmentProviderInputs: stamp(set.environmentProviderInputs),
    machineProviderInputs: stamp(set.machineProviderInputs),
  };
}

function sameSlotSequence(
  previous: readonly unknown[],
  next: readonly unknown[],
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function collectKind<K extends SlotKind>(
  kind: K,
  pluginIds: readonly string[],
): PluginSlotSnapshot[K][number][] {
  const collected: PluginSlotSnapshot[K][number][] = [];
  for (const pluginId of pluginIds) {
    const flattened = flattenedByPluginId.get(pluginId);
    if (flattened === undefined) continue;
    for (const slot of flattened[kind]) collected.push(slot);
  }
  return collected;
}

function collectProviderIcons(
  pluginIds: readonly string[],
): PluginProviderIconSlot[] {
  const collected: PluginProviderIconSlot[] = [];
  for (const pluginId of pluginIds) {
    const flattened = flattenedByPluginId.get(pluginId);
    if (flattened === undefined) continue;
    for (const slot of flattened.providerIcons) {
      const claimed = collected.find(
        (existing) =>
          existing.providerKind === slot.providerKind &&
          existing.providerId === slot.providerId,
      );
      if (claimed !== undefined) {
        console.warn(
          `plugin ${pluginId}: provider icon for "${slot.providerId}" ignored — already registered by plugin ${claimed.pluginId}`,
        );
        continue;
      }
      collected.push(slot);
    }
  }
  return collected;
}

function collectTimelineRenderers(
  pluginIds: readonly string[],
): PluginTimelineRendererSlot[] {
  const collected: PluginTimelineRendererSlot[] = [];
  for (const pluginId of pluginIds) {
    const flattened = flattenedByPluginId.get(pluginId);
    if (flattened === undefined) continue;
    for (const slot of flattened.timelineRenderers) {
      if (slot.kind !== "tool" && !slot.kind.startsWith(`${pluginId}/`)) {
        console.warn(
          `plugin ${pluginId}: timeline renderer for "${slot.kind}" ignored — a plugin renders only its own extension kinds ("${pluginId}/<name>") and "tool"`,
        );
        continue;
      }
      collected.push(slot);
    }
  }
  return collected;
}

function buildSnapshot(previous: PluginSlotSnapshot): PluginSlotSnapshot {
  const pluginIds = [...registrationsByPluginId.keys()].sort();
  const next: { -readonly [K in SlotKind]: PluginSlotSnapshot[K] } = {
    ...previous,
  };
  let changed = false;
  for (const kind of SLOT_KINDS) {
    const collected =
      kind === "providerIcons"
        ? collectProviderIcons(pluginIds)
        : kind === "timelineRenderers"
          ? collectTimelineRenderers(pluginIds)
          : collectKind(kind, pluginIds);
    if (sameSlotSequence(previous[kind], collected)) continue;
    changed = true;
    Object.assign(next, { [kind]: collected });
  }
  return changed ? next : previous;
}

let appliedIcons: PluginSlotSnapshot["icons"] = [];
let openBatchDepth = 0;
let batchMaxHoldMs = 0;
let snapshotStale = false;
let notifyPending = false;
let batchFlushTimer: ReturnType<typeof setTimeout> | null = null;

function rebuildIfStale(): void {
  if (!snapshotStale) return;
  snapshotStale = false;
  const previous = snapshot;
  snapshot = buildSnapshot(previous);
  if (snapshot !== previous) notifyPending = true;
}

function flushChange(): void {
  if (batchFlushTimer !== null) {
    clearTimeout(batchFlushTimer);
    batchFlushTimer = null;
  }
  rebuildIfStale();
  if (snapshot.icons !== appliedIcons) {
    appliedIcons = snapshot.icons;
    const icons = new Map<string, PluginIconSlot>();
    for (const icon of snapshot.icons) {
      const previousIcon = icons.get(icon.name);
      if (previousIcon !== undefined) {
        console.warn(
          `plugin ${icon.pluginId}: icon "${icon.name}" ignored; already registered by plugin ${previousIcon.pluginId}`,
        );
      } else {
        icons.set(icon.name, icon);
      }
    }
    setAppIcons(
      new Map(
        [...icons].map(([name, icon]) => [
          name,
          {
            component: icon.component,
            key: `${icon.pluginId}:${icon.generation}:${name}`,
          },
        ]),
      ),
    );
  }
  if (!notifyPending) return;
  notifyPending = false;
  for (const listener of listeners) listener();
}

function emitChange(): void {
  snapshotStale = true;
  if (openBatchDepth === 0) {
    flushChange();
    return;
  }
  if (batchFlushTimer !== null) return;
  batchFlushTimer = setTimeout(() => {
    batchFlushTimer = null;
    flushChange();
  }, batchMaxHoldMs);
}

export function beginPluginSlotBatch(options: {
  maxHoldMs: number;
}): () => void {
  openBatchDepth += 1;
  batchMaxHoldMs =
    openBatchDepth === 1
      ? options.maxHoldMs
      : Math.min(batchMaxHoldMs, options.maxHoldMs);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    openBatchDepth = Math.max(0, openBatchDepth - 1);
    if (openBatchDepth === 0) flushChange();
  };
}

export function setPluginSlotRegistrations(
  pluginId: string,
  registrations: PluginRegistrationSet,
): void {
  registrationsByPluginId.set(pluginId, registrations);
  const generation = (generationByPluginId.get(pluginId) ?? 0) + 1;
  generationByPluginId.set(pluginId, generation);
  flattenedByPluginId.set(
    pluginId,
    flattenRegistrations(pluginId, generation, registrations),
  );
  emitChange();
}

export function removePluginSlotRegistrations(pluginId: string): void {
  if (!registrationsByPluginId.delete(pluginId)) return;
  flattenedByPluginId.delete(pluginId);
  emitChange();
}

export function subscribePluginSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPluginSlotSnapshot(): PluginSlotSnapshot {
  rebuildIfStale();
  return snapshot;
}

export function usePluginSlots(): PluginSlotSnapshot {
  return useSyncExternalStore(subscribePluginSlots, getPluginSlotSnapshot);
}

let builtinPluginIds: ReadonlySet<string> = new Set();
const builtinPluginIdListeners = new Set<() => void>();

export function setBuiltinPluginIds(ids: Iterable<string>): void {
  const next = new Set(ids);
  if (
    next.size === builtinPluginIds.size &&
    [...next].every((id) => builtinPluginIds.has(id))
  ) {
    return;
  }
  builtinPluginIds = next;
  for (const listener of builtinPluginIdListeners) listener();
}

function subscribeBuiltinPluginIds(listener: () => void): () => void {
  builtinPluginIdListeners.add(listener);
  return () => {
    builtinPluginIdListeners.delete(listener);
  };
}

export function useBuiltinPluginIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribeBuiltinPluginIds,
    () => builtinPluginIds,
  );
}

export function resetPluginSlotStoreForTest(): void {
  setBuiltinPluginIds([]);
  registrationsByPluginId.clear();
  generationByPluginId.clear();
  flattenedByPluginId.clear();
  openBatchDepth = 0;
  emitChange();
}
