import { createMMKV } from "react-native-mmkv";
import type { RecentFilesStorage } from "./recent-files";

/** MMKV-backed recent-files storage (same `bb.preferences` instance the e2e reset wipes). */
export function createRecentFilesStorage(): RecentFilesStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
