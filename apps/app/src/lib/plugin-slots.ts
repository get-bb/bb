import { useSyncExternalStore } from "react";
import type {
  ComposerCustomization,
  PluginPendingInteractionRegistration,
  PluginFileOpenerRegistration,
  PluginHomepageSectionRegistration,
  PluginMessageActionRegistration,
  PluginMessageDirectiveRegistration,
  PluginNavPanelRegistration,
  PluginNewThreadPanelActionRegistration,
  PluginProviderIconRegistration,
  PluginSettingsSectionRegistration,
  PluginSidebarFooterActionRegistration,
  PluginThreadHeaderActionRegistration,
  PluginThreadListRegistration,
  PluginThreadPanelActionRegistration,
} from "@get-bb/plugin-sdk";

/**
 * Client-side slot store (plugin design §5.2): the interpreted `app.slots.*`
 * registrations of every loaded plugin frontend, keyed by plugin id and
 * replaced wholesale per plugin — never appended, so re-interpreting a
 * plugin after reload (P3.4) can never duplicate its sections. Mount sites
 * subscribe through {@link usePluginSlots}.
 */

export interface PluginRegistrationSet {
  homepageSections: readonly PluginHomepageSectionRegistration[];
  settingsSections: readonly PluginSettingsSectionRegistration[];
  navPanels: readonly PluginNavPanelRegistration[];
  threadPanelActions: readonly PluginThreadPanelActionRegistration[];
  /** Optional for bundles built before this experimental slot existed. */
  newThreadPanelActions?: readonly PluginNewThreadPanelActionRegistration[];
  composerCustomizations?: readonly ComposerCustomization[];
  pendingInteractions?: readonly PluginPendingInteractionRegistration[];
  sidebarFooterActions: readonly PluginSidebarFooterActionRegistration[];
  /**
   * Optional so a frontend bundle built against an older SDK — which never
   * calls `experimental_threadList` — still satisfies the set.
   */
  threadLists?: readonly PluginThreadListRegistration[];
  /** Optional for the same reason as `threadLists`: bundles built earlier. */
  threadHeaderActions?: readonly PluginThreadHeaderActionRegistration[];
  fileOpeners: readonly PluginFileOpenerRegistration[];
  messageDirectives: readonly PluginMessageDirectiveRegistration[];
  messageActions?: readonly PluginMessageActionRegistration[];
  /** Optional for the same reason as `threadLists`: bundles built earlier. */
  providerIcons?: readonly PluginProviderIconRegistration[];
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
export interface PluginSettingsSectionSlot
  extends PluginSettingsSectionRegistration, PluginSlotBase {}
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
export interface PluginSidebarFooterActionSlot
  extends PluginSidebarFooterActionRegistration, PluginSlotBase {}
export interface PluginThreadListSlot
  extends PluginThreadListRegistration, PluginSlotBase {}
export interface PluginThreadHeaderActionSlot
  extends PluginThreadHeaderActionRegistration, PluginSlotBase {}
export interface PluginFileOpenerSlot
  extends PluginFileOpenerRegistration, PluginSlotBase {}
export interface PluginMessageDirectiveSlot
  extends PluginMessageDirectiveRegistration, PluginSlotBase {}
export interface PluginMessageActionSlot
  extends PluginMessageActionRegistration, PluginSlotBase {}
export interface PluginProviderIconSlot
  extends PluginProviderIconRegistration, PluginSlotBase {}

/** Flattened view across plugins, ordered by plugin id (deterministic). */
export interface PluginSlotSnapshot {
  homepageSections: readonly PluginHomepageSectionSlot[];
  settingsSections: readonly PluginSettingsSectionSlot[];
  navPanels: readonly PluginNavPanelSlot[];
  threadPanelActions: readonly PluginThreadPanelActionSlot[];
  newThreadPanelActions: readonly PluginNewThreadPanelActionSlot[];
  composerCustomizations: readonly PluginComposerCustomizationSlot[];
  pendingInteractions: readonly PluginPendingInteractionSlot[];
  sidebarFooterActions: readonly PluginSidebarFooterActionSlot[];
  threadLists: readonly PluginThreadListSlot[];
  threadHeaderActions: readonly PluginThreadHeaderActionSlot[];
  fileOpeners: readonly PluginFileOpenerSlot[];
  messageDirectives: readonly PluginMessageDirectiveSlot[];
  messageActions: readonly PluginMessageActionSlot[];
  providerIcons: readonly PluginProviderIconSlot[];
}

export const EMPTY_PLUGIN_SLOT_SNAPSHOT: PluginSlotSnapshot = {
  homepageSections: [],
  settingsSections: [],
  navPanels: [],
  threadPanelActions: [],
  newThreadPanelActions: [],
  composerCustomizations: [],
  pendingInteractions: [],
  sidebarFooterActions: [],
  threadLists: [],
  threadHeaderActions: [],
  fileOpeners: [],
  messageDirectives: [],
  messageActions: [],
  providerIcons: [],
};

const registrationsByPluginId = new Map<string, PluginRegistrationSet>();
const generationByPluginId = new Map<string, number>();
const listeners = new Set<() => void>();
let snapshot: PluginSlotSnapshot = EMPTY_PLUGIN_SLOT_SNAPSHOT;

type SlotKind = keyof PluginSlotSnapshot;

const SLOT_KINDS: readonly SlotKind[] = [
  "homepageSections",
  "settingsSections",
  "navPanels",
  "threadPanelActions",
  "newThreadPanelActions",
  "composerCustomizations",
  "pendingInteractions",
  "sidebarFooterActions",
  "threadLists",
  "threadHeaderActions",
  "fileOpeners",
  "messageDirectives",
  "messageActions",
  "providerIcons",
];

/**
 * One plugin's registrations flattened into slot objects (`pluginId` +
 * `generation` baked in). Built once per `setPluginSlotRegistrations` call, so
 * slot objects keep their identity across later snapshot rebuilds. That is
 * what lets {@link buildSnapshot} hand back the previous per-kind array when
 * a different plugin's registrations change: consumers keyed on one kind
 * (`messageDirectives` -> markdown directive registry, `messageActions` ->
 * timeline static context) only re-render when their own kind changed.
 */
type FlattenedPluginSlots = {
  readonly [K in SlotKind]: PluginSlotSnapshot[K];
};

const flattenedByPluginId = new Map<string, FlattenedPluginSlots>();

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
  return {
    homepageSections: stamp(set.homepageSections),
    settingsSections: stamp(set.settingsSections),
    navPanels: stamp(set.navPanels),
    threadPanelActions: stamp(set.threadPanelActions),
    newThreadPanelActions: stamp(set.newThreadPanelActions),
    composerCustomizations: stamp(set.composerCustomizations),
    pendingInteractions: stamp(set.pendingInteractions),
    sidebarFooterActions: stamp(set.sidebarFooterActions),
    threadLists: stamp(set.threadLists),
    threadHeaderActions: stamp(set.threadHeaderActions),
    fileOpeners: stamp(set.fileOpeners),
    messageDirectives: stamp(set.messageDirectives),
    messageActions: stamp(set.messageActions),
    providerIcons: stamp(set.providerIcons),
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
        (existing) => existing.providerId === slot.providerId,
      );
      if (claimed !== undefined) {
        // Provider ids are a shared namespace: nothing stops a second plugin
        // from claiming an id it does not own. Plugin ids are iterated in
        // sorted order, so keeping the first claim makes the winner stable
        // across reloads instead of depending on load timing.
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

/**
 * Rebuild the flattened snapshot with per-kind structural sharing: a kind
 * whose slot sequence equals the previous snapshot's keeps the previous
 * array, and a rebuild that changes no kind returns the previous snapshot
 * object so `useSyncExternalStore` readers bail out entirely.
 */
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
        : collectKind(kind, pluginIds);
    if (sameSlotSequence(previous[kind], collected)) continue;
    changed = true;
    // `collected` came from `collectKind(kind)`, so it has the element type
    // of `next[kind]`; the loop variable erases that correlation for TS.
    Object.assign(next, { [kind]: collected });
  }
  return changed ? next : previous;
}

/**
 * Open batches hold listener notifications so a burst of registrations (every
 * plugin bundle resolving during boot, a multi-plugin reload) turns into a
 * few flushes instead of one app-wide re-render per plugin. Reads stay
 * consistent while a batch is open: the snapshot is rebuilt lazily on the
 * next `getPluginSlotSnapshot`. Batches nest (depth count).
 */
let openBatchDepth = 0;
let batchMaxHoldMs = 0;
/** Registrations changed since `snapshot` was last built. */
let snapshotStale = false;
/** `snapshot` changed since listeners were last notified. */
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
  // Bound the hold: a slow plugin bundle must not keep every other plugin's
  // UI off screen for the whole batch.
  batchFlushTimer = setTimeout(() => {
    batchFlushTimer = null;
    flushChange();
  }, batchMaxHoldMs);
}

/**
 * Hold notifications until the returned closer runs, or until `maxHoldMs`
 * passes since the first held change (whichever comes first, repeatedly).
 * The closer is idempotent.
 */
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
    // Never below zero: a test reset can zero the depth under an open batch.
    openBatchDepth = Math.max(0, openBatchDepth - 1);
    if (openBatchDepth === 0) flushChange();
  };
}

/** Replace one plugin's registrations wholesale (P3.4 reload reuses this). */
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

/** Drop one plugin's registrations (uninstall/disable/failed re-interpret). */
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
  // A read inside an open batch must not observe stale registrations: the
  // batch defers the notification, not the data.
  rebuildIfStale();
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
  flattenedByPluginId.clear();
  openBatchDepth = 0;
  emitChange();
}
