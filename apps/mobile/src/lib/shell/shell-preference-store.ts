import { createMMKV } from "react-native-mmkv";
import {
  createShellPreferenceStore,
  type ShellPreferenceStore,
} from "./shell-preferences";

let store: ShellPreferenceStore | null = null;

/**
 * App-wide handle on the shell's client-local settings. Shares the
 * `bb.preferences` MMKV store, so the e2e reset wipes it with everything else.
 */
export function getShellPreferenceStore(): ShellPreferenceStore {
  store ??= createShellPreferenceStore(createMMKV({ id: "bb.preferences" }));
  return store;
}
