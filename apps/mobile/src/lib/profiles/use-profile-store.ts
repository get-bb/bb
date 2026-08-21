import { useSyncExternalStore } from "react";
import type { ProfileStore, ProfileStoreState } from "./profile-store";

/** React binding for a {@link ProfileStore}; re-renders on every store change. */
export function useProfileStoreState(store: ProfileStore): ProfileStoreState {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
