import { atom, getDefaultStore, type PrimitiveAtom } from "jotai";

type PreferencesStore = ReturnType<typeof getDefaultStore>;
import {
  defaultPreferences,
  getPreferenceDefault,
  parsePreferenceValue,
  PREFERENCE_KEYS,
  preferencesChangedSignalSchema,
  type PreferenceKey,
  type PreferenceValue,
  type PreferenceValues,
} from "../../shared/preferences.js";

export const PREFERENCES_MIRROR_STORAGE_KEY = "bb.thread-list.preferences.v1";
const WRITE_DEBOUNCE_MS = 150;

export interface PreferencesRpc {
  call(method: "listPreferences", input: null): Promise<unknown>;
  call(
    method: "setPreference",
    input: { key: PreferenceKey; value: unknown },
  ): Promise<unknown>;
}

interface SyncState {
  valueAtoms: Map<PreferenceKey, PrimitiveAtom<unknown>>;
  readyAtom: PrimitiveAtom<boolean>;
  pendingWrites: Map<
    PreferenceKey,
    { timer: number | null; inFlight: boolean; value: unknown }
  >;
  rpc: PreferencesRpc | null;
  store: PreferencesStore | null;
  hydrateGeneration: number;
}

function createSyncState(): SyncState {
  return {
    valueAtoms: new Map(),
    readyAtom: atom(false),
    pendingWrites: new Map(),
    rpc: null,
    store: null,
    hydrateGeneration: 0,
  };
}

const state = createSyncState();

function activeStore(): PreferencesStore {
  return state.store ?? getDefaultStore();
}

export function attachPreferencesStore(store: PreferencesStore): void {
  state.store = store;
}

function valueAtomFor<Key extends PreferenceKey>(
  key: Key,
): PrimitiveAtom<PreferenceValue<Key>> {
  let existing = state.valueAtoms.get(key);
  if (existing === undefined) {
    existing = atom<unknown>(getPreferenceDefault(key));
    state.valueAtoms.set(key, existing);
  }
  return existing as PrimitiveAtom<PreferenceValue<Key>>;
}

export function preferenceValueAtom<Key extends PreferenceKey>(
  key: Key,
): PrimitiveAtom<PreferenceValue<Key>> {
  return valueAtomFor(key);
}

export function preferencesReadyAtom(): PrimitiveAtom<boolean> {
  return state.readyAtom;
}

function readMirror(storage: Storage | null): Partial<PreferenceValues> | null {
  if (storage === null) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(PREFERENCES_MIRROR_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const values: Partial<PreferenceValues> = {};
  for (const key of PREFERENCE_KEYS) {
    const candidate = (parsed as Record<string, unknown>)[key];
    if (candidate === undefined) continue;
    const result = parsePreferenceValue(key, candidate);
    if (result.success) {
      (values as Record<PreferenceKey, unknown>)[key] = result.value;
    }
  }
  return values;
}

function writeMirror(storage: Storage | null): void {
  if (storage === null) return;
  const store = activeStore();
  const snapshot: Record<string, unknown> = {};
  for (const key of PREFERENCE_KEYS) {
    snapshot[key] = store.get(valueAtomFor(key));
  }
  try {
    storage.setItem(PREFERENCES_MIRROR_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    return;
  }
}

let mirrorStorageOverride: Storage | null | undefined;

function mirrorStorage(): Storage | null {
  if (mirrorStorageOverride !== undefined) return mirrorStorageOverride;
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

export function setPreferencesMirrorStorageForTest(
  storage: Storage | null | undefined,
): void {
  mirrorStorageOverride = storage;
}

function applyValues(values: Partial<PreferenceValues>): void {
  const store = activeStore();
  for (const key of PREFERENCE_KEYS) {
    const value = values[key];
    if (value === undefined) continue;
    if (state.pendingWrites.has(key)) continue;
    store.set(valueAtomFor(key), value);
  }
}

export function hydratePreferencesFromMirror(): boolean {
  const mirrored = readMirror(mirrorStorage());
  if (mirrored === null) return false;
  applyValues(mirrored);
  return true;
}

export async function hydratePreferences(rpc: PreferencesRpc): Promise<void> {
  state.rpc = rpc;
  const generation = ++state.hydrateGeneration;
  const response = await rpc.call("listPreferences", null);
  if (generation !== state.hydrateGeneration) return;
  const preferences =
    typeof response === "object" && response !== null
      ? (response as { preferences?: unknown }).preferences
      : undefined;
  const values: Partial<PreferenceValues> = {};
  if (typeof preferences === "object" && preferences !== null) {
    for (const key of PREFERENCE_KEYS) {
      const result = parsePreferenceValue(
        key,
        (preferences as Record<string, unknown>)[key],
      );
      if (result.success) {
        (values as Record<PreferenceKey, unknown>)[key] = result.value;
      }
    }
  }
  applyValues({ ...defaultPreferences(), ...values });
  writeMirror(mirrorStorage());
  activeStore().set(state.readyAtom, true);
}

export function applyRemotePreferenceSignal(payload: unknown): void {
  const parsed = preferencesChangedSignalSchema.safeParse(payload);
  if (!parsed.success) return;
  const { key, value } = parsed.data;
  const result = parsePreferenceValue(key, value);
  if (!result.success) return;
  applyValues({ [key]: result.value } as Partial<PreferenceValues>);
  writeMirror(mirrorStorage());
}

function flushWrite(key: PreferenceKey): void {
  const pending = state.pendingWrites.get(key);
  if (pending === undefined) return;
  pending.timer = null;
  const rpc = state.rpc;
  if (rpc === null) {
    state.pendingWrites.delete(key);
    return;
  }
  pending.inFlight = true;
  const value = pending.value;
  void rpc
    .call("setPreference", { key, value })
    .catch((error: unknown) => {
      console.warn(
        `thread-list: saving preference ${key} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    })
    .finally(() => {
      const current = state.pendingWrites.get(key);
      if (current !== pending) return;
      if (current.timer !== null) {
        current.inFlight = false;
        return;
      }
      state.pendingWrites.delete(key);
    });
}

export function schedulePreferenceWrite(
  key: PreferenceKey,
  value: unknown,
): void {
  writeMirror(mirrorStorage());
  let pending = state.pendingWrites.get(key);
  if (pending === undefined) {
    pending = { timer: null, inFlight: false, value };
    state.pendingWrites.set(key, pending);
  }
  pending.value = value;
  if (pending.timer !== null) window.clearTimeout(pending.timer);
  pending.timer = window.setTimeout(() => flushWrite(key), WRITE_DEBOUNCE_MS);
}

export function hasPendingPreferenceWrite(key: PreferenceKey): boolean {
  return state.pendingWrites.has(key);
}

export async function flushPreferenceWritesForTest(): Promise<void> {
  for (const [key, pending] of [...state.pendingWrites]) {
    if (pending.timer !== null) {
      window.clearTimeout(pending.timer);
      flushWrite(key);
    }
  }
  await Promise.resolve();
  await Promise.resolve();
}

export function resetPreferencesSyncForTest(): void {
  for (const pending of state.pendingWrites.values()) {
    if (pending.timer !== null) window.clearTimeout(pending.timer);
  }
  state.pendingWrites.clear();
  state.rpc = null;
  state.hydrateGeneration += 1;
  const store = activeStore();
  for (const key of PREFERENCE_KEYS) {
    store.set(valueAtomFor(key), getPreferenceDefault(key));
  }
  store.set(state.readyAtom, false);
  state.store = null;
}
