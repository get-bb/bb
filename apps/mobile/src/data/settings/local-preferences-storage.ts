import { createMMKV } from "react-native-mmkv";
import type { LocalPreferencesStorage } from "./local-preferences";

/**
 * MMKV-backed store for the device-local settings. Same `bb.preferences`
 * instance as the theme / sidebar / compose preferences so the e2e reset
 * wipes it too.
 */
export function createLocalPreferencesStorage(): LocalPreferencesStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
