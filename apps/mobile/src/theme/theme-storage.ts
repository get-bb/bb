import { createMMKV } from "react-native-mmkv";
import type { ThemePreferenceStorage } from "./theme-preference";

/** MMKV-backed store for client-local UI preferences (`bb.theme`, …). */
export function createThemePreferenceStorage(): ThemePreferenceStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
