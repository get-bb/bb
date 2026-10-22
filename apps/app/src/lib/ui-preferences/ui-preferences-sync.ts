import type { QueryClient } from "@tanstack/react-query";
import type { SetStateAction, WritableAtom } from "jotai";
import { getDefaultStore } from "jotai";
import type {
  UiPreferenceEntry,
  UiPreferenceKey,
  UiPreferenceValue,
} from "@bb/domain";
import {
  updateUiPreferenceRoute,
  UI_PREFERENCES_TAG,
  type UiPreferencesResponse,
} from "@bb/server-contract";
import { CORE_TAG_SCOPE, invalidateTags } from "@bb/query-tags";
import { appToast } from "@/components/ui/app-toast";
import { uiPreferencesQueryOptions } from "@/hooks/queries/system-queries";
import { runRouteMutation } from "@/hooks/queries/route-tags";
import { BbHttpError, sdk } from "../sdk";

type JotaiStore = ReturnType<typeof getDefaultStore>;

type ValueAtom<Key extends UiPreferenceKey> = WritableAtom<
  UiPreferenceValue<Key>,
  [UiPreferenceValue<Key>],
  void
>;

interface RegisteredPreference<Key extends UiPreferenceKey> {
  valueAtom: ValueAtom<Key>;
}

interface PreferenceSyncState<Key extends UiPreferenceKey> {
  inFlight: Promise<void> | null;
  pending: SetStateAction<UiPreferenceValue<Key>>[] | null;
  saved: UiPreferenceEntry<Key> | null;
}

interface UiPreferencesSyncContext {
  queryClient: QueryClient;
  store: JotaiStore;
}

const MAX_WRITE_ATTEMPTS = 2;

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
    state = { inFlight: null, pending: null, saved: null };
    syncStates.set(key, state);
  }
  return state as PreferenceSyncState<Key>;
}

function getCachedUiPreferences(
  client: QueryClient,
): UiPreferencesResponse | undefined {
  return client.getQueryData(uiPreferencesQueryOptions(client).queryKey);
}

function latestEntry<Key extends UiPreferenceKey>(
  cached: UiPreferenceEntry<Key> | undefined,
  saved: UiPreferenceEntry<Key> | null,
): UiPreferenceEntry<Key> | undefined {
  return saved !== null && saved.revision > (cached?.revision ?? -1)
    ? saved
    : cached;
}

function areUiPreferenceValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyOperations<Key extends UiPreferenceKey>(
  operations: readonly SetStateAction<UiPreferenceValue<Key>>[],
  base: UiPreferenceValue<Key>,
): UiPreferenceValue<Key> {
  return operations.reduce<UiPreferenceValue<Key>>(
    (value, update) => (typeof update === "function" ? update(value) : update),
    base,
  );
}

function composeOperation<Key extends UiPreferenceKey>(
  operations: readonly SetStateAction<UiPreferenceValue<Key>>[],
  operation: SetStateAction<UiPreferenceValue<Key>>,
): SetStateAction<UiPreferenceValue<Key>>[] {
  return typeof operation === "function"
    ? [...operations, operation]
    : [operation];
}

export function registerSyncedUiPreference<Key extends UiPreferenceKey>(
  key: Key,
  registration: RegisteredPreference<Key>,
): void {
  registry.set(key, registration as RegisteredPreference<UiPreferenceKey>);
  if (context === null) return;
  const cached = getCachedUiPreferences(context.queryClient);
  if (cached !== undefined) {
    reconcileUiPreference(context, key, registration.valueAtom, cached);
  }
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
  const entry = latestEntry(response.preferences[key], state.saved);
  if (entry === undefined) return;
  const cachedEntry = latestEntry(
    getCachedUiPreferences(activeContext.queryClient)?.preferences[key],
    state.saved,
  );
  if (cachedEntry !== undefined && cachedEntry.revision > entry.revision)
    return;
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
  state.pending = composeOperation(state.pending ?? [], update);
  if (state.inFlight === null) void flushUiPreference(key);
}

async function readCurrentUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  const cached = getCachedUiPreferences(queryClient);
  if (cached !== undefined) return cached;
  return refetchUiPreferences(queryClient);
}

function refetchUiPreferences(
  queryClient: QueryClient,
): Promise<UiPreferencesResponse> {
  return queryClient.fetchQuery({
    ...uiPreferencesQueryOptions(queryClient),
    staleTime: 0,
  });
}

function isUiPreferenceConflict(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 409;
}

async function writeUiPreference<Key extends UiPreferenceKey>(
  queryClient: QueryClient,
  key: Key,
  operations: readonly SetStateAction<UiPreferenceValue<Key>>[],
): Promise<void> {
  const state = getSyncState(key);
  let base = latestEntry(
    (await readCurrentUiPreferences(queryClient)).preferences[key],
    state.saved,
  );
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    if (base === undefined) return;
    const value = applyOperations(operations, base.value);
    if (base.revision > 0 && areUiPreferenceValuesEqual(value, base.value)) {
      return;
    }
    try {
      const request = { expectedRevision: base.revision, value };
      const response = await runRouteMutation(
        queryClient,
        updateUiPreferenceRoute,
        { params: { key }, input: request },
        () => sdk.system.uiPreferences.set({ ...request, key }),
      );
      state.saved = { revision: response.revision, value: response.value };
      return;
    } catch (error) {
      if (!isUiPreferenceConflict(error)) throw error;
    }
    base = latestEntry(
      (await refetchUiPreferences(queryClient)).preferences[key],
      state.saved,
    );
  }
}

function notifySyncFailure(error: unknown): void {
  if (syncFailureNotified) return;
  syncFailureNotified = true;
  appToast.error("Couldn’t sync sidebar preferences", {
    description:
      error instanceof Error ? error.message : "Changes stay on this device.",
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
      void invalidateTags(activeContext.queryClient, CORE_TAG_SCOPE, [
        UI_PREFERENCES_TAG,
      ]);
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
