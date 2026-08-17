import { atomWithStorage } from "jotai/utils";
import { useAtom, useAtomValue } from "jotai";
import { createJsonLocalStorage } from "./browser-storage";
import {
  BUILT_IN_FILE_OPENER_PREFERENCE,
  buildFileOpenerRef,
  getFileExtension,
  type FileOpenerPreferenceMap,
} from "./plugin-slot-resolvers";

export {
  BUILT_IN_FILE_OPENER_PREFERENCE,
  buildFileOpenerRef,
  getFileExtension,
  type FileOpenerPreferenceMap,
};

/**
 * Per-extension overrides for automatic file-opener selection. A missing key
 * means Automatic, the built-in sentinel pins BB's preview, and an opener ref
 * pins one plugin provider. Stored client-side like other view preferences.
 */
const FILE_OPENER_PREFERENCE_STORAGE_KEY = "bb.fileOpenerByExtension";

const fileOpenerPreferenceAtom = atomWithStorage<FileOpenerPreferenceMap>(
  FILE_OPENER_PREFERENCE_STORAGE_KEY,
  {},
  createJsonLocalStorage<FileOpenerPreferenceMap>(),
  { getOnInit: true },
);

export function useFileOpenerPreference() {
  return useAtom(fileOpenerPreferenceAtom);
}

export function useFileOpenerPreferenceValue(): FileOpenerPreferenceMap {
  return useAtomValue(fileOpenerPreferenceAtom);
}
