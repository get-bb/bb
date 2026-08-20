import { createMMKV } from "react-native-mmkv";
import type { SidebarPreferencesStorage } from "./sidebar-preferences";

/**
 * MMKV-backed store for the sidebar display preferences. Same `bb.preferences`
 * instance as the theme preference so the e2e reset wipes it too.
 */
export function createSidebarPreferencesStorage(): SidebarPreferencesStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
