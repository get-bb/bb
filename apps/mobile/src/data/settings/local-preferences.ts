import {
  REWRITE_LOCALHOST_LINKS_DEFAULT,
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
} from "@bb/client-core";

/**
 * Device-local settings the web keeps in localStorage and the phone mirrors
 * under the same keys and JSON spellings in MMKV (`bb.preferences`), so the
 * two clients read alike. Storage is injected (MMKV in the app, a Map in
 * tests); the store is the single writer and notifies subscribers in-process.
 */

export interface LocalPreferencesStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface LocalPreferences {
  /** `bb.rewriteLocalhostLinks`: point agent-emitted localhost links at the server host. */
  rewriteLocalhostLinks: boolean;
}

export interface LocalPreferencesStore {
  getSnapshot(): LocalPreferences;
  subscribe(listener: () => void): () => void;
  setRewriteLocalhostLinks(value: boolean): void;
}

export const LOCAL_PREFERENCE_KEYS = {
  rewriteLocalhostLinks: REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
} as const;

/** The web's jotai `atomWithStorage` JSON spelling (`"true"` / `"false"`). */
export function parseStoredBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  return defaultValue;
}

function readSnapshot(storage: LocalPreferencesStorage): LocalPreferences {
  return {
    rewriteLocalhostLinks: parseStoredBoolean(
      storage.getString(LOCAL_PREFERENCE_KEYS.rewriteLocalhostLinks),
      REWRITE_LOCALHOST_LINKS_DEFAULT,
    ),
  };
}

export function createLocalPreferencesStore(
  storage: LocalPreferencesStorage,
): LocalPreferencesStore {
  let snapshot = readSnapshot(storage);
  const listeners = new Set<() => void>();
  function commit(): void {
    snapshot = readSnapshot(storage);
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setRewriteLocalhostLinks(value) {
      storage.set(
        LOCAL_PREFERENCE_KEYS.rewriteLocalhostLinks,
        value ? "true" : "false",
      );
      commit();
    },
  };
}
