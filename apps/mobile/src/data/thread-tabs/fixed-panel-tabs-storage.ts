import { createMMKV } from "react-native-mmkv";
import {
  createFixedPanelTabsStore,
  type FixedPanelTabsStore,
} from "./fixed-panel-tabs-store";

let store: FixedPanelTabsStore | null = null;

/**
 * The app's workspace-panel state store over the `bb.preferences` MMKV
 * instance (the same one the theme / sidebar preferences use, so the e2e
 * reset wipes it too). One instance per process.
 */
export function getFixedPanelTabsStore(): FixedPanelTabsStore {
  if (store === null) {
    const mmkv = createMMKV({ id: "bb.preferences" });
    store = createFixedPanelTabsStore({
      storage: {
        getString: (key) => mmkv.getString(key),
        set: (key, value) => mmkv.set(key, value),
        remove: (key) => {
          mmkv.remove(key);
        },
      },
    });
  }
  return store;
}
