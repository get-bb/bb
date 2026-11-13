import { useCallback, useSyncExternalStore } from "react";
import { getPreferencesStorage } from "../native/preferences-storage";
import {
  createStatusBarPreferenceStore,
  type StatusBarPlacement,
  type StatusBarPreferenceStore,
} from "./window-layout-policy";

let store: StatusBarPreferenceStore | null = null;

function getStatusBarPreferenceStore(): StatusBarPreferenceStore {
  store ??= createStatusBarPreferenceStore(getPreferencesStorage());
  return store;
}

export function useStatusBarPlacement(): [
  StatusBarPlacement,
  (next: StatusBarPlacement) => void,
] {
  const preference = getStatusBarPreferenceStore();
  const placement = useSyncExternalStore(
    preference.subscribe,
    preference.placement,
    preference.placement,
  );
  const setPlacement = useCallback(
    (next: StatusBarPlacement) => preference.setPlacement(next),
    [preference],
  );
  return [placement, setPlacement];
}
