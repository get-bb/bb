import { getPreferencesStorage } from "../native/preferences-storage";
import {
  createShellPreferenceStore,
  type ShellPreferenceStore,
} from "./shell-preferences";

let store: ShellPreferenceStore | null = null;

export function getShellPreferenceStore(): ShellPreferenceStore {
  store ??= createShellPreferenceStore(getPreferencesStorage());
  return store;
}
