import { useSyncExternalStore } from "react";
import {
  createComposePreferencesStore,
  type ComposePreferences,
  type ComposePreferencesStore,
} from "./compose-preferences";
import { createComposePreferencesStorage } from "./compose-preferences-storage";

let defaultStore: ComposePreferencesStore | null = null;

/** App-wide store (client-local, not per server profile). */
function getComposePreferencesStore(): ComposePreferencesStore {
  defaultStore ??= createComposePreferencesStore(
    createComposePreferencesStorage(),
  );
  return defaultStore;
}

/**
 * The persisted thread-creation preferences plus the store for the scoped
 * getters/setters (stable identity). Any write bumps `revision`, so a
 * component reading `store.getProviderSelection(...)` during render sees the
 * new value after the write.
 */
export function useComposePreferences(
  store: ComposePreferencesStore = getComposePreferencesStore(),
): [ComposePreferences, ComposePreferencesStore] {
  const preferences = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return [preferences, store];
}
