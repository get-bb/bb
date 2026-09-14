import { atom, type SetStateAction, type WritableAtom } from "jotai";
import {
  getUiPreferenceDefault,
  type UiPreferenceKey,
  type UiPreferenceValue,
} from "@bb/domain";
import {
  registerSyncedUiPreference,
  scheduleUiPreferenceWrite,
} from "./ui-preferences-sync";

export type SyncedPreferenceAtom<Key extends UiPreferenceKey> = WritableAtom<
  UiPreferenceValue<Key>,
  [SetStateAction<UiPreferenceValue<Key>>],
  void
>;

export function createSyncedPreferenceAtom<Key extends UiPreferenceKey>(
  key: Key,
): SyncedPreferenceAtom<Key> {
  const valueAtom = atom<UiPreferenceValue<Key>>(getUiPreferenceDefault(key));
  registerSyncedUiPreference(key, { valueAtom });
  return atom(
    (get) => get(valueAtom),
    (get, set, update: SetStateAction<UiPreferenceValue<Key>>) => {
      const previous = get(valueAtom);
      set(valueAtom, typeof update === "function" ? update(previous) : update);
      scheduleUiPreferenceWrite(key, update);
    },
  );
}
