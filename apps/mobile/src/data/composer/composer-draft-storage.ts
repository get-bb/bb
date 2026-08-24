import { createMMKV } from "react-native-mmkv";
import type { ComposerDraftStorage } from "./composer-draft-store";

/**
 * MMKV-backed draft storage. Same `bb.preferences` instance as the other
 * client-local preferences so the e2e reset wipes drafts too.
 */
export function createComposerDraftStorage(): ComposerDraftStorage {
  const store = createMMKV({ id: "bb.preferences" });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
    remove: (key) => {
      store.remove(key);
    },
  };
}
