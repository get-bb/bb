import type { QueryClient } from "@tanstack/react-query";
import type { SetStateAction, WritableAtom } from "jotai";
import { getDefaultStore } from "jotai";
import {
  getUiPreferenceDefault,
  type UiPreferenceEntry,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import type { UiPreferencesResponse } from "@bb/server-contract";
import { appToast } from "@/components/ui/app-toast";
import {
  getCachedUiPreferences,
  invalidateCachedUiPreferences,
  setCachedUiPreferences,
} from "@/hooks/cache-owners/ui-preferences-cache-owner";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { BbHttpError, sdk } from "../sdk";
import {
  clearLegacyLocalUiPreference,
  readLegacyLocalUiPreference,
} from "./legacy-local-preferences";

type JotaiStore = ReturnType<typeof getDefaultStore>;

type ValueAtom<Key extends UiPreferenceKey> = WritableAtom<
  UiPreferenceValue<Key>,
  [UiPreferenceValue<Key>],
  void
>;

interface RegisteredPreference<Key extends UiPreferenceKey> {
  valueAtom: ValueAtom<Key>;
}

interface PreferenceOperation<Key extends UiPreferenceKey> {
  source: "migration" | "user";
  update: SetStateAction<UiPreferenceValue<Key>>;
}

interface PreferenceSyncState<Key extends UiPreferenceKey> {
  inFlight: Promise<void> | null;
  migrationAttempted: boolean;
  pending: PreferenceOperation<Key>[] | null;
}

interface UiPreferencesSyncContext {
  queryClient: QueryClient;
  store: JotaiStore;
}

const MAX_WRITE_ATTEMPTS = 2;
const REQUEST_RETRY_DELAYS = [250, 1_000];

function isTransientUiPreferenceError(error: unknown): boolean {
  return (
    isTransientReadError(error) ||
    (error instanceof BbHttpError && [502, 503, 504].includes(error.status))
  );
}

async function retryUiPreferenceRequest<T>(
  request: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      const delay = REQUEST_RETRY_DELAYS[attempt];
      if (delay === undefined || !isTransientUiPreferenceError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const registry = new Map<
  UiPreferenceKey,
  RegisteredPreference<UiPreferenceKey>
>();
const syncStates = new Map<
  UiPreferenceKey,
  PreferenceSyncState<UiPreferenceKey>
>();
let context: UiPreferencesSyncContext | null = null;
let syncFailureNotified = false;

function getSyncState<Key extends UiPreferenceKey>(
  key: Key,
): PreferenceSyncState<Key> {
  let state = syncStates.get(key);
  if (state === undefined) {
    state = { inFlight: null, migrationAttempted: false, pending: null };
    syncStates.set(key, state);
  }
  return state as PreferenceSyncState<Key>;
}

function areUiPreferenceValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyOperations<Key extends UiPreferenceKey>(
  operations: readonly PreferenceOperation<Key>[],
  base: UiPreferenceValue<Key>,
): UiPreferenceValue<Key> {
  return operations.reduce(
    (value, { update }) =>
      typeof update === "function" ? update(value) : update,
    base,
  );
}

function composeOperation<Key extends UiPreferenceKey>(
  operations: readonly PreferenceOperation<Key>[],
  operation: PreferenceOperation<Key>,
): PreferenceOperation<Key>[] {
  return typeof operation.update === "function"
    ? [...operations, operation]
    : [operation];
}

export function registerSyncedUiPreference<Key extends UiPreferenceKey>(
  key: Key,
  registration: RegisteredPreference<Key>,
): void {
  registry.set(key, registration as RegisteredPreference<UiPreferenceKey>);
}

export function startUiPreferencesSync(
  nextContext: UiPreferencesSyncContext,
): () => void {
  context = nextContext;
  const cached = getCachedUiPreferences(nextContext.queryClient);
  if (cached !== undefined) reconcileUiPreferences(cached);
  return () => {
    if (context === nextContext) context = null;
  };
}

export function hasPendingUiPreferenceWrite(key: UiPreferenceKey): boolean {
  const state = syncStates.get(key);
  return (
    state !== undefined && (state.pending !== null || state.inFlight !== null)
  );
}

export function reconcileUiPreferences(response: UiPreferencesResponse): void {
  if (context === null) return;
  for (const [key, { valueAtom }] of registry) {
    reconcileUiPreference(context, key, valueAtom, response);
  }
}

function reconcileUiPreference<Key extends UiPreferenceKey>(
  activeContext: UiPreferencesSyncContext,
  key: Key,
  valueAtom: ValueAtom<Key>,
  response: UiPreferencesResponse,
): void {
  const state = getSyncState(key);
  if (state.pending !== null || state.inFlight !== null) return;
  const entry = response.preferences[key];
  if (entry.revision === 0 && !state.migrationAttempted) {
    state.migrationAttempted = true;
    const legacy = readLegacyLocalUiPreference(key);
    clearLegacyLocalUiPreference(key);
    if (
      legacy !== undefined &&
      !areUiPreferenceValuesEqual(legacy, getUiPreferenceDefault(key))
    ) {
      activeContext.store.set(valueAtom, legacy);
      state.pending = [{ source: "migration", update: legacy }];
      void flushUiPreference(key);
      return;
    }
  }
  if (entry.revision === 0) return;
  clearLegacyLocalUiPreference(key);
  if (
    areUiPreferenceValuesEqual(activeContext.store.get(valueAtom), entry.value)
  ) {
    return;
  }
  activeContext.store.set(valueAtom, entry.value);
}

export function scheduleUiPreferenceWrite<Key extends UiPreferenceKey>(
  key: Key,
  update: SetStateAction<UiPreferenceValue<Key>>,
): void {
  if (context === null) return;
  const state = getSyncState(key);
  state.pending = composeOperation(state.pending ?? [], {
    source: "user",
    update,
  });
  if (state.inFlight === null) void flushUiPreference(key);
}

async function readCurrentUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  const cached = getCachedUiPreferences(queryClient);
  if (cached !== undefined) return cached;
  return refetchUiPreferences(queryClient);
}

async function refetchUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  const response = await retryUiPreferenceRequest(() =>
    sdk.system.uiPreferences.list(),
  );
  setCachedUiPreferences(queryClient, response);
  return response;
}

function isUiPreferenceConflict(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 409;
}

function recordServerEntry<Key extends UiPreferenceKey>(
  queryClient: QueryClient,
  key: Key,
  entry: UiPreferenceEntry<Key>,
): void {
  const cached = getCachedUiPreferences(queryClient);
  if (
    cached === undefined ||
    cached.preferences[key].revision >= entry.revision
  ) {
    return;
  }
  setCachedUiPreferences(queryClient, {
    preferences: { ...cached.preferences, [key]: entry },
  });
}

async function writeUiPreference<Key extends UiPreferenceKey>(
  queryClient: QueryClient,
  key: Key,
  operations: readonly PreferenceOperation<Key>[],
): Promise<void> {
  let base = (await readCurrentUiPreferences(queryClient)).preferences[key];
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    const applicable =
      base.revision === 0
        ? operations
        : operations.filter((operation) => operation.source === "user");
    const value = applyOperations(applicable, base.value);
    if (areUiPreferenceValuesEqual(value, base.value)) return;
    let writeRequests = 0;
    try {
      const response = await retryUiPreferenceRequest(() => {
        writeRequests++;
        return sdk.system.uiPreferences.set({
          expectedRevision: base.revision,
          key,
          value,
        });
      });
      recordServerEntry(queryClient, key, {
        revision: response.revision,
        value: response.value,
      });
      return;
    } catch (error) {
      if (!isUiPreferenceConflict(error)) throw error;
      base = (await refetchUiPreferences(queryClient)).preferences[key];
      if (writeRequests > 1) {
        if (areUiPreferenceValuesEqual(base.value, value)) return;
        throw error;
      }
    }
  }
}

function notifySyncFailure(error: unknown): void {
  if (syncFailureNotified) return;
  syncFailureNotified = true;
  appToast.error("Couldn’t sync sidebar preferences", {
    description:
      error instanceof Error && !isTransientUiPreferenceError(error)
        ? error.message
        : "We couldn’t confirm this change was saved. Please try again.",
  });
}

async function flushUiPreference<Key extends UiPreferenceKey>(
  key: Key,
): Promise<void> {
  const activeContext = context;
  const state = getSyncState(key);
  const operations = state.pending;
  if (
    activeContext === null ||
    operations === null ||
    state.inFlight !== null
  ) {
    return;
  }
  state.pending = null;
  let failed = false;
  const run = writeUiPreference(activeContext.queryClient, key, operations)
    .catch((error: unknown) => {
      failed = true;
      notifySyncFailure(error);
      invalidateCachedUiPreferences(activeContext.queryClient);
    })
    .finally(() => {
      state.inFlight = null;
      if (state.pending !== null) {
        void flushUiPreference(key);
        return;
      }
      if (failed) return;
      const cached = getCachedUiPreferences(activeContext.queryClient);
      if (cached !== undefined) reconcileUiPreferences(cached);
    });
  state.inFlight = run;
  await run;
}

export async function waitForUiPreferenceWrites(): Promise<void> {
  let settled = false;
  while (!settled) {
    settled = true;
    for (const state of syncStates.values()) {
      if (state.inFlight !== null) {
        settled = false;
        await state.inFlight;
      }
    }
  }
}

export function resetUiPreferencesSyncForTest(): void {
  syncStates.clear();
  context = null;
  syncFailureNotified = false;
}
