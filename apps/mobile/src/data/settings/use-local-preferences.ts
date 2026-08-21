import { useSyncExternalStore } from "react";
import {
  createLocalPreferencesStore,
  type LocalPreferences,
  type LocalPreferencesStore,
} from "./local-preferences";
import { createLocalPreferencesStorage } from "./local-preferences-storage";

let defaultStore: LocalPreferencesStore | null = null;

/** App-wide store (client-local, not per server profile). */
function getLocalPreferencesStore(): LocalPreferencesStore {
  defaultStore ??= createLocalPreferencesStore(createLocalPreferencesStorage());
  return defaultStore;
}

/** The device-local settings plus the store with the setters (stable identity). */
export function useLocalPreferences(
  store: LocalPreferencesStore = getLocalPreferencesStore(),
): [LocalPreferences, LocalPreferencesStore] {
  const preferences = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return [preferences, store];
}

/** `bb.rewriteLocalhostLinks` for the markdown renderers. */
export function useRewriteLocalhostLinksPreference(): boolean {
  return useLocalPreferences()[0].rewriteLocalhostLinks;
}
