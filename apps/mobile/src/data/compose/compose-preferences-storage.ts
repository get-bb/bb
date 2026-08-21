import { createMMKV } from "react-native-mmkv";
import type { ComposePreferencesStorage } from "./compose-preferences";

/**
 * MMKV-backed store for the thread-creation preferences. Same
 * `bb.preferences` instance as the theme/sidebar preferences so the e2e
 * reset wipes it too.
 */
export function createComposePreferencesStorage(): ComposePreferencesStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
