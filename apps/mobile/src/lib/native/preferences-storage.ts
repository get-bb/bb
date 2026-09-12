import { createMMKV, type MMKV } from "react-native-mmkv";

let storage: MMKV | null = null;

export function getPreferencesStorage(): MMKV {
  storage ??= createMMKV({ id: "bb.preferences" });
  return storage;
}
