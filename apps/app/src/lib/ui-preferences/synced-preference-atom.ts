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

export interface LastKnownPreferenceStore<Value> {
  read(): Value | null;
  write(value: Value): void;
}

export function createSyncedPreferenceAtom<Key extends UiPreferenceKey>(
  key: Key,
  lastKnown?: LastKnownPreferenceStore<UiPreferenceValue<Key>>,
): SyncedPreferenceAtom<Key> {
  const storedAtom = atom<UiPreferenceValue<Key>>(
    lastKnown?.read() ?? getUiPreferenceDefault(key),
  );
  const valueAtom = lastKnown
    ? atom(
        (get) => get(storedAtom),
        (_get, set, value: UiPreferenceValue<Key>) => {
          set(storedAtom, value);
          lastKnown.write(value);
        },
      )
    : storedAtom;
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
